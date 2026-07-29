import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * REACHABILITY GUARD — the operator's worker declaration arrives at the button
 * a planner actually presses.
 *
 * THE DEFECT THIS CLOSES. The declaration was built, ranked, documented in
 * `.env.example` and SELF_HOSTING.md, and unit-tested to the wall — and neither
 * page passed it to its launch control. Both controls default the value to
 * "nobody said", so every deployment went on refusing only retrospectively
 * while the operator-facing copy described a refusal that arrives before the
 * run. Documentation describing a capability the code does not have is the same
 * defect class as a false string on a page, so the guard belongs here, on the
 * wiring, and not on the pure functions either side of it.
 *
 * The county page is rendered outright. The model page cannot be: it reaches
 * `run-reconcile.ts`, which carries Next.js's `server-only` marker, and that
 * marker has no runtime package to resolve to outside a Next build. So its half
 * is split — the join is asserted from the page source (the same approach, and
 * the same reason, as `model-run-study-area-inheritance.test.ts`), and the two
 * modules the page joins are then exercised against each other for real.
 */

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const useCountyRunsMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/county-runs",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
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

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRuns: (...args: unknown[]) => useCountyRunsMock(...args),
  useCountyRunMutations: () => ({ create: vi.fn(), loading: false, error: null }),
}));

// The shared any-US-place picker mounts Mapbox and has its own tests; in both
// controls below it is scenery around the thing under examination.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

import CountyRunsPage from "@/app/(app)/county-runs/page";
import { ModelRunManager, type ModelRunArtifact, type ModelRunStage } from "@/components/models/model-run-manager";
import { resolveModelingWorkerDeclaration } from "@/lib/config/deployment-health-facts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ID = "33333333-3333-4333-8333-333333333333";

const modelPageSource = readFileSync(
  path.join(process.cwd(), "src/app/(app)/models/[modelId]/page.tsx"),
  "utf8"
);

describe("the model page joins its deployment's declaration to the launch control", () => {
  it("reads the declaration through the shared reader, not a second one of its own", () => {
    // One reader, two callers. A page that parsed the variable itself could
    // disagree with the dashboard's configuration panel about the very same
    // deployment — and an operator would have no way to tell which was right.
    expect(modelPageSource).toContain("resolveModelingWorkerDeclaration");
    expect(modelPageSource).toContain('from "@/lib/config/deployment-health-facts"');
    expect(modelPageSource).not.toContain("OPENPLAN_MODELING_WORKER");
  });

  it("hands what it read to the run manager", () => {
    // The whole finding: everything above this line already worked, and the
    // value stopped here.
    expect(modelPageSource).toContain("modelingWorkerDeclaration={modelingWorkerDeclaration}");
  });
});

/**
 * The other half of that join, exercised for real: the value the reader
 * produces from an operator's environment, given to the actual control.
 */
describe("what a planner is told, given the declaration the model page reads", () => {
  type ManagedRun = React.ComponentProps<typeof ModelRunManager>["modelRuns"][number];

  /**
   * A worker-backed run as the model page renders it once the reaper has been
   * through: failed, every stage failed, and nothing ever stamped a
   * `started_at`. This is the observation that outranks any declaration.
   */
  function abandonedAequilibraeRun(): ManagedRun {
    return {
      id: "44444444-4444-4444-8444-444444444444",
      status: "failed",
      run_title: "Screening run",
      engine_key: "aequilibrae",
      source_analysis_run_id: null,
      scenario_entry_id: null,
      result_summary_json: null,
      error_message: "No modeling worker picked up this run within 15 minutes.",
      started_at: null,
      completed_at: "2026-07-28T11:20:00Z",
      created_at: "2026-07-28T11:00:00Z",
      stages: [
        { id: "stage-1", stage_name: "AequilibraE Setup", status: "failed", started_at: null, completed_at: null },
      ] as ModelRunStage[],
      artifacts: [] as ModelRunArtifact[],
    };
  }

  /** Mounts the control exactly as the page does — declaration included. */
  function renderAsThePageDoes(modelRuns: ManagedRun[] = []) {
    render(
      <ModelRunManager
        modelId={MODEL_ID}
        modelTitle="Regional screening model"
        defaultQueryText="Screening run"
        defaultCorridorText=""
        scenarioEntries={[]}
        modelRuns={modelRuns}
        schemaPending={false}
        modelingWorkerDeclaration={resolveModelingWorkerDeclaration()}
      />
    );
    // The refusal is engine-specific by design: an in-process lane cannot be
    // blocked by a worker that does not exist, whatever a deployment declares.
    fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value: "aequilibrae" } });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses the first worker-backed launch where the deployment declares no worker", () => {
    // Before the page passed this down, a fresh deployment could only refuse
    // AFTER a run had been queued and reaped — so the first planner on every new
    // deployment paid fifteen minutes to discover what the operator had said.
    vi.stubEnv("OPENPLAN_MODELING_WORKER", "absent");

    renderAsThePageDoes();

    const refusal = screen.getByTestId("worker-launch-refusal");
    expect(refusal).toHaveTextContent(/this deployment declares that it runs none/i);
    expect(refusal).toHaveTextContent(/configuration states that no such worker runs against it/i);
    expect(screen.getByRole("button", { name: /Launch refused/i })).toHaveProperty("disabled", true);
  });

  it("refuses nothing when nobody has declared anything", () => {
    // The load-bearing case for every deployment that exists today. Each one
    // that runs a worker has never set this variable, so silence arriving at the
    // button as a refusal would break working installations from no evidence at
    // all.
    vi.stubEnv("OPENPLAN_MODELING_WORKER", undefined);

    renderAsThePageDoes();

    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
    expect(screen.getByRole("button", { name: /Launch managed run/i })).toHaveProperty("disabled", false);
  });

  it("ignores a declaration it does not understand rather than acting on a typo", () => {
    vi.stubEnv("OPENPLAN_MODELING_WORKER", "depoyed");

    renderAsThePageDoes();

    // Neither refused — which would punish a misspelling — nor trusted. The
    // dashboard is where the operator is told the value was ignored.
    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
  });

  it("still refuses where a declared worker has not been picking up runs", () => {
    // The ranking, through the wiring: a declaration is a statement made once,
    // and the run history in front of the planner outranks it.
    vi.stubEnv("OPENPLAN_MODELING_WORKER", "deployed");

    renderAsThePageDoes([abandonedAequilibraeRun()]);

    const refusal = screen.getByTestId("worker-launch-refusal");
    expect(refusal).toHaveTextContent(/has not been picking up its runs/i);
    expect(refusal).toHaveTextContent(/queued and never started by anything/i);
  });

  it("does not refuse a declared worker that no run contradicts", () => {
    vi.stubEnv("OPENPLAN_MODELING_WORKER", "deployed");

    renderAsThePageDoes();

    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
    expect(screen.getByRole("button", { name: /Launch managed run/i })).toHaveProperty("disabled", false);
  });
});

