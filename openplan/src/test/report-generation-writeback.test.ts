import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { finishReportGeneration } from "@/lib/reports/generation-writeback";
import { artifactGenerationWritebackIsCurrent, resolveReportPacketRowFreshness, resolveTrackedReportSourceUpdatedAt } from "@/lib/reports/report-registry-freshness";
import { getReportPacketFreshness } from "@/lib/reports/catalog";

const BEFORE = "2026-10-17T12:00:00.000Z";
const GENERATED = "2026-10-17T12:00:10.000Z";
const WRITEBACK = "2026-10-17T12:00:11.000Z";
const EDITED = "2026-10-17T12:00:12.000Z";
const metadata = { sourceContext: { projectUpdatedAt: BEFORE } };
function fixture() {
  const reportRead = vi.fn().mockResolvedValue({ data: { updated_at: WRITEBACK }, error: null });
  const receiptRead = vi.fn().mockResolvedValue({ data: { id: "artifact" }, error: null });
  const report = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: reportRead };
  const artifact = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: receiptRead };
  for (const query of [report, artifact]) for (const method of [query.update, query.eq, query.select]) method.mockReturnValue(query);
  const from = vi.fn((table: string) => table === "reports" ? report : artifact);
  const input = { client: { from } as unknown as Pick<SupabaseClient, "from">, reportId: "report", reportUpdatedAt: BEFORE,
    artifactId: "artifact", artifactMetadata: metadata, update: { status: "generated", metadata_json: {} }, legacyUpdate: { status: "generated" } };
  return { input, from, report, artifact, reportRead, receiptRead };
}

describe("report generation writeback", () => {
  it("pins the report read and records the actual returned writeback on only its artifact", async () => {
    const f = fixture();
    expect(await finishReportGeneration(f.input)).toEqual({ error: null, status: 200 });
    expect(f.report.eq.mock.calls).toEqual([["id", "report"], ["updated_at", BEFORE]]);
    expect(f.report.select).toHaveBeenCalledWith("updated_at");
    expect(f.artifact.eq.mock.calls).toEqual([["id", "artifact"], ["report_id", "report"]]);
    expect(f.artifact.select).toHaveBeenCalledWith("id");
    expect(f.artifact.update).toHaveBeenCalledWith({ metadata_json: { ...metadata,
      generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: WRITEBACK } } });
  });
  it("refuses a concurrent report edit before recording a writeback", async () => {
    const f = fixture(); f.reportRead.mockResolvedValue({ data: null, error: null });
    expect(await finishReportGeneration(f.input)).toMatchObject({ status: 409, error: { code: "report_changed_during_generation" } });
    expect(f.artifact.update).not.toHaveBeenCalled();
  });
  it("retains a report permission error without retry or receipt", async () => {
    const f = fixture(); const error = { message: "permission denied", code: "42501" };
    f.reportRead.mockResolvedValue({ data: null, error });
    expect(await finishReportGeneration(f.input)).toEqual({ status: 500, error });
    expect(f.report.update).toHaveBeenCalledTimes(1); expect(f.artifact.update).not.toHaveBeenCalled();
  });
  it("refuses an unreadable returned revision", async () => {
    const f = fixture(); f.reportRead.mockResolvedValue({ data: { updated_at: "invalid" }, error: null });
    expect(await finishReportGeneration(f.input)).toMatchObject({ status: 500 });
    expect(f.artifact.update).not.toHaveBeenCalled();
  });
  it.each([null, { message: "receipt write denied", code: "42501" }])("refuses missing or failed receipt persistence: %j", async (error) => {
    const f = fixture(); f.receiptRead.mockResolvedValue({ data: null, error });
    expect(await finishReportGeneration(f.input)).toMatchObject({ status: 500 });
  });
  it("keeps the same revision predicate during the existing pending-column fallback", async () => {
    const f = fixture(); f.reportRead.mockResolvedValueOnce({ data: null, error: { message: 'column reports.rtp_basis_stale does not exist', code: '42703' } });
    expect(await finishReportGeneration(f.input)).toEqual({ status: 200, error: null });
    expect(f.report.update.mock.calls).toEqual([[f.input.update], [f.input.legacyUpdate]]);
    expect(f.report.eq.mock.calls).toEqual([["id", "report"], ["updated_at", BEFORE], ["id", "report"], ["updated_at", BEFORE]]);
  });
});

