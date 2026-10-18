/** Blind category: pure source/fixture checks do not execute SQL, RLS or a browser. */
import { describe, it, expect } from "vitest";
import { buildSafetySeedPreview, buildSs4aSafetyDrafts, validateSafetySeedSource, SS4A_SECTION_KEYS } from "@/lib/grants/ss4a-safety-seed";
import { readSafetyPlanSnapshot, safetySeedHash } from "@/lib/reports/safety-plan-snapshot";
import { identifySeededCatalogKey } from "@/lib/grants/atp-packet";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { readSafetySeedOrigin, SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { safetySeedFixture, seedId } from "./fixtures/grants/safety-seed";
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
    const full = buildSafetySeedPreview(safetySeedFixture("kabco_full")).sections.find((s) => s.section_key === "safety-problem-and-impact")!.draft_markdown;
    expect(full).toContain("Serious-injury crashes: 0");
    const budget = preview.sections.find((s) => s.section_key === "budget-narrative")!.draft_markdown;
    expect(budget).toContain("No amounts, costs, currency or benefits have been inferred");
    expect(budget).not.toMatch(/\$\d|USD|80%|20%/);
    expect(preview).toEqual(buildSafetySeedPreview(rows));
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