type Result = { data: unknown; error: { message: string } | null };

/** A supabase-js query builder that answers with `result` however it is chained. */
function respondWith(result: Result) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * A workspace that has already stated where it works — deliberately not a
 * California county, because nothing here may assume one place. The page opens
 * on it, so the launch button is live and the disclosure below is being made
 * about a launch that could really happen.
 */
function workspaceHomeRow() {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "39049",
    home_geography_label: "Franklin County, Ohio",
    home_country_code: "US",
    home_subdivision_code: "OH",
    home_min_lon: -83.1,
    home_min_lat: 39.9,
    home_max_lon: -82.8,
    home_max_lat: 40.1,
    home_geometry_geojson: {
      type: "Polygon",
      coordinates: [
        [
          [-83.1, 39.9],
          [-82.8, 39.9],
          [-82.8, 40.1],
          [-83.1, 40.1],
          [-83.1, 39.9],
        ],
      ],
    },
    home_geography_set_at: "2026-07-01T00:00:00.000Z",
  };
}

describe("what the county onboarding page tells a planner about this deployment's worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    });
    useCountyRunsMock.mockReturnValue({ items: [], loading: false, error: null, refresh: vi.fn() });
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) =>
        respondWith(table === "workspaces" ? { data: workspaceHomeRow(), error: null } : { data: null, error: null }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says the first launch produces a handoff, before any handoff has been produced", async () => {
    // Prepared records are retrospective evidence: they exist only after a
    // launch has already been prepared rather than submitted. The worker URL is
    // the dispatcher's own test, so it can be read before the first launch.
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", undefined);

    render(await CountyRunsPage({ searchParams: Promise.resolve({}) }));

    const disclosure = screen.getByTestId("county-worker-absent-disclosure");
    expect(disclosure).toHaveTextContent(/no county onramp worker configured to receive the job/i);
    // Launching stays possible — a prepared handoff is genuinely usable by an
    // operator. What changes is that it is no longer presented as background
    // execution.
    expect(screen.getByRole("button", { name: /Launch county run/i })).toHaveProperty("disabled", false);
  });

  it("stops warning about handoffs once a worker is configured, even with prepared runs on file", async () => {
    // The declaration wins in BOTH directions. Old prepared records are history
    // on a deployment that now has a worker, and repeating them would tell a
    // planner their launch will not be submitted when it will be.
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.example");
    useCountyRunsMock.mockReturnValue({
      items: [{ id: "county-1", enqueueStatus: "prepared" }],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(await CountyRunsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByTestId("county-worker-absent-disclosure")).toBeNull();
  });

  it("hands the browser the verdict, never the worker's address", async () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.internal.example/secret-path");

    const { container } = render(await CountyRunsPage({ searchParams: Promise.resolve({}) }));

    expect(container.innerHTML).not.toContain("worker.internal.example");
  });
});
