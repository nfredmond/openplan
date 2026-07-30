import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAerialProcessingSilenceMinutes,
  summarizeAerialProcessingJob,
  DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES,
} from "@/lib/aerial/catalog";
import { MAX_MISSION_PROCESSING_JOBS } from "@/lib/aerial/queries";
import { AerialProcessingRequestForm } from "@/components/aerial/aerial-processing-request";

/**
 * REGRESSION GUARD — `aerial_processing_jobs` must reach a person.
 *
 * THE DEFECT. The dispatch route and the processing callback have written
 * status, progress, message, artifacts, imagery counts, benchmark summary,
 * dispatch_error and callback timestamps to `aerial_processing_jobs` since
 * migration 20260721000001. `/aerial/missions/[missionId]` did not read that
 * table at all. An operator who dispatched a flight for processing opened the
 * mission page and saw it render exactly as if nothing had ever been
 * dispatched — no running job, no outputs, and no failure reason, even though
 * the reason was sitting in `dispatch_error` in the database.
 *
 * WHY THIS FILE DRIVES THE REAL PAGE AND THE REAL LOADER. Two of the three ways
 * this could ship broken are invisible to a component test:
 *
 *   1. The component could be perfect and mounted nowhere. So the server
 *      component itself is rendered, and the assertions are on the text a
 *      person would read.
 *   2. The `.select()` could stop asking for a column the page renders. Supabase
 *      clients here are deliberately untyped, so that is silent at build time
 *      AND silent in a page test — the fake client hands back its fixture no
 *      matter what was projected. So `@/lib/aerial/queries` is NOT mocked in
 *      this file: the real loader runs against a fake PostgREST chain that
 *      CAPTURES the projection, and the projection is asserted directly.
 *
 * THE CLAIM BOUNDARY UNDER TEST. OpenPlan never polls the worker; it learns a
 * job's state only from callbacks. So a job that has gone quiet must read as
 * "stopped reporting" — never as failed, never as finished — and a failed READ
 * of the table must never render as "no jobs".
 */

const MISSION_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const WORKER_URL_ENV = "OPENPLAN_AERIAL_PROCESSING_WORKER_URL";
const WORKER_TOKEN_ENV = "OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN";
const SILENCE_ENV = "OPENPLAN_AERIAL_PROCESSING_SILENCE_MINUTES";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
const isoAhead = (ms: number) => new Date(Date.now() + ms).toISOString();

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});

const missionMaybeSingleMock = vi.fn();
const packagesOrderMock = vi.fn();
const postureMaybeSingleMock = vi.fn();

/** Captures what the jobs loader actually projected. */
const jobsSelectSpy = vi.fn();
const jobsLimitMock = vi.fn();
const jobsEqSpy = vi.fn();

function missionChain(): Record<string, unknown> {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: missionMaybeSingleMock };
  return chain;
}

function packagesChain(): Record<string, unknown> {
  const chain = { select: () => chain, eq: () => chain, order: packagesOrderMock };
  return chain;
}

function postureChain(): Record<string, unknown> {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: postureMaybeSingleMock };
  return chain;
}

/** Captures what the custody loader projected, and what it was told to hold. */
const custodySelectSpy = vi.fn();
const custodyOrderMock = vi.fn();

function custodyChain(): Record<string, unknown> {
  const chain = {
    select: (columns: string) => {
      custodySelectSpy(columns);
      return chain;
    },
    eq: () => chain,
    order: custodyOrderMock,
  };
  return chain;
}

function jobsChain(): Record<string, unknown> {
  const chain = {
    select: (columns: string) => {
      jobsSelectSpy(columns);
      return chain;
    },
    eq: (column: string, value: string) => {
      jobsEqSpy(column, value);
      return chain;
    },
    order: () => chain,
    limit: jobsLimitMock,
  };
  return chain;
}

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") return missionChain();
  if (table === "aerial_evidence_packages") return packagesChain();
  if (table === "aerial_project_posture") return postureChain();
  if (table === "aerial_processing_jobs") return jobsChain();
  if (table === "aerial_artifact_custody") return custodyChain();
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: () => redirectMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

import AerialMissionDetailPage from "@/app/(app)/aerial/missions/[missionId]/page";

type JobFixture = Record<string, unknown>;

