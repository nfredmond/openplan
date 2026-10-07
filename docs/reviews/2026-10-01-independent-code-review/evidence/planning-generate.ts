import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildProjectGeoPackage, type ProjectGeoPackageProject } from '../../../../openplan/src/lib/projects/project-geopackage';
import type { ProjectCorridorRow } from '../../../../openplan/src/lib/cartographic/project-corridor-record';
import { buildProjectEvidenceBundle, sha256, type BuildProjectEvidenceBundleInput } from '../../../../openplan/src/lib/project-evidence-bundles/archive';
const PROJECT: ProjectGeoPackageProject = {
  id: "44444444-4444-4444-8444-444444444444",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  name: "Main Street & 3rd Avenue",
  summary: "Safer crossings and better transit access",
  status: "active",
  plan_type: "corridor_plan",
  delivery_phase: "planning",
  latitude: 39.9612,
  longitude: -82.9988,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-26T00:00:00.000Z",
  place_source: "census-tigerweb",
  place_kind: "county",
  place_ref: "39049",
  place_label: "Franklin County, Ohio",
  place_country_code: "US",
  place_subdivision_code: "OH",
  place_min_lon: -83.2,
  place_min_lat: 39.8,
  place_max_lon: -82.8,
  place_max_lat: 40.1,
  place_geometry_geojson: {
    type: "Polygon",
    coordinates: [[[-83.1, 39.9], [-82.9, 39.9], [-82.9, 40.0], [-83.1, 39.9]]],
  },
  place_set_at: "2026-08-25T00:00:00.000Z",
};

const CORRIDORS: ProjectCorridorRow[] = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    workspace_id: PROJECT.workspace_id,
    project_id: PROJECT.id,
    name: "Main Street",
    corridor_type: "arterial",
    los_grade: "D",
    geometry_geojson: { type: "LineString", coordinates: [[-83.1, 39.9], [-83.0, 40.0]] },
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    workspace_id: PROJECT.workspace_id,
    project_id: PROJECT.id,
    name: "Broken imported line",
    corridor_type: "other",
    los_grade: null,
    geometry_geojson: { type: "LineString", coordinates: [[-83, 95], [-82.9, 40]] },
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  },
];


async function main() {
const generatedAt=new Date('2026-10-01T12:00:00Z');
PROJECT.name='SYNTHETIC Café 道路 🚲';
const gpkg=buildProjectGeoPackage({project:PROJECT,corridors:CORRIDORS,generatedAt});
const input:BuildProjectEvidenceBundleInput={bundleId:'99999999-9999-4999-8999-999999999999',workspaceId:PROJECT.workspace_id,projectId:PROJECT.id,projectRevision:PROJECT.updated_at,generatedAt,generatedBy:'11111111-1111-4111-8111-111111111111',candidates:[],selectedFiles:[],generatedFiles:[{path:'project/project.json',recordId:PROJECT.id,title:PROJECT.name,sourceId:'project_record',owningModule:'projects',bytes:Buffer.from(JSON.stringify(PROJECT)+'\n'),contentType:'application/json',retrievalState:'available',custodyState:'openplan_stored',knownLimits:['Synthetic fixture'],revisionToken:'a'.repeat(64)},{path:'project/project.gpkg',recordId:PROJECT.id,title:'Synthetic GeoPackage',sourceId:'project_geopackage',owningModule:'projects',bytes:gpkg.bytes,contentType:'application/geopackage+sqlite3',retrievalState:'rendered_on_freeze',custodyState:'rendered_on_freeze',knownLimits:gpkg.summary.coverageLimits,revisionToken:'b'.repeat(64)}],inventoryTruncated:false,knownLimits:['Synthetic test artifact. No agency approval or production acceptance.']};
const built=await buildProjectEvidenceBundle(input);
const second=await buildProjectEvidenceBundle(input);
if(!built.bytes.equals(second.bytes))throw new Error('Identical input did not produce identical bytes');
const root=resolve('../docs/reviews/2026-10-01-independent-code-review/evidence');
await writeFile(resolve(root,'planning-synthetic.zip'),built.bytes);
await writeFile(resolve(root,'planning-artifact-generation.json'),JSON.stringify({baseline:'891a0d89a848133d44b9e4f314a76a922cd71ace',zipBytes:built.bytes.length,zipSha256:sha256(built.bytes),manifestSha256:built.manifestSha256,checksumsSha256:built.checksumsSha256,deterministic:true,gpkgSummary:gpkg.summary},null,2)+'\n');
console.log('Wrote synthetic ZIP and generation record.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
