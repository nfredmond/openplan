import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeRefreshJobStatus } from "@/lib/data-sources/refresh-log";
import { buildReportRefreshLogNote } from "@/lib/reports/data-lineage-output-contexts";

describe("describeRefreshJobStatus", () => {
  it("covers every status value the data_refresh_jobs CHECK constraint admits", () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20260313000014_data_hub_module.sql"),
      "utf8"
    );
    const checkMatch = migration.match(
      /status TEXT NOT NULL DEFAULT 'queued' CHECK \(\s*status IN \(([^)]+)\)/
    );
    expect(checkMatch).not.toBeNull();
    const statuses = [...checkMatch![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(statuses).toEqual(["queued", "running", "succeeded", "failed", "cancelled"]);

    for (const status of statuses) {
      const descriptor = describeRefreshJobStatus(status);
      // Every stored status renders as recorded state, never as orchestrated work.
      expect(descriptor.label, status).toMatch(/^Recorded/);
      expect(descriptor.caveat.length, status).toBeGreaterThan(0);
    }
  });

  it("renders queued as a record with no runner attached", () => {
    const descriptor = describeRefreshJobStatus("queued");
    expect(descriptor.label).toBe("Recorded — no runner attached");
    expect(descriptor.tone).toBe("neutral");
    expect(descriptor.caveat).toMatch(/No background runner executes queued refresh jobs/);
  });

  it("renders running as operator-reported progress", () => {
    const descriptor = describeRefreshJobStatus("running");
    expect(descriptor.label).toBe("Recorded as in progress");
    expect(descriptor.tone).toBe("info");
    expect(descriptor.caveat).toMatch(/does not orchestrate or monitor/);
  });

  it("renders succeeded as recorded completion, not an execution claim", () => {
    const descriptor = describeRefreshJobStatus("succeeded");
    expect(descriptor.label).toBe("Recorded as completed");
    expect(descriptor.tone).toBe("success");
    expect(descriptor.caveat).toMatch(/OpenPlan did not execute it/);
  });

  it("renders failed and cancelled as reported outcomes", () => {
    const failed = describeRefreshJobStatus("failed");
    expect(failed.label).toBe("Recorded as failed");
    expect(failed.tone).toBe("danger");

    const cancelled = describeRefreshJobStatus("cancelled");
    expect(cancelled.label).toBe("Recorded as cancelled");
    expect(cancelled.tone).toBe("warning");
  });

  it("treats an unknown or missing status as documentation", () => {
    for (const status of ["archived", "", null, undefined]) {
      const descriptor = describeRefreshJobStatus(status);
      expect(descriptor.label).toBe("Recorded — status unknown");
      expect(descriptor.tone).toBe("neutral");
    }
  });

  it("appends a scheduled-mode note that denies a scheduler exists", () => {
    const descriptor = describeRefreshJobStatus("queued", "scheduled");
    expect(descriptor.caveat).toMatch(/OpenPlan runs no scheduler/);
  });

  it("leaves the caveat alone for an unknown refresh mode", () => {
    const plain = describeRefreshJobStatus("queued");
    const withMode = describeRefreshJobStatus("queued", "somehow_else");
    expect(withMode.caveat).toBe(plain.caveat);
  });
});

describe("buildReportRefreshLogNote", () => {
  it("returns null when the latest entries per dataset are terminal", () => {
    expect(
      buildReportRefreshLogNote([
        {
          dataset_id: "dataset-1",
          status: "succeeded",
          started_at: null,
          completed_at: "2026-03-28T13:00:00.000Z",
          created_at: "2026-03-28T12:45:00.000Z",
        },
        {
          dataset_id: "dataset-1",
          // Older queued row: superseded by the newer succeeded entry above.
          status: "queued",
          started_at: null,
          completed_at: null,
          created_at: "2026-03-27T12:45:00.000Z",
        },
      ])
    ).toBeNull();
  });

  it("frames a queued latest entry as recorded, not orchestrated", () => {
    const note = buildReportRefreshLogNote([
      {
        dataset_id: "dataset-1",
        status: "queued",
        refresh_mode: "manual",
        started_at: null,
        completed_at: null,
        created_at: "2026-03-28T12:45:00.000Z",
      },
    ]);

    expect(note).toMatch(/Recorded — no runner attached/);
    expect(note).toMatch(/No background runner executes queued refresh jobs/);
  });

  it("returns null for an empty log", () => {
    expect(buildReportRefreshLogNote([])).toBeNull();
  });
});
