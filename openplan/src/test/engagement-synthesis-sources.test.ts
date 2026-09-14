import { describe, expect, it, vi } from "vitest";
import { synthesisSourceSelectionSchema, type SynthesisSourceSnapshot } from "@/lib/engagement/synthesis-sources";
import { loadSynthesisSource, verifySynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { makeSourceSnapshot, savedSource, sourceScope, sourceCategory, sourceHash } from "./fixtures/engagement/synthesis-source";

describe("retained synthesis source verification", () => {
  it("retains the entire 301-source record, long text, survey values and historical definitions", () => {
    const saved = savedSource();
    const verified = verifySynthesisSource(saved, sourceScope);
    expect(verified.snapshotText).toBe(saved.snapshotText);
    expect(verified.snapshot.items).toHaveLength(301);
    expect(verified.snapshot.items[300].body).toMatch(/FINAL SOURCE TAIL$/);
    expect(verified.snapshot.items[300].body.length).toBeGreaterThan(600);
    expect(verified.snapshot.items[0].geometry).toEqual({ type: "LineString", coordinates: [[12.5, -8.25], [12.75, -8.5]] });
    expect(verified.snapshot.answers[0].answer_json).toEqual({ text: "SYNTHETIC distinct survey concern", missing: null });
    expect(verified.definitions[0].definition.categories[0].label).toBe("SYNTHETIC retained category");
  });
  it("preserves a declared empty selection and missing legacy definitions without inventing history", () => {
    const snapshot = makeSourceSnapshot(0);
    snapshot.sessions[0].configuration_version_id = null;
    snapshot.campaign.configurationVersionId = null;
    snapshot.definitions = [];
    snapshot.answers[0].question_id = null;
    const verified = verifySynthesisSource(savedSource(snapshot), sourceScope);
    expect(verified.snapshot.items).toEqual([]);
    expect(verified.snapshot.sessions[0].configuration_version_id).toBeNull();
    expect(verified.definitions).toEqual([]);
  });
  it("preserves a legacy item with no historical definition", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].configuration_version_id = null;
    expect(verifySynthesisSource(savedSource(snapshot), sourceScope).snapshot.items[0].configuration_version_id).toBeNull();
  });
  it("refuses duplicate category identities inside a validly hashed historical definition", () => {
    const snapshot = makeSourceSnapshot(1);
    const definition = JSON.parse(snapshot.definitions[0].definitionText);
    definition.categories.push(definition.categories[0]);
    snapshot.definitions[0].definitionText = JSON.stringify(definition);
    snapshot.definitions[0].sha256 = sourceHash(snapshot.definitions[0].definitionText);
    expect(() => verifySynthesisSource(savedSource(snapshot), sourceScope)).toThrow("Duplicate historical definition");
  });
  it("allows a historical category selection that matches comments and the saved survey definition", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.selection.categoryIds = [sourceCategory];
    expect(verifySynthesisSource(savedSource(snapshot), sourceScope).snapshot.answers).toHaveLength(1);
  });
  it("refuses changed bytes even when the content would still parse", () => {
    const saved = savedSource();
    expect(() => verifySynthesisSource({ ...saved, snapshotText: saved.snapshotText + " " }, sourceScope)).toThrow("checksum differs");
  });
  it("refuses a receipt from a different workspace", () => {
    expect(() => verifySynthesisSource({ ...savedSource(), workspaceId: sourceScope.requestId }, sourceScope)).toThrow("scope differs");
  });
  const failures: Array<[string, (snapshot: SynthesisSourceSnapshot) => void, string]> = [
    ["inner workspace", s => { s.workspaceId = sourceScope.requestId; }, "scope differs"],
    ["campaign owner", s => { s.campaign.id = sourceScope.requestId; }, "scope differs"],
    ["missing counted source", s => { s.items.pop(); }, "counts differ"],
    ["campaign total smaller than selection", s => { s.counts.campaignItems = 0; }, "counts differ"],
    ["duplicate source", s => { s.items[1] = s.items[0]; }, "Duplicate retained"],
    ["excluded comment kind", s => { s.selection.includeItems = false; }, "selection differs"],
    ["another campaign source", s => { s.items[0].campaign_id = sourceScope.requestId; }, "another campaign"],
    ["unexpected private contact", s => { s.items[0].submitted_by = "SYNTHETIC contact"; }, "contact or request metadata"],
    ["out-of-scope status", s => { s.items[0].status = "pending"; }, "outside selection"],
    ["out-of-scope date", s => { s.selection.from = "2100-01-01T00:00:00Z"; }, "outside selection"],
    ["missing session", s => { s.answers[0].session_id = sourceScope.requestId; }, "session is missing"],
    ["lost definition", s => { s.definitions = []; }, "definition is missing"],
    ["changed historical bytes", s => { s.definitions[0].definitionText += " "; }, "definition checksum"],
    ["foreign definition", s => { s.definitions[0].campaignId = sourceScope.requestId; }, "definition checksum or scope"],
    ["unselected category", s => { s.selection.categoryIds = [sourceScope.requestId]; }, "item category"],
    ["missing selected question", s => { s.selection.categoryIds = [sourceCategory]; s.answers[0].question_id = null; }, "answer category"],
  ];
  it.each(failures)("refuses %s even with a matching outer hash", (_name, change, message) => {
    const snapshot = makeSourceSnapshot(2); change(snapshot);
    expect(() => verifySynthesisSource(savedSource(snapshot), sourceScope)).toThrow(message);
  });
  it("refuses unknown/duplicate/empty selection and inverted dates", () => {
    const selection = makeSourceSnapshot(0).selection;
    for (const change of [{ statuses: [] }, { statuses: ["approved", "approved"] }, { includeItems: false, includeSurveys: false }, { unexpected: true }, { from: "2026-02-02T00:00:00Z", to: "2026-01-01T00:00:00Z" }]) {
      expect(synthesisSourceSelectionSchema.safeParse({ ...selection, ...change }).success).toBe(false);
    }
    expect(synthesisSourceSelectionSchema.safeParse(selection).success).toBe(true);
  });
  it("loads through the scoped RPC and refuses a failed read instead of returning no sources", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: savedSource(), error: null }).mockResolvedValueOnce({ data: null, error: { message: "SYNTHETIC unavailable" } });
    expect((await loadSynthesisSource({ rpc }, sourceScope)).snapshot.items).toHaveLength(301);
    expect(rpc).toHaveBeenCalledWith("read_engagement_synthesis_sources", { p_campaign: sourceScope.campaignId, p_request: sourceScope.requestId });
    await expect(loadSynthesisSource({ rpc }, sourceScope)).rejects.toThrow("unavailable");
  });
});

