import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { buildProjectGeoPackage, type ProjectGeoPackageProject } from "@/lib/projects/project-geopackage";
import { clearedProjectPlace } from "@/lib/projects/project-place";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
const context = { version: 1, state: "declared", recordedBy: "22222222-2222-4222-8222-222222222222", recordedAt: "2026-10-15T00:00:00.000Z", entries: [{ label: "Sovereign <context>", kind: "nation", reference: "nation:source", countryCode: "CA", subdivisionCode: "BC", scope: "sovereign", identity: "staff_declared" }] };
const geometry = { type: "Polygon", coordinates: [[[-124.12345, 40], [-123.12345, 40], [-123.12345, 41], [-124.12345, 40]]] };
const project: ProjectGeoPackageProject = { ...clearedProjectPlace(), id: "project", workspace_id: "workspace", name: "Project", summary: null, status: "active", plan_type: "corridor_plan", delivery_phase: "planning", latitude: null, longitude: null, created_at: "2026-10-15T00:00:00.000Z", updated_at: "2026-10-15T01:00:00.000Z", place_source: "uploaded", place_label: "Uploaded study boundary", place_geometry_geojson: geometry, jurisdiction_context: context };
it("exports a separate jurisdiction manifest without changing project_area attributes or WKB", () => {
  const before = JSON.stringify(project);
  const artifact = buildProjectGeoPackage({ project, corridors: [] });
  const legacyArtifact = buildProjectGeoPackage({ project: { ...project, jurisdiction_context: null }, corridors: [] });
  const db = new Database(artifact.bytes, { readonly: true });
  const legacy = new Database(legacyArtifact.bytes, { readonly: true });
  try {
    const row = db.prepare("SELECT project_revision, scope, jurisdiction_context_json FROM project_jurisdiction_context").get() as { project_revision: string; scope: string; jurisdiction_context_json: string };
    expect(JSON.parse(row.jurisdiction_context_json)).toEqual(buildProjectJurisdictionReadinessExportPayload(project, "a".repeat(64)).context); expect(row.project_revision).toBe(project.updated_at);
    expect(row.scope).toBe("independent human declaration");
    const area = db.prepare("SELECT place_label, place_source, place_kind, country_code, geom FROM project_area").get() as Record<string, unknown>;
    expect(area.place_label).toBe("Uploaded study boundary"); expect(area.country_code).toBeNull(); expect(area.place_kind).toBeNull();
    expect(area.geom).toEqual((legacy.prepare("SELECT geom FROM project_area").get() as { geom: Buffer }).geom);
    expect(JSON.stringify(project)).toBe(before);
  } finally { db.close(); legacy.close(); }
});
it("renders each declaration and its payload hash with escaped labels and no authority inference", () => {
  const jurisdictionReadiness = buildProjectJurisdictionReadinessExportPayload(project, "a".repeat(64));
  const data: ReportGenerationData = { deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [], projectFundingSnapshot: null, modelingEvidence: [],
    projectRecordsSnapshot: Object.fromEntries(["deliverables", "risks", "issues", "decisions", "meetings"].map(key => [key, { count: 0, latestTitle: null, latestAt: null }])) as ReportGenerationData["projectRecordsSnapshot"],
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
    report: { id: "report", title: "Report", summary: null, report_type: "board_packet", created_at: project.created_at }, workspace: { id: "workspace", name: "Workspace" }, project, runs: [], sections: [{ id: "section", section_key: "project_overview", title: "Overview", enabled: true, sort_order: 0, config_json: {} }], jurisdictionReadiness };
  const html = buildReportHtml(data);
  expect(html, "Report discloses external schema").toContain(jurisdictionReadiness.schema);
  expect(html, "Report discloses external scope").toContain(jurisdictionReadiness.scope);
  expect(html, "Report retains recorded time").toContain(context.recordedAt);
  expect(html, "Report identifies the registry").toContain(jurisdictionReadiness.registrySha256);
  expect(html).not.toContain(context.recordedBy);
  expect(html).toContain("Sovereign &lt;context&gt;"); expect(html).toContain(jurisdictionReadiness.payloadSha256);
  expect(html).toContain("Declared country: CA; subdivision: BC; scope: sovereign");
  expect(html).toContain("adopting authority or legal applicability"); expect(html).toContain("Unverified staff declaration");
});