function jobRow(overrides: JobFixture = {}): JobFixture {
  return {
    id: "job-1",
    request_id: "req-0001",
    job_reference: "worker-job-77",
    status: "running",
    progress: 60,
    message: null,
    preset_id: "balanced",
    imagery_url: "https://imagery.example.org/bucket/flight.zip?sig=secret-token",
    imagery_image_count: 482,
    imagery_size_bytes: 7_300_000,
    artifacts: null,
    benchmark_summary: null,
    last_callback_id: "cb-9",
    last_callback_at: isoAgo(4 * MINUTE),
    dispatch_error: null,
    created_at: isoAgo(30 * MINUTE),
    updated_at: isoAgo(4 * MINUTE),
    ...overrides,
  };
}

async function renderMissionPage(): Promise<HTMLElement> {
  const { container } = render(
    await AerialMissionDetailPage({ params: Promise.resolve({ missionId: MISSION_ID }) })
  );
  return container;
}

describe("aerial mission processing jobs are visible", () => {
  const originalEnv = {
    [WORKER_URL_ENV]: process.env[WORKER_URL_ENV],
    [WORKER_TOKEN_ENV]: process.env[WORKER_TOKEN_ENV],
    [SILENCE_ENV]: process.env[SILENCE_ENV],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[SILENCE_ENV];
    process.env[WORKER_URL_ENV] = "https://worker.example.com";
    process.env[WORKER_TOKEN_ENV] = "worker-token";

    // Nothing in custody by default: the ledger is empty until a callback has
    // taken bytes, which is the state every existing mission is in.
    custodyOrderMock.mockResolvedValue({ data: [], error: null });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
    });
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: MISSION_ID,
        workspace_id: WORKSPACE_ID,
        project_id: null,
        title: "Corridor survey",
        status: "active",
        mission_type: "corridor_survey",
        geography_label: null,
        collected_at: null,
        notes: null,
        aoi_geojson: null,
        created_at: isoAgo(10 * DAY),
        updated_at: isoAgo(1 * DAY),
        projects: null,
      },
      error: null,
    });
    packagesOrderMock.mockResolvedValue({ data: [], error: null });
    postureMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    jobsLimitMock.mockResolvedValue({ data: [jobRow()], error: null });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("asks the database for the columns it renders", async () => {
    await renderMissionPage();

    expect(jobsSelectSpy).toHaveBeenCalled();
    const projection = jobsSelectSpy.mock.calls.at(-1)?.[0] as string;

    // Every one of these is rendered somewhere in the job card. A page test
    // alone cannot catch a dropped column, because the fixture comes back
    // regardless of what was projected — so the projection is asserted here.
    for (const column of [
      "id",
      "request_id",
      "job_reference",
      "status",
      "progress",
      "message",
      "preset_id",
      "imagery_url",
      "imagery_image_count",
      "imagery_size_bytes",
      "artifacts",
      "benchmark_summary",
      "last_callback_id",
      "last_callback_at",
      "dispatch_error",
      "created_at",
    ]) {
      expect(projection).toContain(column);
    }
  });

  it("scopes the jobs read to this workspace and this mission", async () => {
    await renderMissionPage();

    expect(jobsEqSpy).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(jobsEqSpy).toHaveBeenCalledWith("mission_id", MISSION_ID);
  });

  it("shows a live job's status and its reported progress", async () => {
    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Running");
    expect(text).toContain("In progress");
    expect(text).toContain("60% reported");
    expect(text).toContain("482 images");
    // The job's own identifiers, so an operator can quote one at the worker.
    expect(text).toContain("worker-job-77");
    expect(text).toContain("req-0001");
  });

  it("never renders the signed imagery URL, only its host", async () => {
    const container = await renderMissionPage();
    const text = container.textContent ?? "";
    const html = container.innerHTML;

    expect(text).toContain("imagery.example.org");
    expect(text).not.toContain("secret-token");
    expect(html).not.toContain("secret-token");
  });

  /**
   * THE VERDICT THIS SURFACE EXISTS TO GET RIGHT. A job recorded as `running`
   * whose worker last spoke three days ago is not running, and OpenPlan cannot
   * know whether it finished — it has no way to ask. So the page says the one
   * true thing, and refuses both false ones.
   */
  it("calls a job that stopped sending callbacks stopped, not failed and not finished", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [jobRow({ last_callback_at: isoAgo(3 * DAY), updated_at: isoAgo(3 * DAY) })],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Stopped reporting");
    expect(text).toContain("3 days");
    expect(text).toMatch(/may still be running/i);
    expect(text).toMatch(/Nothing here has observed it finish/i);
    // It must not be promoted to a verdict in either direction.
    expect(text).not.toMatch(/\bFinished\b/);
    expect(text).not.toMatch(/60% complete/);
    expect(text).not.toMatch(/\bSucceeded\b/);
  });

  it("counts a job that has never called back from when it was requested", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "requested",
          progress: null,
          job_reference: null,
          last_callback_id: null,
          last_callback_at: null,
          created_at: isoAgo(5 * DAY),
        }),
      ],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Stopped reporting");
    expect(text).toMatch(/never called back/i);
    expect(text).toContain("none received");
  });

  it("honours a deployment's own reporting window instead of a baked-in one", async () => {
    // Three days of silence is inside a 100-hour window, so the same row that
    // reads "stopped reporting" above must read as in progress here.
    process.env[SILENCE_ENV] = "6000";
    jobsLimitMock.mockResolvedValue({
      data: [jobRow({ last_callback_at: isoAgo(3 * DAY) })],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("In progress");
    expect(text).not.toContain("Stopped reporting");
  });

  it("says plainly why a dispatch never reached the worker", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "dispatch_failed",
          progress: null,
          job_reference: null,
          last_callback_at: null,
          dispatch_error: "worker responded 503: node pool is draining",
        }),
      ],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Never reached the worker");
    expect(text).toContain("worker responded 503: node pool is draining");
    expect(text).toMatch(/no processing was ever performed/i);
  });

  it("says plainly what the worker reported when a job failed", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "failed",
          progress: 41,
          message: "reconstruction aborted: insufficient overlap in the eastern third",
          last_callback_at: isoAgo(2 * HOUR),
        }),
      ],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Failed");
    expect(text).toContain("reconstruction aborted: insufficient overlap in the eastern third");
  });

  it("does not invent a reason when a failure was recorded without one", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [jobRow({ status: "failed", message: null, dispatch_error: null })],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/failure without a message/i);
  });

  /**
   * ARTIFACTS ARE VENDOR JSON. The list is what the worker said it made,
   * reachable only through links the worker issued and only until they expire.
   * The page may report that; it may not imply OpenPlan holds the file.
   */
  it("reports worker outputs as the worker's, with their expiry and no custody claim", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "succeeded",
          progress: 100,
          last_callback_at: isoAgo(2 * HOUR),
          artifacts: [
            {
              kind: "orthomosaic",
              downloadUrl: "https://worker.example.com/artifacts/ortho.tif?sig=abc",
              expiresAt: isoAhead(6 * HOUR),
              sizeBytes: 1_200_000,
              contentType: "image/tiff",
            },
            {
              kind: "point_cloud",
              downloadUrl: "https://worker.example.com/artifacts/cloud.laz?sig=def",
              expiresAt: isoAgo(2 * HOUR),
              sizeBytes: 900_000,
            },
            // A kind this build has never heard of must still be shown.
            { kind: "thermal_index", downloadUrl: null, expiresAt: null },
            // And an entry it cannot parse must be disclosed, not dropped.
            { downloadUrl: "https://worker.example.com/artifacts/mystery" },
          ],
        }),
      ],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("Orthomosaic");
    expect(text).toContain("Point cloud");
    expect(text).toContain("thermal_index");
    expect(text).toMatch(/1 further output was recorded in a shape OpenPlan could not read/i);
    expect(text).toMatch(/time-limited links the processing worker issued/i);
    expect(text).toMatch(/OpenPlan records the list, not the files/i);
    expect(text).toMatch(/link expired/i);

    // The live link is offered; the expired one is not a link at all.
    const link = screen.getByRole("link", { name: /download from the processing worker/i });
    expect(link).toHaveAttribute("href", "https://worker.example.com/artifacts/ortho.tif?sig=abc");
    expect(screen.getAllByRole("link", { name: /download from the processing worker/i })).toHaveLength(1);
  });

  it("says outputs are unreadable rather than absent when the artifact JSON is not a list", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "succeeded",
          progress: 100,
          artifacts: { unexpected: "shape" },
          last_callback_at: isoAgo(1 * HOUR),
        }),
      ],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/recorded outputs could not be read/i);
    expect(text).toMatch(/treat this as unknown, not as none/i);
  });

  /**
   * THE OTHER HALF OF THE ASSIGNMENT. A read that failed may not be rendered as
   * an answer — "no jobs" and "we could not look" are different facts and an
   * operator acts differently on each.
   */
  it("distinguishes a failed read of the jobs table from a mission with no jobs", async () => {
    jobsLimitMock.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table aerial_processing_jobs' },
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/Processing jobs could not be read/i);
    expect(text).toContain("permission denied for table aerial_processing_jobs");
    expect(text).toMatch(/not the same as this mission having no processing jobs/i);
    expect(text).not.toMatch(/No imagery processing has been requested/i);
  });

  it("says a mission has no jobs only when the read succeeded and returned none", async () => {
    jobsLimitMock.mockResolvedValue({ data: [], error: null });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/No imagery processing has been requested for this mission/i);
    expect(text).not.toMatch(/could not be read/i);
  });

  /**
   * FRESHNESS COPY MUST MATCH FRESHNESS BEHAVIOUR. The freshness line used to
   * read "This page does not update on its own" unconditionally — while the
   * auto-refresh it ships with is ON BY DEFAULT for any mission with an open
   * job. A page contradicting itself about whether it is live is the one
   * untruth a reader cannot check, so both branches are pinned here.
   */
  it("states when the page was read, and says it re-reads itself while a job is open", async () => {
    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/Read from the database at/i);
    expect(text).toMatch(/re-reads itself every 20 seconds while a job is open/i);
    expect(text).not.toMatch(/does not update on its own/i);
  });

  it("says the page does not update itself once no job can still report", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [jobRow({ status: "succeeded", progress: 100, last_callback_at: isoAgo(2 * HOUR) })],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/Read from the database at/i);
    expect(text).toMatch(/does not update on its own/i);
    expect(text).not.toMatch(/re-reads itself/i);
  });

  /**
   * A CAPPED LIST IS NOT A TOTAL. The loader takes the newest
   * MAX_MISSION_PROCESSING_JOBS rows, so a busy mission's page would otherwise
   * report the cap as the mission's job count — a number nobody established,
   * stated in the same words as one that was.
   */
  it("says a capped job list is the most recent, not the total", async () => {
    jobsLimitMock.mockResolvedValue({
      data: Array.from({ length: MAX_MISSION_PROCESSING_JOBS + 1 }, (_unused, index) =>
        jobRow({ id: `job-${index}`, request_id: `req-${index}`, status: "succeeded", progress: 100 })
      ),
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(new RegExp(`${MAX_MISSION_PROCESSING_JOBS} most recent`, "i"));
    expect(text).toMatch(/nothing below is a complete history/i);
    expect(text).not.toMatch(new RegExp(`${MAX_MISSION_PROCESSING_JOBS} total`, "i"));
    // The extra row exists only to detect the cap; it is never rendered. Each
    // job card carries exactly one "Request id" term.
    expect(screen.getAllByText("Request id")).toHaveLength(MAX_MISSION_PROCESSING_JOBS);
  });

  it("calls an uncapped job list a total", async () => {
    const container = await renderMissionPage();

    expect(container.textContent ?? "").toContain("1 total");
  });

  /**
   * THE HEADER IS A CLAIM TOO. The section's status chip is derived from the
   * jobs read; when that read failed the chip previously said "No processing
   * jobs" — an answer — directly above a panel explaining that OpenPlan cannot
   * say. Same defect the packages section already guards against.
   */
  it("does not head the processing section with a verdict when the read failed", async () => {
    jobsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table aerial_processing_jobs" },
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/Processing jobs could not be read/i);
    // Case-sensitive on purpose: the chip's label is "No processing jobs", while
    // the panel's own honest disclaimer legitimately contains the lowercase
    // phrase "having no processing jobs".
    expect(text).not.toContain("No processing jobs");
    expect(text).toContain("Unavailable");
  });

  it("prints a job status this build does not know instead of calling it Unknown", async () => {
    jobsLimitMock.mockResolvedValue({
      data: [jobRow({ status: "awaiting_gcp_review", last_callback_at: isoAgo(2 * MINUTE) })],
      error: null,
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toContain("awaiting_gcp_review");
    expect(text).not.toMatch(/\bUnknown\b/);
  });

  it("offers a member a way to request processing on a configured deployment", async () => {
    const container = await renderMissionPage();

    const form = within(container).getByRole("form", { name: /request imagery processing/i });
    expect(within(form).getByLabelText(/imagery zip url/i)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: /request processing/i })).toBeInTheDocument();
  });

  it("offers no request control on a deployment with no worker configured", async () => {
    delete process.env[WORKER_URL_ENV];
    delete process.env[WORKER_TOKEN_ENV];

    const container = await renderMissionPage();

    expect(within(container).queryByRole("form", { name: /request imagery processing/i })).toBeNull();
    // …but the jobs already recorded are still shown.
    expect(container.textContent ?? "").toContain("Running");
  });

  it("shows a viewer the jobs but not the request control", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(within(container).queryByRole("form", { name: /request imagery processing/i })).toBeNull();
    expect(text).toMatch(/viewers cannot request it/i);
    expect(text).toContain("Running");
  });

  /**
   * THE LOUDEST INSTANCE OF THE SAME DEFECT. `missionErr || !mission` was one
   * branch, so a database error rendered the 404 page — "this mission does not
   * exist" — for a mission that does. The operator's next move after that
   * sentence is to re-create work that is still there.
   */
  it("does not answer a failed read of the mission with 'not found'", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "canceling statement due to statement timeout" },
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(text).toMatch(/This mission could not be read/i);
    expect(text).toContain("canceling statement due to statement timeout");
    expect(text).toMatch(/not the same as the mission not existing/i);
  });

  it("still answers a mission that genuinely is not there with 'not found'", async () => {
    missionMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    await expect(renderMissionPage()).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("does not report evidence-package counts derived from a read that failed", async () => {
    packagesOrderMock.mockResolvedValue({
      data: null,
      error: { message: "column aerial_evidence_packages.verification_readiness does not exist" },
    });

    const container = await renderMissionPage();
    const text = container.textContent ?? "";

    expect(text).toMatch(/Evidence packages could not be read/i);
    expect(text).toMatch(/unavailable, not zero/i);
    expect(text).not.toMatch(/0 ready · 0 total/);
    expect(text).not.toMatch(/No evidence packages yet/i);
  });
});