// The list must preserve its scope and carry a cursor for the last complete page.
describe("saved source list parsing", () => {
  it("accepts an empty page and a complete page with matching continuation", async () => {
    const { synthesisSourceListSchema } = await import("@/lib/engagement/synthesis-sources");
    const snapshot = makeSourceSnapshot();
    const entry = { requestId: snapshot.requestId, campaignId: snapshot.campaignId, workspaceId: snapshot.workspaceId, createdAt: snapshot.capturedAt, snapshotSha256: "a".repeat(64), counts: snapshot.counts, selection: snapshot.selection };
    const base = { campaignId: snapshot.campaignId, workspaceId: snapshot.workspaceId, pageSize: 25, entries: [], nextCursor: null };
    expect(synthesisSourceListSchema.parse(base)).toEqual(base);
    const entries = Array.from({ length: 25 }, (_, i) => ({ ...entry, requestId: `f0000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    const page = { ...base, entries, nextCursor: { id: entries[24].requestId, createdAt: entry.createdAt } };
    expect(synthesisSourceListSchema.parse(page)).toEqual(page);
    for (const broken of [
      { ...page, entries: [entry, entry], nextCursor: null },
      { ...page, entries: [{ ...entry, workspaceId: crypto.randomUUID() }], nextCursor: null },
      { ...page, nextCursor: { ...page.nextCursor, id: entry.requestId } },
      { ...page, entries: entries.slice(0, 24) },
    ]) expect(synthesisSourceListSchema.safeParse(broken).success).toBe(false);
  });
});
