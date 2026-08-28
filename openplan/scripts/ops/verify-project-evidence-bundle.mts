import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { ProjectEvidenceCandidate } from "../../src/lib/project-evidence-bundles/contracts";

const require = createRequire(import.meta.url);
const { buildProjectEvidenceBundle, confineEvidenceBundlePath, sha256 } = require(
  "../../src/lib/project-evidence-bundles/archive"
) as typeof import("../../src/lib/project-evidence-bundles/archive");
const { projectEvidenceRevisionToken } = require(
  "../../src/lib/project-evidence-bundles/contracts"
) as typeof import("../../src/lib/project-evidence-bundles/contracts");
const { buildProjectGeoPackage } = require(
  "../../src/lib/projects/project-geopackage"
) as typeof import("../../src/lib/projects/project-geopackage");

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  name: "Small-agency safety access verifier",
  summary: "California governed-handoff verifier fixture",
  status: "active",
  plan_type: "transportation",
  delivery_phase: "planning",
  latitude: 39.2191,
  longitude: -121.0611,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-26T20:00:00.000Z",
  place_source: "stored-project-place",
  place_kind: "city",
  place_ref: "grass-valley-ca-fixture",
  place_label: "Grass Valley, California verifier fixture",
  place_country_code: "US",
  place_subdivision_code: "CA",
  place_min_lon: -121.08,
  place_min_lat: 39.19,
  place_max_lon: -121.04,
  place_max_lat: 39.24,
  place_geometry_geojson: {
    type: "Polygon",
    coordinates: [[[-121.08, 39.19], [-121.04, 39.19], [-121.04, 39.24], [-121.08, 39.19]]],
  },
  place_set_at: "2026-08-26T20:00:00.000Z",
};
const generatedAt = new Date("2026-08-26T20:00:00.000Z");
const geoPackage = buildProjectGeoPackage({
  project,
  corridors: [],
  generatedAt,
  crashes: [{
    id: "55555555-5555-4555-8555-555555555555",
    longitude: -121.061,
    latitude: 39.219,
    severity: "fatal",
    sourceId: "ccrs-ca",
    collisionDate: "2025-06-01",
  }],
  engagementGeometries: [{
    id: "66666666-6666-4666-8666-666666666666",
    geometry: { type: "Point", coordinates: [-121.06, 39.22] },
    longitude: -121.06,
    latitude: 39.22,
    sourceType: "map_pin",
    createdAt: "2026-08-20T12:00:00.000Z",
  }],
});
const candidateBase: Omit<ProjectEvidenceCandidate, "revisionToken"> = {
  id: `project_geopackage:${project.id}`,
  sourceId: "project_geopackage",
  sourceLabel: "Project record",
  owningModule: "projects",
  recordId: project.id,
  parentRecordId: null,
  projectId: project.id,
  title: "Project GeoPackage",
  originalFilename: "project.gpkg",
  contentType: "application/geopackage+sqlite3",
  byteSize: null,
  recordedChecksumSha256: null,
  createdAt: project.created_at,
  updatedAt: project.updated_at,
  sourceKind: "generated_geopackage",
  sourceVintage: null,
  citation: null,
  retrievalState: "rendered_on_freeze",
  claimTier: null,
  custodyState: "rendered_on_freeze",
  uncertainty: [],
  knownLimits: geoPackage.summary.coverageLimits,
  defaultSelected: true,
  required: true,
  selectable: true,
  exclusionReason: null,
};
const candidate = {
  ...candidateBase,
  revisionToken: projectEvidenceRevisionToken(candidateBase),
};
const reportBytes = Buffer.from("%PDF-1.4\n% OpenPlan verifier fixture\n%%EOF\n", "utf8");
const reportBase: Omit<ProjectEvidenceCandidate, "revisionToken"> = {
  id: "report_artifacts:77777777-7777-4777-8777-777777777777",
  sourceId: "report_artifacts",
  sourceLabel: "Reports",
  owningModule: "reports",
  recordId: "77777777-7777-4777-8777-777777777777",
  parentRecordId: "88888888-8888-4888-8888-888888888888",
  projectId: project.id,
  title: "Current board report",
  originalFilename: "current-board-report.pdf",
  contentType: "application/pdf",
  byteSize: reportBytes.length,
  recordedChecksumSha256: sha256(reportBytes),
  createdAt: generatedAt.toISOString(),
  updatedAt: generatedAt.toISOString(),
  sourceKind: "board_report_pdf",
  sourceVintage: generatedAt.toISOString().slice(0, 10),
  citation: "OpenPlan verifier fixture report",
  retrievalState: "available",
  claimTier: "screening_grade",
  custodyState: "openplan_stored",
  uncertainty: [],
  knownLimits: ["Verifier fixture; not an agency-issued report."],
  defaultSelected: true,
  required: false,
  selectable: true,
  exclusionReason: null,
};
const reportCandidate = {
  ...reportBase,
  revisionToken: projectEvidenceRevisionToken(reportBase),
};
const planId = "99999999-9999-4999-8999-999999999999";
const planRevisionToken = "a".repeat(64);
const built = await buildProjectEvidenceBundle({
  bundleId: "33333333-3333-4333-8333-333333333333",
  workspaceId: project.workspace_id,
  projectId: project.id,
  projectRevision: project.updated_at,
  generatedAt,
  generatedBy: "44444444-4444-4444-8444-444444444444",
  candidates: [candidate, reportCandidate],
  selectedFiles: [{
    candidate: reportCandidate,
    bytes: reportBytes,
    filename: "current-board-report.pdf",
    contentType: "application/pdf",
  }],
  generatedFiles: [
    {
      path: "project/project.json",
      recordId: project.id,
      title: "Project record",
      sourceId: "project_record",
      owningModule: "projects",
      bytes: Buffer.from(`${JSON.stringify(project)}\n`),
      contentType: "application/json",
      retrievalState: "available",
      custodyState: "openplan_stored",
      knownLimits: [],
      revisionToken: projectEvidenceRevisionToken(candidate),
    },
    {
      path: "project/linked-plan.json",
      recordId: planId,
      title: "Selected linked plan record",
      sourceId: "linked_data",
      owningModule: "plans",
      bytes: Buffer.from(`${JSON.stringify({ id: planId, project_id: project.id, title: "Safety access plan", status: "active" })}\n`),
      contentType: "application/json",
      retrievalState: "available",
      custodyState: "openplan_stored",
      knownLimits: ["Verifier fixture; not an adopted-plan PDF."],
      revisionToken: planRevisionToken,
    },
    {
      path: "project/project.gpkg",
      recordId: project.id,
      title: "Project GeoPackage",
      sourceId: "project_geopackage",
      owningModule: "projects",
      bytes: geoPackage.bytes,
      contentType: "application/geopackage+sqlite3",
      retrievalState: "rendered_on_freeze",
      custodyState: "rendered_on_freeze",
      knownLimits: geoPackage.summary.coverageLimits,
      revisionToken: projectEvidenceRevisionToken(candidate),
    },
  ],
  inventoryTruncated: false,
  knownLimits: ["Verifier fixture; no external source files are selected."],
  selectedLinkedPlan: { id: planId, revisionToken: planRevisionToken },
});

