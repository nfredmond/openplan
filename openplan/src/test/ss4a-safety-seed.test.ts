/** Blind category: pure source/fixture checks do not execute SQL, RLS or a browser. */
import { describe, it, expect } from "vitest";
import { buildSafetySeedPreview, buildSs4aSafetyDrafts, validateSafetySeedSource, SS4A_SECTION_KEYS } from "@/lib/grants/ss4a-safety-seed";
import { readSafetyPlanEvidenceFence, readSafetyPlanSnapshot, safetyProjectPlaceHash, safetySeedHash, SAFETY_PLAN_FENCE_INGEST_SELECT, type SafetyPlanFenceClient } from "@/lib/reports/safety-plan-snapshot";
import { identifySeededCatalogKey } from "@/lib/grants/atp-packet";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { readSafetySeedOrigin, SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { safetySeedFixture, seedId, SEED_PROJECT_PLACE } from "./fixtures/grants/safety-seed";
import { parseApplicationSectionRow, parseApplicationAttachmentRow } from "@/lib/grants/application";

describe("Safety snapshot and deterministic SS4A seed", () => {
  it("binds the exact builder output, identity and complete acquisition projection with a stable hash", () => {
    const rows = safetySeedFixture();
    const snapshot = validateSafetySeedSource(rows);
    expect(readSafetyPlanSnapshot(snapshot)).toEqual(snapshot);
    expect(safetySeedHash({ b: 1, a: 2 })).toBe(safetySeedHash({ a: 2, b: 1 }));
    const broken = structuredClone(snapshot); broken.draft.draftNotice = "Changed";
    expect(readSafetyPlanSnapshot(broken)).toBeNull();
    const { source_label: omitted, ...incomplete } = snapshot.acquisition;
    expect(omitted).toBe("Recorded crash source");
    expect(readSafetyPlanSnapshot({ ...snapshot, acquisition: incomplete })).toBeNull();
    expect(readSafetyPlanSnapshot({ ...snapshot, draft: { ...snapshot.draft, treatments: "malformed" } })).toBeNull();
  });
  it("uses all six exact catalog keys and refuses ambiguous/custom/proposal/other identities", () => {
    const rows = safetySeedFixture();
    expect(identifySeededCatalogKey(rows.sections)).toBe("ss4a");
    expect(buildSafetySeedPreview(rows).sections.map((s) => s.section_key)).toEqual(SS4A_SECTION_KEYS);
    for (const mutation of [
      () => { rows.sections.forEach((s) => s.source = "custom"); },
      () => { rows.sections = rows.sections.filter((s) => s.section_key === "budget-narrative"); },
      () => { rows.opportunity.pursuit_kind = "proposal"; },
      () => { rows.sections[0].section_key = "not-ss4a"; },
    ]) {
      const clean = structuredClone(rows); mutation(); expect(() => validateSafetySeedSource(rows)).toThrow(); Object.assign(rows, clean);
    }
    for (const entry of GRANT_PROGRAM_CATALOG.filter((p) => p.key !== "ss4a" && p.applicationSections?.length)) {
      expect(() => validateSafetySeedSource({ ...rows, sections: entry.applicationSections!.map((s) => ({ ...rows.sections[0], section_key: s.key })) })).toThrow();
    }
  });
  it.each(["workspace", "project", "acquisition", "not-ready", "legacy", "malformed", "source-changed", "unfinished-generation"])("refuses %s sources", (kind) => {
    const rows = safetySeedFixture();
    if (kind === "workspace") rows.report.workspace_id = seedId(90);
    if (kind === "project") rows.report.project_id = seedId(90);
    if (kind === "acquisition") rows.acquisition.id = seedId(90);
    if (kind === "not-ready") rows.acquisition.status = "failed";
    if (kind === "legacy") rows.artifact.metadata_json = { htmlContent: "<h1>Safety plan</h1>" };
    if (kind === "malformed") rows.artifact.metadata_json.safetyPlanSnapshotV1 = { version: 1 };
    if (kind === "source-changed") rows.acquisition.crash_count = 1;
    if (kind === "unfinished-generation") rows.artifact.metadata_json.generationWriteback = null;
    expect(() => validateSafetySeedSource(rows)).toThrow();
  });
  it("keeps fatal-only unknown injury coverage distinct from measured zero and retains unranked candidates without invented money", () => {
    const rows = safetySeedFixture();
    const preview = buildSafetySeedPreview(rows);
    const safety = preview.sections.find((s) => s.section_key === "safety-problem-and-impact")!.draft_markdown;
    expect(safety).toContain("Fatal crashes: 0");
    expect(safety).toContain("Serious-injury crashes: not measured or unavailable");
    expect(safety).toContain("unranked; not in the frozen ranked network");
    expect(safety).toContain("Road");
    expect(safety).toContain("CMF");
    expect(safety).not.toMatch(/CMF [0-9]+\.[0-9]+/);
    expect(safety).toContain("Snapshot component gaps, not findings of agency absence");
    // Plain sentences for a reviewer: no doubled periods, no unit on a missing
    // length, no internal status codes.
    expect(safety).not.toMatch(/\.\.(\s|$)/);
    expect(safety).not.toContain("not measured miles");
    expect(safety).not.toMatch(/not_covered|\(partial in/);
    const full = buildSafetySeedPreview(safetySeedFixture("kabco_full")).sections.find((s) => s.section_key === "safety-problem-and-impact")!.draft_markdown;
    expect(full).toContain("Serious-injury crashes: 0");
    const budget = preview.sections.find((s) => s.section_key === "budget-narrative")!.draft_markdown;
    expect(budget).toContain("No amounts, costs, currency or benefits have been inferred");
    expect(budget).not.toMatch(/\$\d|USD|80%|20%/);
    expect(preview).toEqual(buildSafetySeedPreview(rows));
  });
  it("states a grid square's missing length without a unit", () => {
    const rows = safetySeedFixture(); const snapshot = validateSafetySeedSource(rows);
    const gridded = structuredClone(snapshot);
    gridded.draft.network = {
      kind: "computed", measureLabel: "Fatal crashes per half-mile square (fatal crashes only)", method: "Grid.", coverage: "1 of 1.", years: "Requested crash years: 2024", sourceLine: "Source: Recorded crash source.",
      rows: [{ rank: 1, tied: false, segmentId: "grid:1:2", label: "Half-mile square at 40.1, -115.2", lengthMiles: null, crashCount: 1, fatalCrashCount: 1, seriousInjuryCrashCount: null, crashesPerMile: null, countermeasureNames: [] }],
    };
    const safety = buildSs4aSafetyDrafts(gridded, rows.project.name).find((s) => s.section_key === "safety-problem-and-impact")!.draft_markdown;
    expect(safety).toContain("length not measured; crashes per mile not measured.");
    expect(safety).not.toContain("not measured miles");
  });
  it("binds source revisions, every prior draft and concurrent final text without modifying either", () => {
    const rows = safetySeedFixture(); const before = structuredClone(rows);
    const preview = buildSafetySeedPreview(rows);
    expect(rows).toEqual(before);
    rows.sections[0].final_markdown = "Concurrent operator revision";
    expect(buildSafetySeedPreview(rows).previewHash).not.toBe(preview.previewHash);
    Object.assign(rows, structuredClone(before)); rows.drafts.push({ id: seedId(60), section_id: seedId(11) });
    expect(buildSafetySeedPreview(rows).previewHash).not.toBe(preview.previewHash);
    Object.assign(rows, structuredClone(before)); rows.report.updated_at = "2026-10-18T13:00:00Z";
    expect(() => buildSafetySeedPreview(rows)).toThrow(/changed/);
  });
  it("labels protected code origin separately from AI and retains qualifications in an operator-edited export without completing attachments", () => {
    const rows = safetySeedFixture(); const snapshot = validateSafetySeedSource(rows);
    const provenance = buildSs4aSafetyDrafts(snapshot, rows.project.name)[0].provenance;
    expect(readSafetySeedOrigin({ origin: "ai", grounding_json: provenance, safety_seed_id: seedId(70) })).toBeNull();
    expect(readSafetySeedOrigin({ origin: "safety_plan_seed", grounding_json: provenance, safety_seed_id: seedId(70) })).toEqual(provenance);
    expect(readSafetySeedOrigin({ origin: "safety_plan_seed", grounding_json: {}, safety_seed_id: seedId(70) })).toBeNull();
    const section = parseApplicationSectionRow({ ...rows.sections[0], title: "Overview", status: "final", final_markdown: "Operator edits", sort_order: 0, ai_drafting_enabled: true })!;
    const attachment = parseApplicationAttachmentRow({ id: seedId(80), workspace_id: rows.project.workspace_id, opportunity_id: rows.opportunity.id, attachment_key: "action-plan", title: "Action plan", required: true, status: "missing" })!;
    const html = buildGrantApplicationHtml({ opportunity: { id: rows.opportunity.id, title: "SS4A", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null }, programTitle: null, sections: [{ section, provenance: { origin: "safety_seed_operator_edited", model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: seedId(99), finalizedAt: null, safetySeed: provenance } }], attachments: [attachment], generatedAt: snapshot.generatedAt, safetySeedHistory: [provenance] });
    expect(html).toContain("Code-built Safety seed, operator-edited"); expect(html).toContain("1 required attachment(s) outstanding");
    expect(html).toContain(provenance.snapshotHash); expect(html).toContain(provenance.acquisitionId);
    expect(html).toContain(SAFETY_SEED_CAVEAT); expect(html).toContain("Missing coverage is not zero");
    expect(attachment.status).toBe("missing");
  });
});

// KI-2026-11-02-022: logging or exporting a linked funding opportunity moves
// projects.updated_at (an aggregate bundle revision), which made the first seed
// after it refuse a current Safety report.
describe("Safety seed staleness follows the Safety evidence, not every project write", () => {
  const LATER = "2026-10-18T12:05:00.000001+00:00";
  it("seeds a fenced report after a write outside Safety moved the project revision", () => {
    const rows = safetySeedFixture("fatal_only", { fenced: true });
    rows.project.updated_at = LATER; rows.project.name = "Renamed project";
    expect(rows.persistence.persisted_project_updated_at).not.toBe(LATER);
    expect(() => validateSafetySeedSource(rows)).not.toThrow();
    expect(buildSafetySeedPreview(rows).sections[0].draft_markdown).toContain("Working draft for Renamed project.");
  });
  it.each([
    ["a crash or party write moved the acquisition's evidence revision", (rows: ReturnType<typeof safetySeedFixture>) => { rows.acquisition.evidence_revision = 8; }],
    ["the evidence revision was not read", (rows: ReturnType<typeof safetySeedFixture>) => { delete rows.acquisition.evidence_revision; }],
    ["the project place changed", (rows: ReturnType<typeof safetySeedFixture>) => { rows.project.place_label = "Another city"; rows.project.place_set_at = LATER; }],
    ["only the place timestamp changed", (rows: ReturnType<typeof safetySeedFixture>) => { rows.project.place_set_at = LATER; }],
    ["a place column was not read", (rows: ReturnType<typeof safetySeedFixture>) => { delete rows.project.place_ref; }],
  ])("refuses a fenced report when %s", (_label, mutate) => {
    const rows = safetySeedFixture("fatal_only", { fenced: true });
    mutate(rows);
    expect(() => validateSafetySeedSource(rows)).toThrow(/crash records or project place .* changed/);
  });
  it("still refuses a fenced report whose frozen acquisition columns changed", () => {
    const rows = safetySeedFixture("fatal_only", { fenced: true });
    rows.acquisition.stored_count = 3;
    expect(() => validateSafetySeedSource(rows)).toThrow(/Safety source changed/);
  });
  it("keeps the aggregate project check for a retained snapshot without a fence", () => {
    const rows = safetySeedFixture();
    expect(readSafetyArtifactFence(rows)).toBeUndefined();
    expect(() => validateSafetySeedSource(rows)).not.toThrow();
    rows.project.updated_at = LATER;
    expect(() => validateSafetySeedSource(rows)).toThrow(/custody.*stale/);
  });
  it("binds the fence into the snapshot hash", () => {
    const snapshot = validateSafetySeedSource(safetySeedFixture("fatal_only", { fenced: true }));
    expect(snapshot.evidenceFence).toEqual({ acquisitionEvidenceRevision: "7", projectPlaceHash: safetyProjectPlaceHash(SEED_PROJECT_PLACE) });
    expect(readSafetyPlanSnapshot({ ...snapshot, evidenceFence: { ...snapshot.evidenceFence!, acquisitionEvidenceRevision: "8" } })).toBeNull();
    const { evidenceFence: _dropped, ...unfenced } = snapshot;
    expect(readSafetyPlanSnapshot(unfenced)).toBeNull();
  });
});

describe("generation reads the evidence fence", () => {
  const ingestId = seedId(6);
  function client(result: { data: unknown; error: unknown } | "throw") {
    const calls: { select: string[]; eq: Array<[string, string]> } = { select: [], eq: [] };
    const query = {
      eq(column: string, value: string) { calls.eq.push([column, value]); return query; },
      maybeSingle: async () => { if (result === "throw") throw new Error("connection lost"); return result; },
    };
    const fake: SafetyPlanFenceClient = { from: () => ({ select: (columns: string) => { calls.select.push(columns); return query; } }) };
    return { fake, calls };
  }
  const input = { workspaceId: seedId(1), projectId: seedId(2), ingestId, project: SEED_PROJECT_PLACE };
  it("records the acquisition revision and the place hash from scoped reads", async () => {
    const { fake, calls } = client({ data: { id: ingestId, evidence_revision: 41 }, error: null });
    expect(await readSafetyPlanEvidenceFence(fake, input)).toEqual({ acquisitionEvidenceRevision: "41", projectPlaceHash: safetyProjectPlaceHash(SEED_PROJECT_PLACE) });
    expect(calls.select).toEqual([SAFETY_PLAN_FENCE_INGEST_SELECT]);
    expect(SAFETY_PLAN_FENCE_INGEST_SELECT).toBe("id, evidence_revision");
    expect(calls.eq).toEqual([["workspace_id", seedId(1)], ["project_id", seedId(2)], ["id", ingestId]]);
  });
  it.each([
    ["the read failed", { data: null, error: { message: "column safety_crash_ingests.evidence_revision does not exist" } }],
    ["the read reported an error beside a row", { data: { id: ingestId, evidence_revision: 41 }, error: { message: "partial response" } }],
    ["another row came back", { data: { id: seedId(90), evidence_revision: 41 }, error: null }],
    ["the revision is not a positive integer", { data: { id: ingestId, evidence_revision: 0 }, error: null }],
    ["the connection dropped", "throw" as const],
  ])("records no fence when %s", async (_label, result) => {
    expect(await readSafetyPlanEvidenceFence(client(result).fake, input)).toBeNull();
  });
  it("records no fence when the project place was not read", async () => {
    const { place_set_at: _omitted, ...narrow } = SEED_PROJECT_PLACE;
    const { fake, calls } = client({ data: { id: ingestId, evidence_revision: 41 }, error: null });
    expect(await readSafetyPlanEvidenceFence(fake, { ...input, project: narrow })).toBeNull();
    expect(calls.select).toEqual([]);
  });
});

function readSafetyArtifactFence(rows: ReturnType<typeof safetySeedFixture>) {
  return readSafetyPlanSnapshot(rows.artifact.metadata_json.safetyPlanSnapshotV1)?.evidenceFence;
}