/**
 * THE REFUSAL A PLANNER ACTUALLY SEES.
 *
 * The dispatch route validates the imagery link with zod and returns the reason
 * in `issues`. The form previously collapsed that to the route's generic
 * `error` string — "Invalid processing request payload" — which names nothing
 * and is the single most likely refusal (an `http://` link the worker will not
 * accept). A control whose failure message cannot be acted on is only half a
 * control.
 */
describe("the processing request control's refusals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderForm() {
    render(<AerialProcessingRequestForm missionId={MISSION_ID} />);
    return screen.getByRole("form", { name: /request imagery processing/i });
  }

  it("shows the server's own validation reason, not its generic error string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Invalid processing request payload",
          issues: [
            { message: "imageryZipUrl must be an https URL (http allowed for localhost only)" },
          ],
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const form = renderForm();
    fireEvent.change(screen.getByLabelText(/imagery zip url/i), {
      target: { value: "http://imagery.example.org/flight.zip" },
    });
    fireEvent.submit(form);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "imageryZipUrl must be an https URL (http allowed for localhost only)"
    );
    expect(alert.textContent).toMatch(/Nothing was dispatched/i);
    expect(alert.textContent).not.toMatch(/^The request failed/);
  });

  it("names an unparseable image count instead of sending a null the reader never typed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const form = renderForm();
    fireEvent.change(screen.getByLabelText(/imagery zip url/i), {
      target: { value: "https://imagery.example.org/flight.zip" },
    });
    fireEvent.change(screen.getByLabelText(/image count/i), { target: { value: "about 500" } });
    fireEvent.submit(form);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Image count is not a number/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the silence boundary itself", () => {
  it("flips exactly at the configured window", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const inside = summarizeAerialProcessingJob(
      {
        status: "running",
        last_callback_at: new Date(now.getTime() - 59 * MINUTE).toISOString(),
        created_at: new Date(now.getTime() - 5 * HOUR).toISOString(),
      },
      { now, silenceMinutes: 60 }
    );
    const outside = summarizeAerialProcessingJob(
      {
        status: "running",
        last_callback_at: new Date(now.getTime() - 61 * MINUTE).toISOString(),
        created_at: new Date(now.getTime() - 5 * HOUR).toISOString(),
      },
      { now, silenceMinutes: 60 }
    );

    expect(inside.liveness).toBe("reporting");
    expect(outside.liveness).toBe("silent");
    // Silence is never promoted into a terminal verdict.
    expect(outside.isTerminal).toBe(false);
    expect(outside.failureDetail).toBeNull();
  });

  it("treats an unparseable or missing window as unset rather than as zero", () => {
    // A typo that became a cap of 0 would make every live job read as abandoned.
    expect(resolveAerialProcessingSilenceMinutes(undefined)).toBe(
      DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES
    );
    expect(resolveAerialProcessingSilenceMinutes("  ")).toBe(
      DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES
    );
    expect(resolveAerialProcessingSilenceMinutes("0")).toBe(
      DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES
    );
    expect(resolveAerialProcessingSilenceMinutes("-5")).toBe(
      DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES
    );
    expect(resolveAerialProcessingSilenceMinutes("not a number")).toBe(
      DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES
    );
    expect(resolveAerialProcessingSilenceMinutes("15")).toBe(15);
  });

  /**
   * CUSTODY REACHES A PERSON — the half that shipped unreachable.
   *
   * The custody engine fetched artifact bytes, hashed them and stored them in a
   * private bucket, and `loadAerialArtifactCustodyForMission` was written to
   * show that on this page. It had NO CALLER. So the bytes were being taken and
   * no planner could see it had happened — or, worse, see that an orthomosaic's
   * vendor link had lapsed with nothing held behind it. Meanwhile the panel
   * carried a standing sentence saying "OpenPlan records the list, not the
   * files", which the custody work had just made false.
   *
   * These drive the REAL page, so they fail if the loader loses its caller
   * again, if the projection drops a column, or if the note stops tracking the
   * ledger.
   */
  it("asks the database what it holds for this mission", async () => {
    await renderMissionPage();

    expect(fromMock).toHaveBeenCalledWith("aerial_artifact_custody");
    const projection = custodySelectSpy.mock.calls[0]?.[0] as string | undefined;
    expect(projection).toBeDefined();
    // The columns the note is built from. A mocked client returns the fixture
    // whatever was projected, so only the string itself can catch a drop.
    for (const column of ["kind", "state", "byte_size", "source_expires_at"]) {
      expect(projection).toContain(column);
    }
  });

  it("says the outputs are only vendor links when nothing has been taken", async () => {
    // The note lives with the output list, so the job has to have reported some.
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "succeeded",
          progress: 100,
          artifacts: [
            {
              kind: "orthomosaic",
              downloadUrl: "https://worker.example.com/artifacts/ortho.tif?sig=abc",
              expiresAt: isoAhead(6 * HOUR),
              sizeBytes: 1_200_000,
              contentType: "image/tiff",
            },
          ],
        }),
      ],
      error: null,
    });
    custodyOrderMock.mockResolvedValue({ data: [], error: null });

    const container = await renderMissionPage();

    expect(container.textContent).toMatch(/OpenPlan records the list, not the files/i);
  });

  it("stops saying that once OpenPlan actually holds the bytes", async () => {
    // The note lives with the output list, so the job has to have reported some.
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "succeeded",
          progress: 100,
          artifacts: [
            {
              kind: "orthomosaic",
              downloadUrl: "https://worker.example.com/artifacts/ortho.tif?sig=abc",
              expiresAt: isoAhead(6 * HOUR),
              sizeBytes: 1_200_000,
              contentType: "image/tiff",
            },
          ],
        }),
      ],
      error: null,
    });
    custodyOrderMock.mockResolvedValue({
      data: [
        {
          processing_job_id: "job-1",
          kind: "orthomosaic",
          ordinal: 0,
          state: "held",
          storage_bucket: "aerial-artifacts",
          storage_path: `${WORKSPACE_ID}/${MISSION_ID}/job-1/orthomosaic-0`,
          byte_size: 5_242_880,
          checksum_sha256: "a".repeat(64),
          source_expires_at: "2099-01-01T00:00:00.000Z",
          failure_code: null,
          attempt_count: 1,
          held_at: "2026-07-30T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const container = await renderMissionPage();

    // The old blanket sentence is now false for this job and must not appear.
    expect(container.textContent).not.toMatch(/OpenPlan records the list, not the files/i);
  });

  it("does not report an unreadable custody ledger as nothing held", async () => {
    // The note lives with the output list, so the job has to have reported some.
    jobsLimitMock.mockResolvedValue({
      data: [
        jobRow({
          status: "succeeded",
          progress: 100,
          artifacts: [
            {
              kind: "orthomosaic",
              downloadUrl: "https://worker.example.com/artifacts/ortho.tif?sig=abc",
              expiresAt: isoAhead(6 * HOUR),
              sizeBytes: 1_200_000,
              contentType: "image/tiff",
            },
          ],
        }),
      ],
      error: null,
    });
    custodyOrderMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const container = await renderMissionPage();

    // "Nothing is held" and "we could not find out" send an operator to
    // different places, and only one is a statement about this mission.
    expect(container.textContent).toMatch(/could not read its own record/i);
    expect(container.textContent).not.toMatch(/OpenPlan records the list, not the files/i);
  });

});