const outputDir = mkdtempSync(path.join(tmpdir(), "openplan-evidence-bundle-"));
const zipPath = path.join(outputDir, "project-evidence.zip");
writeFileSync(zipPath, built.bytes);
const zip = await JSZip.loadAsync(built.bytes);
for (const [entryPath, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue;
  const confined = confineEvidenceBundlePath(entryPath);
  const target = path.join(outputDir, confined);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, await entry.async("nodebuffer"));
}

execFileSync("sha256sum", ["-c", "checksums.sha256"], { cwd: outputDir, stdio: "inherit" });
execFileSync(
  "jq",
  [
    "-e",
    `
      .schemaVersion == "project_evidence_manifest.v2"
      and .approvalOrPublication == false
      and .generatedBy == "44444444-4444-4444-8444-444444444444"
      and .selectedLinkedPlan.id == "${planId}"
      and .selectedLinkedPlan.revisionToken == "${planRevisionToken}"
      and (.currentBoardOrReportPdf.checksumSha256 | test("^[0-9a-f]{64}$"))
      and ([.entries[] | has("evidence") and (.evidence.schemaVersion == "openplan.evidence_descriptor.v1")] | all)
      and ([.entries[].evidence.support.status == "unsupported"] | any | not)
    `,
    "manifest.json",
  ],
  { cwd: outputDir, stdio: "inherit" }
);
for (const layer of [
  "project_info",
  "openplan_layer_status",
  "project_area",
  "project_location",
  "project_corridors",
  "safety_crash_ksi",
  "engagement_geometry",
]) {
  execFileSync("ogrinfo", ["-ro", "-so", "project/project.gpkg", layer], {
    cwd: outputDir,
    stdio: "inherit",
  });
}
const packageText = (await Promise.all([...Object.entries(zip.files)]
  .filter(([, entry]) => !entry.dir)
  .filter(([entryPath]) => !entryPath.endsWith(".gpkg") && !entryPath.endsWith(".pdf"))
  .map(async ([entryPath, entry]) => `${entryPath}\n${await entry.async("string")}`)))
  .join("\n");
if (/created_by|requested_by|submitted_by|assigned_approver_id|user_id|comment_body|moderation_notes/i.test(packageText)) {
  throw new Error("External handoff contains a private or personal-identifier field name");
}
console.log(`Evidence bundle external-tool verification passed: ${zipPath}`);
