import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  describeAerialProcessingAvailability,
  isAerialProcessingWorkerConfigured,
} from "@/lib/aerial/processing-availability";

/**
 * REGRESSION GUARD — the mission page may not tell a configured deployment that
 * its working capability is a future release.
 *
 * THE DEFECT. `/aerial/missions/[missionId]` rendered an UNCONDITIONAL notice
 * saying imagery processing "ships in a future release" and that
 * `POST /api/aerial/missions/[id]/process` "returns HTTP 501". The route only
 * answers 501 when `OPENPLAN_AERIAL_PROCESSING_WORKER_URL` /
 * `OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN` are unset; with both set it records
 * a job, dispatches to the Aerial Intel Platform worker, and answers 202. So on
 * every deployment that had actually wired the worker up, a live surface stated
 * something false about that deployment's own behaviour.
 *
 * WHY THE PAGE RENDER IS ASSERTED, not just the copy builder. The builder being
 * correct proves nothing if the page keeps its own hardcoded prose, which is
 * exactly the shape the defect had. These tests drive the real server component
 * with the environment set both ways and read the resulting DOM.
 *
 * WHAT CHANGED SINCE. This file used to end by noting that no request button and
 * no job-status section existed, and asserting that the copy admitted it. Both
 * now exist — see `aerial-mission-processing-jobs.test.tsx`, which drives them —
 * so the assertions here moved from "the page admits it has neither" to "the
 * page no longer claims it has neither". The stale sentence still sits in
 * `describeAerialProcessingAvailability`'s configured branch, which belongs to
 * another lane; the page stopped rendering that branch instead.
 */

const WORKER_URL_ENV = "OPENPLAN_AERIAL_PROCESSING_WORKER_URL";
const WORKER_TOKEN_ENV = "OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN";

const PROCESS_ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/aerial/missions/[missionId]/process/route.ts"
);

const MISSION_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadAerialProjectPostureMock = vi.fn();
const loadAerialProcessingJobsForMissionMock = vi.fn();
// The page reads the custody ledger alongside the jobs. This file is about the
// availability copy, so custody stays empty — but the export must exist or the
// page cannot render at all.
const loadAerialArtifactCustodyForMissionMock = vi.fn((..._args: unknown[]) => ({
  byProcessingJobId: new Map(),
  unreadableReason: null,
}));
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});

const missionMaybeSingleMock = vi.fn();
const packagesOrderMock = vi.fn();

/**
 * Minimal stand-in for the two PostgREST chains the page builds. Each `.eq()`
 * returns the same object so the chain length does not have to be hardcoded
 * here; only the terminal call differs per table.
 */
function missionChain(): Record<string, unknown> {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: missionMaybeSingleMock,
  };
  return chain;
}

function packagesChain(): Record<string, unknown> {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: packagesOrderMock,
  };
  return chain;
}

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") return missionChain();
  if (table === "aerial_evidence_packages") return packagesChain();
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: () => redirectMock(),
  // The processing section's client controls (request form, freshness control)
  // call useRouter; they render inside this page now.
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

vi.mock("@/lib/aerial/queries", () => ({
  loadAerialProjectPosture: (...args: unknown[]) => loadAerialProjectPostureMock(...args),
  AERIAL_PROCESSING_JOB_SELECT: "id",
  loadAerialProcessingJobsForMission: (...args: unknown[]) =>
    loadAerialProcessingJobsForMissionMock(...args),
  loadAerialArtifactCustodyForMission: (...args: unknown[]) =>
    loadAerialArtifactCustodyForMissionMock(...args),
}));

import AerialMissionDetailPage from "@/app/(app)/aerial/missions/[missionId]/page";

/**
 * Returns the text of THIS render's own container rather than the whole
 * document body. Two of these assertions are `not.toMatch`, and reading the
 * body would let a leftover render from an earlier case satisfy — or falsely
 * fail — them.
 */
async function renderMissionPage(): Promise<string> {
  const { container } = render(
    await AerialMissionDetailPage({ params: Promise.resolve({ missionId: MISSION_ID }) })
  );
  return container.textContent ?? "";
}

