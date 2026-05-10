import { describe, expect, it, vi } from "vitest";
import {
  loadReportScenarioSetLinks,
  type ReportScenarioSpineWarningHandler,
  type ReportScenarioSupabaseLike,
} from "@/lib/reports/scenario-provenance";

type QueryResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string; code?: string | null } | null;
};

function makeInResolver(data: Record<string, unknown>[] | null, error: QueryResult["error"] = null) {
  return vi.fn<(column: string, values: string[]) => Promise<QueryResult>>(() =>
    Promise.resolve({ data, error })
  );
}

describe("loadReportScenarioSetLinks schema-pending warnings", () => {
  it("invokes onSchemaPending for each scenario spine table that reports schema cache fallback", async () => {
    const schemaPendingError = {
      message: "Could not find the 'scenario_assumption_sets' table in schema cache",
      code: "PGRST205",
    };

    const fromMock = vi.fn<(table: string) => { select: (query: string) => { in: unknown } }>((table) => {
      if (table === "scenario_entries") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              {
                id: "entry-1",
                scenario_set_id: "set-1",
                entry_type: "baseline",
                label: "Baseline",
                attached_run_id: "run-1",
                sort_order: 0,
                created_at: "2026-04-10T00:00:00.000Z",
                updated_at: "2026-04-10T00:00:00.000Z",
              },
            ]),
          })),
        };
      }
      if (table === "scenario_sets") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              {
                id: "set-1",
                title: "Set 1",
                baseline_entry_id: "entry-1",
                updated_at: "2026-04-10T00:00:00.000Z",
              },
            ]),
          })),
        };
      }
      if (table === "runs") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              { id: "run-1", title: "Run 1", created_at: "2026-04-10T00:00:00.000Z" },
            ]),
          })),
        };
      }
      if (
        table === "scenario_assumption_sets" ||
        table === "scenario_data_packages" ||
        table === "scenario_indicator_snapshots" ||
        table === "scenario_comparison_snapshots"
      ) {
        return {
          select: vi.fn(() => ({
            in: makeInResolver(null, schemaPendingError),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const supabase: ReportScenarioSupabaseLike = {
      from: fromMock as unknown as ReportScenarioSupabaseLike["from"],
    };

    const warnings: Array<{ source: string; message: string }> = [];
    const onSchemaPending: ReportScenarioSpineWarningHandler = (warning) => {
      warnings.push(warning);
    };

    const result = await loadReportScenarioSetLinks({
      supabase,
      linkedRuns: [{ id: "run-1", title: "Run 1", created_at: "2026-04-10T00:00:00.000Z" }],
      onSchemaPending,
    });

    expect(result.error).toBeNull();
    const sources = warnings.map((warning) => warning.source).sort();
    expect(sources).toEqual([
      "scenario_assumption_sets",
      "scenario_comparison_snapshots",
      "scenario_data_packages",
      "scenario_indicator_snapshots",
    ]);
    for (const warning of warnings) {
      expect(warning.message).toContain("schema cache");
    }
  });

  it("does not invoke onSchemaPending when the scenario spine tables resolve normally", async () => {
    const fromMock = vi.fn<(table: string) => { select: (query: string) => { in: unknown } }>((table) => {
      if (table === "scenario_entries") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              {
                id: "entry-1",
                scenario_set_id: "set-1",
                entry_type: "baseline",
                label: "Baseline",
                attached_run_id: "run-1",
                sort_order: 0,
                created_at: "2026-04-10T00:00:00.000Z",
                updated_at: "2026-04-10T00:00:00.000Z",
              },
            ]),
          })),
        };
      }
      if (table === "scenario_sets") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              {
                id: "set-1",
                title: "Set 1",
                baseline_entry_id: "entry-1",
                updated_at: "2026-04-10T00:00:00.000Z",
              },
            ]),
          })),
        };
      }
      if (table === "runs") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              { id: "run-1", title: "Run 1", created_at: "2026-04-10T00:00:00.000Z" },
            ]),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          in: makeInResolver([]),
        })),
      };
    });

    const supabase: ReportScenarioSupabaseLike = {
      from: fromMock as unknown as ReportScenarioSupabaseLike["from"],
    };

    const onSchemaPending = vi.fn();
    const result = await loadReportScenarioSetLinks({
      supabase,
      linkedRuns: [{ id: "run-1", title: "Run 1", created_at: "2026-04-10T00:00:00.000Z" }],
      onSchemaPending,
    });

    expect(result.error).toBeNull();
    expect(onSchemaPending).not.toHaveBeenCalled();
  });

  it("carries saved comparison snapshot source context into report scenario links without raw key leakage", async () => {
    const scenarioEntriesSelectMock = vi
      .fn()
      .mockReturnValueOnce({
        in: makeInResolver([
          {
            id: "entry-alt",
            scenario_set_id: "set-1",
            entry_type: "alternative",
            label: "Protected bike package",
            attached_run_id: "run-alt",
            sort_order: 1,
            created_at: "2026-04-10T00:00:00.000Z",
            updated_at: "2026-04-11T00:00:00.000Z",
          },
        ]),
      })
      .mockReturnValueOnce({
        in: makeInResolver([
          {
            id: "entry-baseline",
            scenario_set_id: "set-1",
            entry_type: "baseline",
            label: "Existing conditions",
            attached_run_id: "run-baseline",
            sort_order: 0,
            created_at: "2026-04-10T00:00:00.000Z",
            updated_at: "2026-04-10T00:00:00.000Z",
          },
          {
            id: "entry-alt",
            scenario_set_id: "set-1",
            entry_type: "alternative",
            label: "Protected bike package",
            attached_run_id: "run-alt",
            sort_order: 1,
            created_at: "2026-04-10T00:00:00.000Z",
            updated_at: "2026-04-11T00:00:00.000Z",
          },
        ]),
      });

    const comparisonSourceContext = {
      kind: "scenario_comparison_snapshot_source_context",
      pairingLabel: "Protected bike package compared against Existing conditions",
      pairing: {
        baselineEntryId: "entry-baseline",
        baselineEntryLabel: "Existing conditions",
        baselineRunId: "run-baseline",
        candidateEntryId: "entry-alt",
        candidateEntryLabel: "Protected bike package",
        candidateRunId: "run-alt",
      },
      sourceSummary:
        "Source context: attached run scorecards. No behavioral-onramp KPI rows are read by this board or snapshot helper.",
      baselineAssumptions: "Baseline: Horizon year: 2045",
      alternativeAssumptions: "Alternative: Project package: Protected bike network",
      caveatSummary:
        "Caveat posture: Planning analysis and evidence triage only; not a validated behavioral forecast. Screening-grade comparison only.",
      caveats: [
        "Planning analysis and evidence triage only; not a validated behavioral forecast.",
        "Screening-grade comparison only.",
      ],
      exportReadiness:
        "Export readiness: ready for a draft comparison packet when the report also carries these run links, assumptions, and caveats.",
      exportReady: true,
      evidenceLabels: ["Vehicle miles traveled"],
    };

    const fromMock = vi.fn<(table: string) => { select: (query: string) => { in: unknown } }>((table) => {
      if (table === "scenario_entries") {
        return { select: scenarioEntriesSelectMock };
      }
      if (table === "scenario_sets") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              {
                id: "set-1",
                title: "Set 1",
                baseline_entry_id: "entry-baseline",
                updated_at: "2026-04-10T00:00:00.000Z",
              },
            ]),
          })),
        };
      }
      if (table === "runs") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              { id: "run-baseline", title: "Baseline run", created_at: "2026-04-10T00:00:00.000Z" },
              { id: "run-alt", title: "Alternative run", created_at: "2026-04-11T00:00:00.000Z" },
            ]),
          })),
        };
      }
      if (table === "scenario_comparison_snapshots") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([
              {
                id: "snapshot-1",
                scenario_set_id: "set-1",
                baseline_entry_id: "entry-baseline",
                candidate_entry_id: "entry-alt",
                label: "Protected bike comparison",
                summary: "Alternative reduces VMT.",
                status: "ready",
                metadata_json: {
                  sourceContext: comparisonSourceContext,
                  internalSolverKey: "top-level metadata stays out of report sourceContext",
                },
                updated_at: "2026-04-12T00:00:00.000Z",
              },
            ]),
          })),
        };
      }
      if (table === "scenario_comparison_indicator_deltas") {
        return {
          select: vi.fn(() => ({
            in: makeInResolver([{ comparison_snapshot_id: "snapshot-1" }]),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          in: makeInResolver([]),
        })),
      };
    });

    const result = await loadReportScenarioSetLinks({
      supabase: { from: fromMock as unknown as ReportScenarioSupabaseLike["from"] },
      linkedRuns: [{ id: "run-alt", title: "Alternative run", created_at: "2026-04-11T00:00:00.000Z" }],
    });

    expect(result.error).toBeNull();
    const [snapshot] = result.data[0]?.comparisonSnapshots ?? [];
    expect(snapshot?.sourceContext).toMatchObject({
      pairingLabel: "Protected bike package compared against Existing conditions",
      caveatSummary: expect.stringContaining("Screening-grade comparison only"),
      exportReadiness: expect.stringContaining("ready for a draft comparison packet"),
    });
    const renderedContext = JSON.stringify(snapshot?.sourceContext);
    expect(renderedContext).toContain("No behavioral-onramp KPI rows");
    expect(renderedContext).not.toContain("internalSolverKey");
  });
});
