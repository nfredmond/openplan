import { afterEach, expect, it, vi } from "vitest";
import { formatDateTime, getReportPacketFreshness } from "@/lib/reports/catalog";
import { reportJurisdictionState } from "@/lib/reports/jurisdiction-freshness";
import { resolveReportPacketRowFreshness } from "@/lib/reports/report-registry-freshness";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";

afterEach(() => vi.unstubAllEnvs());
const project = { id: "project", updated_at: "2026-10-17T00:00:00Z", jurisdiction_context: null,
  place_label: null, place_country_code: null, place_subdivision_code: null };
const snapshot = buildProjectJurisdictionReadinessExportPayload(project, jurisdictionReadinessRegistrySha256());
const metadata = { sourceContext: { jurisdictionReadiness: snapshot } };
const report = { latest_artifact_kind: "pdf", generated_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-17T00:00:00Z" };
const artifact = { generated_at: report.generated_at, metadata_json: metadata };

it.each(["America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati"])("preserves a date-only Thursday without a clock in %s", (zone) => {
  vi.stubEnv("TZ", zone);
  expect(formatDateTime("2026-10-22")).toBe("10/22/2026");
});
it("keeps instants distinct from calendar dates and preserves unreadable values", () => {
  const instant = "2026-10-22T00:00:00Z";
  expect(formatDateTime(instant)).toBe(new Date(instant).toLocaleString("en-US"));
  expect(formatDateTime(null)).toBe("Unknown");
  expect(formatDateTime("invalid")).toBe("invalid");
  expect(formatDateTime("2026-02-30")).toBe("2026-02-30");
});
it("keeps an unchanged jurisdiction current after output-only revision changes", () => {
  expect(reportJurisdictionState(metadata, { ...project, updated_at: "2026-10-18T05:00:00Z" })).toBe("current");
});
it.each([
  { ...project, place_country_code: "CA", place_subdivision_code: "BC" },
  { ...project, jurisdiction_context: { version: 1, state: "unresolved", entries: [],
    recordedAt: "2026-10-17T01:00:00Z", recordedBy: "11111111-1111-4111-8111-111111111111" } },
])("marks real jurisdiction input changes stale: %j", (changed) => {
  const state = reportJurisdictionState(metadata, changed);
  expect(state).toBe("changed");
  expect(resolveReportPacketRowFreshness(report, artifact, state).label).toBe("Refresh recommended");
});
it("distinguishes a failed read or malformed context from changed inputs", () => {
  expect(reportJurisdictionState(metadata, null)).toBe("unavailable");
  expect(reportJurisdictionState(metadata, { id: project.id })).toBe("unavailable");
  expect(reportJurisdictionState(metadata, { ...project, jurisdiction_context: {} })).toBe("unavailable");
});
it("compares the registry fingerprint as well as declared context", () => {
  const oldRegistry = buildProjectJurisdictionReadinessExportPayload(project, "a".repeat(64));
  expect(reportJurisdictionState({ sourceContext: { jurisdictionReadiness: oldRegistry } }, project)).toBe("changed");
});
it("refuses tampered snapshot material even when its hash claims the current fingerprint", () => {
  expect(reportJurisdictionState({ sourceContext: { jurisdictionReadiness: { ...snapshot, disclosure: "altered" } } }, project)).toBe("unavailable");
});
it("does not regrade older snapshot formats through a v4 comparison", () => {
  expect(reportJurisdictionState({}, null)).toBe("untracked");
  expect(reportJurisdictionState({ sourceContext: { jurisdictionReadiness: { ...snapshot, schema: "openplan.project-jurisdiction-readiness-export.v3" } } }, null)).toBe("untracked");
});
it("does not render unavailable current context as changed inputs", () => {
  const result = getReportPacketFreshness({ latestArtifactKind: "pdf", generatedAt: report.generated_at, updatedAt: null, jurisdictionState: "unavailable" });
  expect(result.label).toBe("Source evidence unassessed");
  expect(result.detail).toContain("could not be checked");
});