describe("aerial imagery-processing availability", () => {
  const originalWorkerUrl = process.env[WORKER_URL_ENV];
  const originalWorkerToken = process.env[WORKER_TOKEN_ENV];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[WORKER_URL_ENV];
    delete process.env[WORKER_TOKEN_ENV];

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID },
    });
    loadAerialProjectPostureMock.mockResolvedValue({ posture: null, updatedAt: null });
    loadAerialProcessingJobsForMissionMock.mockResolvedValue({ jobs: [], unreadableReason: null });
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: MISSION_ID,
        workspace_id: WORKSPACE_ID,
        project_id: null,
        title: "Corridor survey",
        status: "planned",
        mission_type: "corridor_survey",
        geography_label: null,
        collected_at: null,
        notes: null,
        aoi_geojson: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-02T00:00:00.000Z",
        projects: null,
      },
      error: null,
    });
    packagesOrderMock.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    if (originalWorkerUrl === undefined) delete process.env[WORKER_URL_ENV];
    else process.env[WORKER_URL_ENV] = originalWorkerUrl;
    if (originalWorkerToken === undefined) delete process.env[WORKER_TOKEN_ENV];
    else process.env[WORKER_TOKEN_ENV] = originalWorkerToken;
  });

  describe("isAerialProcessingWorkerConfigured", () => {
    it("counts a deployment with only one half of the credential pair as unconfigured", () => {
      process.env[WORKER_URL_ENV] = "https://worker.example.com";
      expect(isAerialProcessingWorkerConfigured()).toBe(false);

      delete process.env[WORKER_URL_ENV];
      process.env[WORKER_TOKEN_ENV] = "worker-token";
      expect(isAerialProcessingWorkerConfigured()).toBe(false);
    });

    it("counts whitespace-only values as unconfigured, matching the dispatch route's trim", () => {
      process.env[WORKER_URL_ENV] = "   ";
      process.env[WORKER_TOKEN_ENV] = "\t";
      expect(isAerialProcessingWorkerConfigured()).toBe(false);
    });

    it("counts a deployment with both values set as configured", () => {
      process.env[WORKER_URL_ENV] = "https://worker.example.com";
      process.env[WORKER_TOKEN_ENV] = "worker-token";
      expect(isAerialProcessingWorkerConfigured()).toBe(true);
    });

    /**
     * DRIFT GUARD — the accessor RESTATES the dispatch route's condition rather
     * than the route calling the accessor, so nothing else stops the two from
     * diverging. If the route renames an env var or relaxes the both-halves
     * rule, the page goes straight back to describing a boundary the route no
     * longer has — the exact defect this file exists to prevent, reintroduced
     * from the other side. The route belongs to another lane, so this pins its
     * condition instead of changing it; the day the route starts importing
     * `isAerialProcessingWorkerConfigured`, delete this case, because then the
     * two cannot disagree.
     */
    it("still mirrors the dispatch route's own condition for answering 501", () => {
      const source = readFileSync(PROCESS_ROUTE_PATH, "utf8");

      expect(source).toContain(`process.env.${WORKER_URL_ENV}`);
      expect(source).toContain(`process.env.${WORKER_TOKEN_ENV}`);
      expect(source).toContain("if (!workerUrl || !workerToken)");
      expect(source).toContain("status: 501");
    });
  });

  describe("describeAerialProcessingAvailability", () => {
    it("does not claim a 501 or a future release once a worker is configured", () => {
      const notice = describeAerialProcessingAvailability(true);
      const text = `${notice.title} ${notice.description}`;

      expect(text).not.toMatch(/501/);
      expect(text).not.toMatch(/future release/i);
      expect(text).not.toMatch(/not implemented/i);
    });

    it("names the missing env vars and the 501 when no worker is configured", () => {
      const notice = describeAerialProcessingAvailability(false);
      const text = `${notice.title} ${notice.description}`;

      expect(text).toContain("501");
      expect(text).toContain(WORKER_URL_ENV);
      expect(text).toContain(WORKER_TOKEN_ENV);
    });

    /**
     * SUPERSEDED CLAIM. This branch used to end with "There is no request button
     * or job-status view on this page yet", and a test here asserted that it
     * said so. Both halves are now false: the mission page renders a processing
     * request form and a job list read from `aerial_processing_jobs`.
     *
     * The stale sentence still lives in `processing-availability.ts`, which
     * belongs to another lane, so the PAGE stopped rendering that branch rather
     * than the sentence being edited from here. What is asserted instead is the
     * thing that actually protects a reader: that the live page does not carry
     * the claim. See "the rendered mission page" below.
     */
    it("still returns a configured-branch notice, which the page no longer renders verbatim", () => {
      const notice = describeAerialProcessingAvailability(true);

      expect(notice.title).toMatch(/configured/i);
    });
  });

  describe("the rendered mission page", () => {
    it("stops claiming a future release and a 501 once a worker is configured", async () => {
      process.env[WORKER_URL_ENV] = "https://worker.example.com";
      process.env[WORKER_TOKEN_ENV] = "worker-token";

      const text = await renderMissionPage();

      expect(text).not.toMatch(/future release/i);
      expect(text).not.toMatch(/501/);
      expect(text).toMatch(/Imagery processing is configured/i);
    });

    it("discloses the 501 boundary and its cause when no worker is configured", async () => {
      const text = await renderMissionPage();

      expect(text).toMatch(/Imagery processing is not configured on this deployment/i);
      expect(text).toContain("501");
      expect(text).toContain(WORKER_URL_ENV);
    });

    it("never uses the old 'request ODM processing' phrasing for the AOI section", async () => {
      process.env[WORKER_URL_ENV] = "https://worker.example.com";
      process.env[WORKER_TOKEN_ENV] = "worker-token";

      const text = await renderMissionPage();

      // The AOI/export header once offered "request ODM processing" as one of
      // the things you could do in it. Requesting processing is now its own
      // section, so that header must still not claim it.
      expect(text).not.toMatch(/request ODM processing/i);
    });

    /**
     * The claim that replaced the one this file was written for. A configured
     * deployment now HAS a request control and a job list, so the page may not
     * repeat `describeAerialProcessingAvailability(true)`'s closing sentence.
     */
    it("no longer tells a configured deployment it has no request button or job view", async () => {
      process.env[WORKER_URL_ENV] = "https://worker.example.com";
      process.env[WORKER_TOKEN_ENV] = "worker-token";

      const text = await renderMissionPage();

      expect(text).not.toMatch(/no request button/i);
      expect(text).not.toMatch(/has to be made against that endpoint directly/i);
    });
  });
});
