import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { placeKindSchema } from "@/lib/api/place-geographies";

const original = readFileSync("supabase/migrations/20261016000001_bca_workbench_versions.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261019000003_bca_project_place_snapshot.sql", "utf8");
const statements = migration.replace(/--[^\n]*/g, "");

// SQL-source assertions only. Catalogue expression identity, NULL rejection,
// authenticated RLS, contention and actual upgrade preservation need native SQL.
it("extends the schema CHECK without rewriting records or changing BCA grants/RLS", () => {
  expect(original).toContain("CHECK (document_json->>'schemaVersion' = '1')");
  expect(migration).toContain("c.conrelid = 'public.project_bca_versions'::regclass");
  expect(migration).toContain("pg_catalog.pg_get_expr(c.conbin, c.conrelid) =");
  expect(migration).toContain("coalesce(cardinality(version_checks), 0) <> 1");
  expect(migration).toContain("Expected exactly one original BCA schema-version CHECK");
  expect(migration).toContain("DROP CONSTRAINT %I', version_checks[1]");
  expect(statements).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  expect(migration).toContain("(document_json->>'schemaVersion' = '1' OR document_json->'schemaVersion' = '2'::jsonb) IS TRUE");
  expect(migration).toContain("ADD CONSTRAINT bca_project_place_snapshot CHECK");
  expect(migration).toContain("document_json->'projectPlace'->>'projectId' = project_id::text");
  expect(migration).toContain("jsonb_typeof(document_json->'projectPlace') = 'object'");
  expect(migration).toContain("jsonb_typeof(document_json->'projectPlace'->'place') = 'object'");
  expect(migration).toMatch(/IN \('recorded', 'missing', 'drawn', 'uploaded'\)\s*\) IS TRUE/);
  expect(statements).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|POLICY|DISABLE|SECURITY\s+DEFINER)\b/i);
  expect(statements).not.toMatch(/\b(?:GRANT|REVOKE)[^;]*ON\s+(?:TABLE\s+)?public\.project_bca_versions\b/i);
  expect(original).toContain("GRANT SELECT, INSERT ON public.project_bca_versions TO authenticated");
  expect(original).toContain("ALTER TABLE public.project_bca_versions ENABLE ROW LEVEL SECURITY");
  expect(original).toContain("created_by = (SELECT auth.uid())");
});
it("guards every non-restore insert with numeric v2, author/member checks and a locked exact source comparison", () => {
  expect(migration).toContain("CREATE TRIGGER project_bca_place_insert_guard BEFORE INSERT ON public.project_bca_versions");
  expect(migration).toContain("FOR EACH ROW EXECUTE FUNCTION public.guard_project_bca_place_insert()");
  expect(migration).toContain("RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER");
  expect(migration).toContain("IF current_user = 'postgres' THEN RETURN NEW; END IF;");
  expect(migration).not.toContain("current_user IN ('service_role', 'postgres')");
  expect(migration).toContain("NEW.created_by IS DISTINCT FROM auth.uid()");
  expect(migration).toContain("jsonb_typeof(NEW.document_json->'schemaVersion') IS DISTINCT FROM 'number'");
  expect(migration).toContain("NEW.document_json->'schemaVersion' IS DISTINCT FROM '2'::jsonb");
  expect(migration).toContain("NEW.document_json->'projectId' IS DISTINCT FROM to_jsonb(NEW.project_id::text)");
  expect(migration).toContain("SELECT p.* INTO project FROM public.projects p WHERE p.id = NEW.project_id FOR SHARE");
  expect(migration).toContain("member.workspace_id = project.workspace_id AND member.user_id = auth.uid()");
  expect(migration).toContain("member.role IN ('owner','admin','member')");
  expect(migration).toContain("NEW.document_json->'projectPlace' IS DISTINCT FROM expected");
  expect(migration).toContain("SET search_path = '' SET timezone = 'UTC'");
  expect(migration).toContain("'projectUpdatedAt', project.updated_at");
  expect(migration).toContain("'placeSetAt', project.place_set_at");
  expect(migration).toContain("'jurisdiction', project.jurisdiction_context");
  expect(migration).toContain("USING ERRCODE = 'PT409'");
});
it("uses shared project context validation and refuses normalization while preserving opaque adapters", () => {
  expect(migration).toContain("public.valid_project_jurisdiction_context(value) IS DISTINCT FROM true");
  expect(migration).toContain("value = public.bca_snapshot_trim(value)");
  expect(migration).toContain("public.bca_snapshot_text_valid(item->>'label', 200, true)");
  expect(migration).toContain("public.bca_snapshot_text_valid(item->>'kind', 80, true)");
  expect(migration).toContain("project.place_source IN ('drawn','uploaded_file')");
  expect(migration).toContain("IF project.place_source = 'tigerweb' AND (");
  const adapterKinds = `ARRAY[${placeKindSchema.options.map(kind => `'${kind}'`).join(",")}]`;
  expect(migration).toContain(`resolved[1] = ANY(${adapterKinds})`);
  expect(migration).toContain(`project.place_kind <> ALL(${adapterKinds})`);
  expect(migration).not.toMatch(/project\.place_source\s+(?:NOT\s+IN|<>\s+ALL)/);
  expect(migration).toContain("char_length(value) + char_length(regexp_replace(value");
});
it("checks actual locked source UUID and both UTC timestamp domains before accepting equality", () => {
  const guard = statements.slice(statements.indexOf("CREATE FUNCTION public.guard_project_bca_place_insert()"));
  const uuidPattern = "^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$";
  expect(guard).toContain(`IF (project.id::text ~* '${uuidPattern}') IS DISTINCT FROM true THEN`);
  expect(statements).toContain(`value->>'recordedBy' ~* '${uuidPattern}'`);
  expect(guard).toContain("reader_timestamp_pattern constant text := '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+]00:00)$'");
  for (const field of ["updated_at", "place_set_at"]) {
    const predicate = `((to_jsonb(project.${field}) #>> '{}') ~ reader_timestamp_pattern) IS DISTINCT FROM true`;
    expect(guard).toContain(predicate);
    expect(guard.indexOf(predicate)).toBeGreaterThan(guard.indexOf("FOR SHARE"));
    expect(guard.indexOf(predicate)).toBeLessThan(guard.indexOf("expected :="));
    expect(guard).toContain(`RAISE EXCEPTION 'Project ${field} is outside the BCA reader datetime domain' USING ERRCODE = '23514'`);
  }
  expect(guard.indexOf("IF (project.id::text ~*")).toBeGreaterThan(guard.indexOf("FOR SHARE"));
  expect(guard.indexOf("IF (project.id::text ~*")).toBeLessThan(guard.indexOf("expected :="));
  expect(guard).toContain("IF project.place_set_at IS NOT NULL AND");
  expect(guard).toContain("RAISE EXCEPTION 'Project identity is outside the BCA reader UUID domain' USING ERRCODE = '23514'");
});
