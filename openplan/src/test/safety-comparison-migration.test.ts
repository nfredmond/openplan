/** AUTHORED, UNEXECUTED. Source assertions cannot prove SQL syntax, locks, RLS or interleavings. */
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const sql=readFileSync("supabase/migrations/20261019120000_safety_comparison_inputs.sql","utf8");
const functionBody=(name:string)=>{const start=sql.indexOf(`CREATE FUNCTION ${name}(`);expect(start).toBeGreaterThan(-1);return sql.slice(start,sql.indexOf("\n$$;",start));};
describe("Safety comparison database source graph",()=>{
 it("admits stored or ready shared project estimate references without publishing private export metadata",()=>{
  const save=functionBody("public.save_safety_comparison").replace(/\s+/g," ");
  expect(save).toContain("d.workspace_id=p.workspace_id AND d.project_id=p.id AND d.status IN ('stored','ready')");
  expect(save).toContain("d.work_program_report_id IS NULL AND d.contract_snapshot_id IS NULL FOR SHARE NOWAIT");
  expect(save).toContain("'status',d.status");
 });
 it("rechecks source sharing, retained state and exact identity before generation",()=>{
  const generation=functionBody("public.persist_safety_comparison_generation").replace(/\s+/g," ");
  expect(generation).toContain("workspace_id=p.workspace_id AND project_id=p.id AND work_program_report_id IS NULL AND contract_snapshot_id IS NULL FOR SHARE NOWAIT");
  expect(generation).toContain("document.status NOT IN ('stored','ready')");
  expect(generation).toContain("document.status IS DISTINCT FROM cost->'sourceDocument'->>'status'");
  expect(generation).toContain("document.checksum IS DISTINCT FROM cost->'sourceDocument'->>'checksum'");
  expect(generation).toContain("document.updated_at IS DISTINCT FROM (cost->'sourceDocument'->>'updatedAt')::timestamptz");
 });
 it("takes project then report then acquisition before deriving membership or writing a revision",()=>{const save=functionBody("public.save_safety_comparison");const project=save.indexOf("workspace_id=r.workspace_id FOR UPDATE");const report=save.indexOf("project_id=p.id AND workspace_id=p.workspace_id FOR UPDATE");const acquisition=save.indexOf("status='ready' FOR UPDATE");const capture=save.indexOf("WITH observations AS");const insert=save.indexOf("INSERT INTO public.report_safety_comparison_revisions");expect(project).toBeGreaterThan(-1);expect(report).toBeGreaterThan(project);expect(acquisition).toBeGreaterThan(report);expect(capture).toBeGreaterThan(acquisition);expect(insert).toBeGreaterThan(capture);expect(save).not.toContain("funding_opportunities");expect(save).toContain("jsonb_agg(jsonb_build_object('row',row,'disposition',disposition) ORDER BY id)");expect(save).toContain("n>20000");});
 it("captures exact predicates, supported involvement, unknowns and consumed values rather than HIN totals",()=>{const save=functionBody("public.save_safety_comparison");for(const field of["collision_date","collision_year","severity","pedestrian_involved","bicyclist_involved","motorcyclist_involved","collision_type","lighting","weather"])expect(save).toContain(`s.${field}`);expect(save).toContain("public.ST_Covers(area,s.geom)");expect(save).toContain("i->'selectedYears'");expect(save).toContain("indeterminate_year");expect(save).toContain("indeterminate_severity");expect(save).toContain("s.pedestrian_involved IS NOT TRUE");expect(save).not.toMatch(/source_attributes|high_injury|crashesPerMile/);expect(save).toContain("'populationCoverage','unassessed'");});
 it("cuts legacy inverse waits, checks both sorted parents and refuses protected source mutations",()=>{const source=functionBody("safety_comparison_private.source_fence");expect(source).toContain("public.projects WHERE id=p FOR UPDATE NOWAIT;");expect(source).toContain("public.safety_crash_ingests WHERE id=a FOR UPDATE NOWAIT;");expect(source).toContain("ORDER BY project_id LOOP");expect(source).toContain("unnest(ARRAY[old_id,new_id])");expect(source).toContain("ORDER BY x LOOP");expect(source.indexOf("FOR UPDATE NOWAIT")).toBeLessThan(source.indexOf("UPDATE public.safety_crash_ingests"));expect(source).toContain("Captured acquisition is immutable");for(const table of["safety_crash_ingests","safety_crashes","safety_crash_parties"])expect(sql).toMatch(new RegExp(`BEFORE INSERT OR UPDATE OR DELETE ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.source_fence`));});
 it("protects report pointer, render children, moves and server bypass without relying on a caller GUC",()=>{const guard=functionBody("safety_comparison_private.report_fence");expect(guard).toContain("transaction_id=txid_current()");expect(guard).toContain("entry_purpose IS NULL");expect(guard).toContain("v.content_hash=new_pointer->>'hash'");expect(guard).toContain("Protected Safety render children");for(const table of["reports","report_runs","report_sections","report_artifacts"])expect(sql).toMatch(new RegExp(`BEFORE INSERT OR UPDATE OR DELETE ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION safety_comparison_private.report_fence`));expect(sql).toContain("REVOKE ALL ON safety_comparison_private.entries FROM PUBLIC, anon, authenticated, service_role");expect(sql).not.toContain("set_config(");});
 it("replays before CAS without moving a newer pointer and reads actual post-touch project revision",()=>{const save=functionBody("public.save_safety_comparison");const replay=save.indexOf("RETURN prior.receipt;");const cas=save.indexOf("IF r.updated_at IS DISTINCT FROM");expect(replay).toBeGreaterThan(-1);expect(cas).toBeGreaterThan(-1);expect(replay).toBeLessThan(cas);expect(save).toContain("prior.command_text IS DISTINCT FROM p_command_text");const persist=functionBody("public.persist_safety_comparison_generation");expect(persist.indexOf("source changed' USING")).toBeLessThan(persist.indexOf("INSERT INTO public.report_artifacts"));expect(persist.indexOf("UPDATE public.reports SET")).toBeLessThan(persist.indexOf("SELECT updated_at INTO project_after"));expect(persist).toContain("Current source is not receipt-backed");expect(persist).not.toMatch(/interval '3|DISABLE TRIGGER|session_replication_role/);});
 it("uses the established public PostGIS namespace and qualified disposition counts",()=>{
  const save=functionBody("public.save_safety_comparison");
  expect(save).toContain("area public.geometry; analysis public.geometry;");
  expect(save).toContain("public.ST_GeomFromGeoJSON");
  expect(save).toContain("public.ST_Covers(area,s.geom)");
  expect(save).not.toMatch(/extensions\.(?:geometry|ST_|Box3D)/);
  expect(save).toContain("jsonb_object_agg(q.reason,q.disposition_count)");
  expect(save).toContain("count(*) AS disposition_count");
 });
 it("locks both report parents and rejects changed ownership before deciding protection",()=>{
  const guard=functionBody("safety_comparison_private.report_fence");
  const snapshot=guard.indexOf("INTO parent_before FROM public.reports v WHERE v.id=ANY(report_ids)");
  const project=guard.indexOf("public.projects WHERE id=p FOR UPDATE NOWAIT;");
  const parent=guard.indexOf("SELECT * INTO locked_parent FROM public.reports WHERE id=r FOR UPDATE NOWAIT;");
  const stable=guard.indexOf("IS DISTINCT FROM parent_before->r::text");
  const decision=guard.indexOf("protected := EXISTS");
  expect(snapshot).toBeGreaterThan(-1);expect(project).toBeGreaterThan(snapshot);expect(parent).toBeGreaterThan(project);expect(stable).toBeGreaterThan(parent);expect(decision).toBeGreaterThan(stable);
  expect(guard).toContain("SELECT array_agg(x ORDER BY x) INTO report_ids");
  expect(guard).toContain("CASE WHEN TG_OP<>'INSERT' THEN (to_jsonb(OLD)");
  expect(guard).toContain("CASE WHEN TG_OP<>'DELETE' THEN (to_jsonb(NEW)");
  expect(guard).toContain("FOR r IN SELECT x FROM unnest(report_ids) x ORDER BY x LOOP");
  expect(guard).toContain("'projectId',locked_parent.project_id,'workspaceId',locked_parent.workspace_id");
  expect(guard).toContain("Report parent changed while fencing projects");
 });
 it("preserves the applied legacy implementation while the v2 consumer refuses the missing exact notice",()=>{const wrapper=functionBody("public.apply_ss4a_safety_seed");expect(wrapper).toContain("Missing exact selected fiscal-year SS4A NOFO");expect(wrapper).toContain("RETURN public.apply_ss4a_safety_seed_legacy_v1");expect(sql).toContain("REVOKE ALL ON FUNCTION public.apply_ss4a_safety_seed_legacy_v1(uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role");expect(sql).toContain("cardinality(keys)>1");expect(sql.toLowerCase()).toContain("unsupported safety snapshot");});
});