describe("exact writeback freshness", () => {
  const input = { generatedAt: GENERATED, reportUpdatedAt: WRITEBACK, cycleUpdatedAt: null,
    artifactMetadata: { ...metadata, generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: WRITEBACK } } };
  it("keeps the packet current after its own writeback", () => {
    expect(resolveReportPacketRowFreshness({ latest_artifact_kind: "pdf", generated_at: GENERATED, updated_at: WRITEBACK },
      { generated_at: GENERATED, metadata_json: input.artifactMetadata }).label).toBe("Packet current");
  });
  it("marks a real edit stale immediately, even one second after writeback", () => {
    expect(resolveReportPacketRowFreshness({ latest_artifact_kind: "pdf", generated_at: GENERATED, updated_at: EDITED },
      { generated_at: GENERATED, metadata_json: input.artifactMetadata }).label).toBe("Refresh recommended");
  });
  it("still marks a changed tracked source stale", () => {
    expect(resolveTrackedReportSourceUpdatedAt({ ...input, safetyUpdatedAt: EDITED })).toBe(EDITED);
  });
  it("does not trust an unknown writeback schema", () => {
    expect(resolveTrackedReportSourceUpdatedAt({ ...input, artifactMetadata: { ...metadata,
      generationWriteback: { schema: "unreviewed", reportUpdatedAt: WRITEBACK } } })).toBe(WRITEBACK);
  });
});

it.each([null, false, { schema: "unknown", reportUpdatedAt: WRITEBACK }, { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: "invalid" }])("keeps pending or malformed writeback non-current: %j", (receipt) => {
  const recorded = artifactGenerationWritebackIsCurrent({ generationWriteback: receipt }, WRITEBACK);
  expect(recorded).toBe(false);
  expect(getReportPacketFreshness({ latestArtifactKind: "pdf", generatedAt: GENERATED, updatedAt: BEFORE,
    generationWritebackCurrent: recorded }).label).toBe("Refresh recommended");
});

it("distinguishes legacy artifacts from completed generation receipts", () => {
  expect(artifactGenerationWritebackIsCurrent({}, WRITEBACK)).toBeUndefined();
  expect(artifactGenerationWritebackIsCurrent({ generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: WRITEBACK } }, WRITEBACK)).toBe(true);
});

it.each([BEFORE, EDITED, null, "invalid"])("does not call a different report revision current: %s", (revision) => {
  const current = artifactGenerationWritebackIsCurrent({ generationWriteback: {
    schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: WRITEBACK,
  } }, revision);
  expect(current).toBe(false);
  expect(getReportPacketFreshness({ latestArtifactKind: "pdf", generatedAt: GENERATED, updatedAt: revision,
    generationWritebackCurrent: current }).label).toBe("Refresh recommended");
});

it("treats a mismatched older timestamp as changed in the row adapter", () => {
  expect(resolveReportPacketRowFreshness({ latest_artifact_kind: "pdf", generated_at: GENERATED, updated_at: BEFORE },
    { generated_at: GENERATED, metadata_json: { sourceContext: { projectUpdatedAt: BEFORE }, generationWriteback: {
      schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: WRITEBACK,
    } } }).label).toBe("Refresh recommended");
});


it("preserves the overview's legacy edit warning without inventing a writeback", () => {
  expect(resolveReportPacketRowFreshness({ latest_artifact_kind: "pdf", generated_at: GENERATED, updated_at: EDITED },
    { generated_at: GENERATED, metadata_json: metadata }).label).toBe("Refresh recommended");
});
