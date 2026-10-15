import { describe, expect, it, vi } from "vitest";
import { type JurisdictionEntryInput, jurisdictionDraft, projectJurisdictionInputSchema, readProjectJurisdiction, resolveProjectJurisdiction } from "@/lib/projects/project-jurisdiction";
import { buildProjectJurisdictionReadinessPayload, buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { buildJurisdictionReadinessEvidenceFile } from "@/lib/jurisdiction-readiness/evidence-bundle";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { createHash } from "node:crypto";
import { decisionPackageFreshness } from "@/lib/project-evidence-bundles/decision-package-readiness";

const actor = "22222222-2222-4222-8222-222222222222";
const revision = "2026-10-15T00:00:00.000Z";
const hash = "a".repeat(64);
const staff = { mode: "staff" as const, label: "Declared context", kind: "source:region", reference: "agency:region-1", countryCode: "US", subdivisionCode: "CA", scope: "administrative" as const };
const boundary = { kind: "county" as const, geoid: "06045", label: "Resolved county", bbox: { minLon: -124, minLat: 39, maxLon: -123, maxLat: 40 }, geojson: { type: "Polygon" as const, coordinates: [[[-124, 39], [-123, 39], [-123, 40], [-124, 39]]] } };
async function context(entries: JurisdictionEntryInput[] = [staff]) { return resolveProjectJurisdiction({ version: 1, state: "declared", entries }, actor, vi.fn()); }

describe("independent project jurisdiction", () => {
  it("bounds and strictly validates declaration metadata and client provenance", () => {
    const valid = { version: 1, state: "declared", entries: [staff] };
    expect(projectJurisdictionInputSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [{ ...valid, recordedBy: actor }, { ...valid, entries: [{ ...staff, identity: "server_resolved" }] }, { ...valid, entries: [{ ...staff, geometry: boundary.geojson }] }, { ...valid, entries: Array(13).fill(staff) }, { ...valid, entries: [] }, { ...valid, entries: [{ ...staff, reference: "not-namespaced" }] }, { ...valid, entries: [{ ...staff, countryCode: "USA" }] }, { version: 1, state: "unresolved", entries: [staff] }]) {
      expect(projectJurisdictionInputSchema.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
  });
  it("resolves exact supported identity without copying geometry", async () => {
    const before = Date.now();
    const resolve = vi.fn().mockResolvedValue(boundary);
    const value = await resolveProjectJurisdiction({ version: 1, state: "declared", entries: [{ mode: "resolved", kind: "county", geoid: "06045" }] }, actor, resolve);
    expect(resolve).toHaveBeenCalledWith("county", "06045");
    expect(value.entries).toEqual([{ label: "Resolved county", countryCode: "US", subdivisionCode: "CA", kind: "tigerweb:county", reference: "tigerweb:county:06045", scope: "administrative", identity: "server_resolved" }]);
    expect(value.recordedBy).toBe(actor); expect(Date.parse(value.recordedAt)).toBeGreaterThanOrEqual(before); expect(Date.parse(value.recordedAt)).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(value)).not.toContain("coordinates");
    const assessed = buildProjectJurisdictionReadinessPayload({ jurisdiction_context: value }, hash);
    expect(assessed.entries[0].assessment.jurisdiction.id).toBe("US-CA");
    expect(assessed.entries[0].assessmentScope).toContain("state-level");
    expect(jurisdictionDraft(value)).toEqual([{ mode: "resolved", kind: "county", geoid: "06045" }]);
  });
  it("refuses failed or mismatched resolver identities", async () => {
    for (const result of [null, { ...boundary, label: null }, { ...boundary, geoid: "41017" }, { ...boundary, kind: "city" }]) {
      await expect(resolveProjectJurisdiction({ version: 1, state: "declared", entries: [{ mode: "resolved", kind: "county", geoid: "06045" }] }, actor, vi.fn().mockResolvedValue(result))).rejects.toThrow("could not be resolved");
    }
  });
  it("distinguishes invalid or unread context from explicit legacy null", () => {
    expect(readProjectJurisdiction({ jurisdiction_context: null })).toBeNull();
    expect(() => readProjectJurisdiction({ jurisdiction_context: { version: 1, state: "declared", recordedBy: actor, recordedAt: revision, entries: [{ label: "Invalid resolved identity", countryCode: "US", subdivisionCode: "CA", kind: "nation", reference: null, scope: "sovereign", identity: "server_resolved" }] } })).toThrow("invalid");
    for (const jurisdiction_context of [undefined, {}, { version: 1, state: "unresolved", entries: [], recordedBy: actor, recordedAt: revision, extra: true }, { version: 1, state: "declared", entries: [] }, { version: 2 }]) expect(() => readProjectJurisdiction({ jurisdiction_context })).toThrow("invalid");
    expect(() => readProjectJurisdiction({})).toThrow("not read");
  });
  it("suppresses study-place fallback for explicit unresolved", async () => {
    const jurisdiction_context = await resolveProjectJurisdiction({ version: 1, state: "unresolved", entries: [] }, actor, vi.fn());
    const row = { id: "project", updated_at: revision, place_country_code: "US", place_subdivision_code: "CA", place_label: "Study place" };
    const cleared = buildProjectJurisdictionReadinessPayload({ ...row, jurisdiction_context }, hash);
    expect(cleared.entries).toEqual([]); expect(cleared.contextSource).toBe("project_declaration");
    const legacy = buildProjectJurisdictionReadinessPayload({ ...row, jurisdiction_context: null }, hash);
    expect(legacy.contextSource).toBe("legacy_study_place"); expect(legacy.entries[0].assessment.jurisdiction.id).toBe("US-CA");
  });
  it("preserves multistate territory sovereign overlap and international declarations independently", async () => {
    const fixtures = [["US", "CA"], ["US", "OR"], ["US", "DC"], ["US", "AK"], ["US", "HI"], ["US", "PR"], ["CA", "BC"], [null, null]];
    const entries: JurisdictionEntryInput[] = fixtures.map(([countryCode, subdivisionCode], i) => ({ ...staff, label: `Context ${i}`, countryCode, subdivisionCode, scope: i === 7 ? "sovereign" as const : "administrative" as const }));
    entries.push({ ...staff, label: "Overlapping context", countryCode: "US", subdivisionCode: "CA", scope: "overlap" });
    const saved = await context(entries);
    const payload = buildProjectJurisdictionReadinessPayload({ id: "project", updated_at: revision, jurisdiction_context: saved }, hash);
    expect(payload.entries).toHaveLength(9);
    expect(payload.entries.map(entry => entry.declaration?.label)).toEqual(entries.map(entry => entry.mode === "staff" ? entry.label : entry.geoid));
    expect(payload.entries.every(entry => entry.assessment.reports.every(report => report.status === "unassessed"))).toBe(true);
    expect(payload.entries[0].administrativeGuidance?.jurisdiction.id).toBe("US-CA");
    expect(payload.entries[7].administrativeGuidance).toBeNull(); expect(payload.entries[8].administrativeGuidance).toBeNull();
  });
  it("freezes identical same-revision context and payload hashes without changing old bytes", async () => {
    const row = { id: "project", updated_at: revision, jurisdiction_context: await context() };
    const before = buildJurisdictionReadinessEvidenceFile(row, hash);
    const payload = buildProjectJurisdictionReadinessExportPayload(row, hash);
    expect(JSON.parse(before.bytes.toString()), "Frozen JSON uses shared external canonical contract").toEqual(payload);
    expect(payload.projectRevision).toBe(revision);
    const { payloadSha256, ...material } = payload;
    expect(payloadSha256).toBe(createHash("sha256").update(canonicalizeActionPayload(material)).digest("hex"));
    const oldBytes = Buffer.from(before.bytes);
    const after = buildJurisdictionReadinessEvidenceFile({ ...row, updated_at: "2026-10-15T01:00:00.000Z", jurisdiction_context: await context([{ ...staff, label: "Changed" }]) }, hash);
    expect(after.revisionToken).not.toBe(before.revisionToken); expect(before.bytes).toEqual(oldBytes);
    expect(decisionPackageFreshness({ schemaVersion: "project_evidence_manifest.v2", selectedLinkedPlan: null }, revision, { projectRevision: "2026-10-15T01:00:00.000Z", candidates: [], linkedPlans: [], inventoryTruncated: false })).toBe("The project record changed after this bundle was frozen.");
  });
});
