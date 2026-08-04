import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A model-run citation may never travel as a bare title. The owner's decision
 * (2026-08-03) is DISCLOSE, NEVER RESTRICT: a planner may cite ANY run — any
 * engine, any status, any claim tier — and the software's side of that deal is
 * that every citation renders with its engine, status, and claim tier, and a
 * failed or sketch-grade run carries a visible non-blocking warning (sketch_abm
 * VMT ran ~56% below the CARB reference in validation).
 *
 * This file drives the REAL public plan page and the REAL evidence-run picker.
 * Non-vacuity proven by mutation on 2026-08-03: removing the "Cited run"
 * disclosure from the public page failed the first test; removing the warning
 * render from the picker failed the picker test; dropping `engine_key` from the
 * page's model_runs select failed the projection test.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: routerRefreshMock, push: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// A fake service-role client for the public page. Routes on TABLE NAME and
// records every select string, so the tests can assert the PROJECTION — a
// mocked client returns the fixture whatever columns are asked for, so the
// projection assertion is the only thing that catches a dropped column.
// ---------------------------------------------------------------------------

const selectCalls: Record<string, string[]> = {};
let tableData: Record<string, unknown>;

function fakeQuery(tableName: string) {
  const resolveResult = () => ({ data: tableData[tableName] ?? [], error: null });
  const q: {
    eq: () => typeof q;
    in: () => typeof q;
    order: () => typeof q;
    limit: () => typeof q;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise<unknown>;
  } = {
    eq: () => q,
    in: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => resolveResult(),
    then: (resolve) => Promise.resolve(resolveResult()).then(resolve),
  };
  return q;
}

const fromMock = vi.fn((tableName: string) => ({
  select: vi.fn((columns: string) => {
    (selectCalls[tableName] ??= []).push(columns);
    return fakeQuery(tableName);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}));

import PublicRtpWhyPage from "@/app/(public)/plan/[shareToken]/page";
import { RtpPriorityScoreEditor } from "@/components/projects/rtp-priority-score-editor";

function seedPublicPageData() {
  for (const key of Object.keys(selectCalls)) delete selectCalls[key];
  tableData = {
    rtp_cycles: {
      id: "cycle-1",
      title: "Example Region RTP 2050",
      status: "adopted",
      geography_label: null,
      horizon_start_year: 2026,
      horizon_end_year: 2050,
      summary: null,
    },
    project_rtp_cycle_links: [
      {
        id: "link-failed",
        portfolio_role: "constrained",
        priority_rationale: "Rationale A",
        priority_scores: { vmt_reduction: 3 },
        evidence_model_run_id: "run-failed",
        projects: { id: "p1", name: "Corridor improvements", status: "active", summary: null },
      },
      {
        id: "link-sketch",
        portfolio_role: "candidate",
        priority_rationale: "Rationale B",
        priority_scores: { vmt_reduction: 2 },
        evidence_model_run_id: "run-sketch",
        projects: { id: "p2", name: "Trail network", status: "active", summary: null },
      },
    ],
    funding_awards: [],
    model_run_kpis: [
      { run_id: "run-sketch", kpi_name: "resident_vmt_per_capita", value: 18.2, geometry_ref: null },
    ],
    model_runs: [
      { id: "run-failed", run_title: "Old corridor run", engine_key: "aequilibrae", status: "failed" },
      { id: "run-sketch", run_title: "Sketch scenario run", engine_key: "sketch_abm", status: "succeeded" },
    ],
    modeling_claim_decisions: [
      { model_run_id: "run-failed", claim_status: "screening_grade" },
    ],
  };
}

async function renderPublicPage() {
  const page = await PublicRtpWhyPage({ params: Promise.resolve({ shareToken: "share-token-abcdef" }) });
  return render(page);
}

describe("public RTP plan page — a citation travels with engine, status, and claim tier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedPublicPageData();
  });

  it("renders engine · status · claim tier beside every model-run citation", async () => {
    await renderPublicPage();

    // The failed run: engine + status + its recorded tier, next to its title.
    expect(screen.getByText(/Fast Screening · Failed · Screening-grade/)).toBeTruthy();
    expect(screen.getAllByText(/Old corridor run/).length).toBeGreaterThan(0);

    // The sketch run: engine + status + the honest absence of a tier.
    expect(screen.getByText(/Sketch Activity Model · Succeeded · Claim tier not recorded/)).toBeTruthy();
  });

  it("warns — without hiding the citation — when a cited run failed or is sketch-grade", async () => {
    await renderPublicPage();

    // The failed run's warning, with the citation still on the page.
    expect(screen.getByText(/This cited run failed/)).toBeTruthy();
    // The sketch-grade warning names the known low bias.
    expect(screen.getByText(/roughly 56% below the CARB reference/)).toBeTruthy();
    // DISCLOSE, NEVER RESTRICT: both projects and both citations still render.
    expect(screen.getByText("Corridor improvements")).toBeTruthy();
    expect(screen.getByText("Trail network")).toBeTruthy();
  });

  it("asks the database for the columns the disclosure renders", async () => {
    await renderPublicPage();

    // A mocked client returns the fixture whatever columns are asked for, so
    // the projection string is the artifact under test (see CLAUDE.md).
    const runSelects = selectCalls["model_runs"] ?? [];
    expect(runSelects.some((columns) => columns.includes("engine_key") && columns.includes("status"))).toBe(true);
    const claimSelects = selectCalls["modeling_claim_decisions"] ?? [];
    expect(claimSelects.some((columns) => columns.includes("claim_status") && columns.includes("model_run_id"))).toBe(true);
    // geometry_ref is load-bearing: the run-level KPI filter is
    // `!row.geometry_ref` (modeling-evidence.ts), the field is optional in
    // the type, and the clients are untyped — so dropping the column from
    // the .select() makes every row arrive undefined, corridor-slice KPIs
    // pass as run-level evidence on the PUBLIC plan page, and the whole
    // suite stays green. The projection string is the only artifact that
    // can catch it (2026-08-03 review, the review's top finding).
    const kpiSelects = selectCalls["model_run_kpis"] ?? [];
    expect(kpiSelects.length).toBeGreaterThan(0);
    for (const columns of kpiSelects) {
      expect(columns).toContain("geometry_ref");
    }
  });
});

