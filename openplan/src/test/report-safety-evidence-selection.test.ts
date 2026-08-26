import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadReportSafetyIngestOptions } from "@/lib/reports/safety-evidence-selection";

describe("report Safety evidence choices", () => {
  it("loads ready acquisitions through both workspace and project guards", async () => {
    const calls: Array<[string, unknown]> = [];
    const result = {
      data: [{
        id: "ingest-1",
        source_label: null,
        created_at: "2026-08-26T10:00:00.000Z",
        crash_count: 390,
        geocoded_count: 388,
      }],
      error: null,
    };
    const builder: Record<string, unknown> = {};
    builder.eq = vi.fn((column: string, value: unknown) => {
      calls.push([column, value]);
      return builder;
    });
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(async () => result);
    const supabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe("safety_crash_ingests");
        return { select: vi.fn(() => builder) };
      }),
    } as unknown as SupabaseClient;

    const loaded = await loadReportSafetyIngestOptions(supabase, "workspace-1", "project-1");

    expect(calls).toEqual([
      ["workspace_id", "workspace-1"],
      ["project_id", "project-1"],
      ["status", "ready"],
    ]);
    expect(loaded).toEqual({
      data: [{
        id: "ingest-1",
        sourceLabel: "Crash acquisition",
        createdAt: "2026-08-26T10:00:00.000Z",
        crashCount: 390,
        geocodedCount: 388,
      }],
      error: null,
    });
  });
});
