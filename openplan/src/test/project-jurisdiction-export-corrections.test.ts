import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/project-evidence-bundles/engagement-export-privacy", () => ({ loadPublishableProjectEngagementGeometry: async () => ({ data: [], error: null }) }));
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { buildProjectJurisdictionReadinessPayload, buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { JURISDICTION_READINESS_REGISTRY } from "@/lib/jurisdiction-readiness/registry";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { buildProjectGeoPackage } from "@/lib/projects/project-geopackage";
import { loadProjectEvidenceGeneratedFiles } from "@/lib/project-evidence-bundles/generated-records";
import { buildJurisdictionReadinessEvidenceFile } from "@/lib/jurisdiction-readiness/evidence-bundle";
import { actor, declaration, exportProject as project } from "./project-jurisdiction-export-fixture";
afterEach(() => vi.useRealTimers());
it("hashes a versioned external representation after strict internal validation", () => {
  const registry = jurisdictionReadinessRegistrySha256();
  const internal = buildProjectJurisdictionReadinessPayload(project, registry);
  const external = buildProjectJurisdictionReadinessExportPayload(project, registry);
  expect(internal.context?.recordedBy, "Internal actor custody retained").toBe(actor);
  expect(JSON.stringify(external), "External canonical material excludes internal actor UUID").not.toContain(actor);
  expect(external.context, "External attribution keeps time and source").toEqual({ schema: "openplan.project-jurisdiction-context-export.v1", state: "declared", recordedAt: declaration.recordedAt, entries: declaration.entries });
  expect(external.schema, "External schema is explicit").toBe("openplan.project-jurisdiction-readiness-export.v4");
  expect(external.scope, "External scope is explicit").toBe("external_handoff");
  expect(external.registryVersion, "Registry identity retained").toBe(JURISDICTION_READINESS_REGISTRY.registryVersion);
  const { payloadSha256, ...canonical } = external;
  expect(payloadSha256, "External hash covers its actual canonical bytes").toBe(createHash("sha256").update(canonicalizeActionPayload(canonical)).digest("hex"));
  expect(payloadSha256, "Internal and external bytes have distinct hashes").not.toBe(internal.payloadSha256);
  expect(() => buildProjectJurisdictionReadinessExportPayload({ ...project, jurisdiction_context: { ...declaration, recordedBy: undefined } }, registry), "Export cannot bypass strict internal authorship validation").toThrow("Saved project jurisdiction is invalid");
  expect(buildProjectJurisdictionReadinessExportPayload({ ...project, updated_at: "new-revision" }, registry).payloadSha256, "Output-only project revision does not change jurisdiction inputs").toBe(payloadSha256);
  expect(buildProjectJurisdictionReadinessExportPayload(project, "a".repeat(64)).payloadSha256, "Registry changes canonical hash").not.toBe(payloadSha256);
});
it("carries minimized same-revision canonical material through real generated files and SQLite at different clocks", async () => {
  const sourceProject = { ...project, metadata_json: { recordedBy: actor, recorded_by: actor, citation: "Source record", recordedAt: declaration.recordedAt } };
  const calls: { table: string; columns: string }[] = [];
  const client = { from(table: string) {
    const query = {
      select(columns: string) { calls.push({ table, columns }); return query; },
      eq() { return query; }, in() { return query; }, order() { return query; }, range() { return query; },
      async maybeSingle() { return { data: { ...sourceProject, estimated_cost_amount_exact: null }, error: null }; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: [], error: null })); },
    }; return query;
  } };
  const original = JSON.stringify(sourceProject);
  const registry = jurisdictionReadinessRegistrySha256();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-15T02:00:00Z"));
  const expected = buildProjectJurisdictionReadinessExportPayload(project, registry);
  const bundle = await loadProjectEvidenceGeneratedFiles(client, project, new Date());
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  const standalone = buildProjectGeoPackage({ project, corridors: [], generatedAt: new Date() });
  const legacy = buildProjectGeoPackage({ project: { ...project, jurisdiction_context: null }, corridors: [] });
  const evidence = JSON.parse(buildJurisdictionReadinessEvidenceFile(project, registry).bytes.toString());
  expect(calls.find(call => call.table === "projects"), "Adapter reads full trusted jurisdiction and exact estimate projection").toEqual({ table: "projects", columns: "*, estimated_cost_amount_exact:estimated_cost_amount::text" });
  expect(JSON.stringify(bundle.projectRecord), "Generated project record minimizes actor").not.toContain(actor);
  expect(bundle.projectRecord.metadata_json, "Nested metadata retains time and source without actor keys").toEqual({ citation: "Source record", recordedAt: declaration.recordedAt });
  expect(bundle.projectRecord.jurisdiction_context, "Generated project record uses export context schema").toEqual(expected.context);
  expect(JSON.parse(bundle.files.find(file => file.path === "project/project.json")!.bytes.toString()).jurisdiction_context).toEqual(expected.context);
  expect(JSON.parse(bundle.files.find(file => file.path === "project/jurisdiction-readiness.json")!.bytes.toString()), "Bundle JSON canonical parity").toEqual(expected);
  expect(evidence, "Separate JSON canonical parity across clocks").toEqual(expected);
  const legacyDb = new Database(legacy.bytes, { readonly: true });
  try {
    for (const [name, bytes] of [["standalone", standalone.bytes], ["bundle", bundle.files.find(file => file.path === "project/project.gpkg")!.bytes]] as const) {
      const db = new Database(bytes, { readonly: true });
      try {
        const row = db.prepare("SELECT * FROM project_jurisdiction_context").get() as Record<string, string>;
        expect(bytes.includes(Buffer.from(actor)), `${name} SQLite excludes actor bytes`).toBe(false);
        expect(row.project_revision, `${name} revision`).toBe(project.updated_at);
        expect(row.readiness_schema, `${name} schema`).toBe(expected.schema);
        expect(row.registry_version, `${name} registry version`).toBe(expected.registryVersion);
        expect(row.registry_sha256, `${name} registry hash`).toBe(registry);
        expect(row.payload_sha256, `${name} canonical hash parity`).toBe(expected.payloadSha256);
        expect(row.readiness_payload_json, `${name} canonical byte parity`).toBe(canonicalizeActionPayload(expected));
        expect(JSON.parse(row.jurisdiction_context_json), `${name} minimized context`).toEqual(expected.context);
        expect(db.prepare("SELECT data_type FROM gpkg_contents WHERE table_name='project_jurisdiction_context'").get()).toEqual({ data_type: "attributes" });
        expect(db.prepare("SELECT geom, place_label, place_source, country_code, place_kind FROM project_area").get(), `${name} source geometry and WKB unchanged`).toEqual(legacyDb.prepare("SELECT geom, place_label, place_source, country_code, place_kind FROM project_area").get());
      } finally { db.close(); }
    }
  } finally { legacyDb.close(); }
  expect(JSON.stringify(sourceProject), "Trusted input unchanged").toBe(original);
});