describe("RTP evidence-run picker — every offered and cited run is disclosed, none is refused", () => {
  const availableRuns = [
    {
      id: "run-sketch",
      title: "Sketch scenario run",
      engineKey: "sketch_abm",
      status: "succeeded",
      claimStatus: null,
      claimReadFailed: false,
    },
    {
      id: "run-calibrated",
      title: "Count-calibrated run",
      engineKey: "aequilibrae",
      status: "succeeded",
      claimStatus: "calibrated_to_counts" as const,
      claimReadFailed: false,
    },
  ];

  const failedRunDisclosure = {
    engineKey: "aequilibrae",
    status: "failed",
    claimStatus: "screening_grade" as const,
    claimReadFailed: false,
    runReadFailed: false,
  };

  function renderEditor(overrides?: Partial<Parameters<typeof RtpPriorityScoreEditor>[0]>) {
    const rendered = render(
      <RtpPriorityScoreEditor
        projectId="p1"
        linkId="link-1"
        initialScores={{}}
        availableRuns={availableRuns}
        initialEvidenceRunId={null}
        modelingEvidence={null}
        evidenceRunDisclosure={null}
        {...overrides}
      />
    );
    // The evidence picker lives inside the collapsible scoring section.
    fireEvent.click(screen.getByRole("button", { name: /Priority scoring/ }));
    return rendered;
  }

  beforeEach(() => vi.clearAllMocks());

  it("labels every offered run with engine · status · claim tier", () => {
    renderEditor();

    expect(
      screen.getByRole("option", { name: /Sketch scenario run — Sketch Activity Model · Succeeded · Claim tier not recorded/ })
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: /Count-calibrated run — Fast Screening · Succeeded · Calibrated to counts/ })
    ).toBeTruthy();
  });

  it("disclosed a cited failed run with a non-blocking warning — the citation stays selectable", () => {
    renderEditor({
      initialEvidenceRunId: "run-failed",
      evidenceRunDisclosure: failedRunDisclosure,
      modelingEvidence: {
        runId: "run-failed",
        runTitle: "Old corridor run",
        residentVmtPerCapita: null,
        vmtPerCapita: null,
        ghgTonsPerYear: null,
        ghgKgPerCapitaDay: null,
        hasVmt: false,
        hasGhg: false,
        kpiReadFailed: false,
      },
    });

    // The disclosure line beside the citation (also in the synthesized option
    // for the out-of-window cited run, so more than one match is expected).
    expect(screen.getAllByText(/Fast Screening · Failed · Screening-grade/).length).toBeGreaterThan(0);
    // The warning is present AND says it is not a block.
    expect(screen.getByText(/This cited run failed/)).toBeTruthy();
    // TWO warnings now ride with a failed run, and they are independent facts:
    // the run did not finish, and the engine that produced it is screening-grade.
    // The engine caveat comes from the run-mode registry rather than a branch
    // naming this engine, so every warning here carries the "not a block" tail —
    // hence getAllByText. A single-match query would silently start failing the
    // day a second caveat became correct, which is what happened.
    const notABlock = screen.getAllByText(/the warning is disclosure, not a block/);
    expect(notABlock.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Screening-grade prototype output\. Do not treat it as behavioral demand/)
    ).toBeTruthy();

    // NEVER RESTRICT: the select stays enabled, the cited run (outside the
    // picker window) is represented as the selected option, and no offered run
    // was removed.
    const select = screen.getByLabelText(/Representative model run/) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("run-failed");
    expect(select.options.length).toBe(4); // none + cited + 2 offered
  });

  it("warns on a sketch-grade citation without refusing it", () => {
    renderEditor({
      initialEvidenceRunId: "run-sketch",
      evidenceRunDisclosure: {
        engineKey: "sketch_abm",
        status: "succeeded",
        claimStatus: null,
        claimReadFailed: false,
        runReadFailed: false,
      },
    });

    expect(screen.getByText(/roughly 56% below the CARB reference/)).toBeTruthy();
    const select = screen.getByLabelText(/Representative model run/) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("run-sketch");
  });
});
