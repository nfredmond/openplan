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
});
