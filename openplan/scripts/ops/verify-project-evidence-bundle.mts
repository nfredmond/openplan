import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { ProjectEvidenceCandidate } from "../../src/lib/project-evidence-bundles/contracts";

const require = createRequire(import.meta.url);
const { buildProjectEvidenceBundle, confineEvidenceBundlePath } = require(
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
  name: "Harbour access",
  summary: "Country-neutral evidence-bundle verifier",
  status: "active",
  plan_type: "transportation",
  delivery_phase: "planning",
  latitude: -41.2865,
  longitude: 174.7762,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-26T20:00:00.000Z",
  place_source: "stored-project-place",
  place_kind: "city",
  place_ref: "wellington",
  place_label: "Wellington, Aotearoa New Zealand",
  place_country_code: "NZ",
  place_subdivision_code: null,
  place_min_lon: 174.7,
  place_min_lat: -41.35,
  place_max_lon: 174.85,
  place_max_lat: -41.2,
  place_geometry_geojson: null,
  place_set_at: "2026-08-26T20:00:00.000Z",
};
const generatedAt = new Date("2026-08-26T20:00:00.000Z");
const geoPackage = buildProjectGeoPackage({ project, corridors: [], generatedAt });
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
const built = await buildProjectEvidenceBundle({
  bundleId: "33333333-3333-4333-8333-333333333333",
  workspaceId: project.workspace_id,
  projectId: project.id,
  projectRevision: project.updated_at,
  generatedAt,
  generatedBy: "44444444-4444-4444-8444-444444444444",
  candidates: [candidate],
  selectedFiles: [],
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
    },
  ],
  inventoryTruncated: false,
  knownLimits: ["Verifier fixture; no external source files are selected."],
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
  ["-e", '.schemaVersion == "project_evidence_manifest.v1" and .approvalOrPublication == false', "manifest.json"],
  { cwd: outputDir, stdio: "inherit" }
);
execFileSync("ogrinfo", ["-ro", "-so", "project/project.gpkg", "project_info"], {
  cwd: outputDir,
  stdio: "inherit",
});
console.log(`Evidence bundle external-tool verification passed: ${zipPath}`);
