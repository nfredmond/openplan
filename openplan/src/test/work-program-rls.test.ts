import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const liveDescribe = LIVE_RLS ? describe : describe.skip;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Real role and transaction checks; every fixture rolls back in its own connection. */
liveDescribe("work-program preparation live custody", () => {
  let container: string;
  beforeAll(() => { container = resolveLocalDbContainer(); });
  function exercise(assertions: (ids: { owner: string; viewer: string; outsider: string; workspace: string; program: string; document: string; request: string }) => string) {
    const ids = { owner: randomUUID(), viewer: randomUUID(), outsider: randomUUID(), workspace: randomUUID(), program: randomUUID(), document: randomUUID(), request: randomUUID() };
    const sql = `BEGIN;
      INSERT INTO auth.users(id, email) VALUES (${quote(ids.owner)},${quote(`owp-owner-${ids.owner}@example.test`)}), (${quote(ids.viewer)},${quote(`owp-viewer-${ids.viewer}@example.test`)}), (${quote(ids.outsider)},${quote(`owp-outsider-${ids.outsider}@example.test`)});
      INSERT INTO public.workspaces(id,name,slug) VALUES (${quote(ids.workspace)},'Synthetic OWP custody exercise',${quote(ids.workspace)});
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES (${quote(ids.workspace)},${quote(ids.owner)},'owner'),(${quote(ids.workspace)},${quote(ids.viewer)},'viewer');
      INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES (${quote(ids.program)},${quote(ids.workspace)},'Synthetic work program','other','Exercise only');
      INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,checksum,page_count,status) VALUES (${quote(ids.document)},${quote(ids.workspace)},'Synthetic retained PDF','uploaded_pdf',${quote("a".repeat(64))},2,'ready');
      SELECT (public.attach_program_work_program_source(${quote(ids.program)},${quote(ids.owner)},${quote(ids.document)},${quote("a".repeat(64))},'predecessor','https://example.test/source.pdf',2,'{"parser":"manual-page-review","pageCount":2,"elements":[],"warnings":[]}')).id;
      SELECT (public.save_program_work_program_revision(${quote(ids.program)},${quote(ids.owner)},0,${quote(ids.request)},'{"schemaVersion":1,"elements":[]}')).id;
      ${assertions(ids)}
      SELECT 'OWP_CUSTODY_ASSERTIONS_REACHED'; ROLLBACK;`;
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output).toContain("OWP_CUSTODY_ASSERTIONS_REACHED");
  }
  it("shows retained rows to a member and viewer while an outsider reads neither table", () => exercise(({ owner, viewer, outsider, program }) => `
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub',${quote(owner)},true);
    DO $$ BEGIN IF (SELECT count(*) FROM public.program_work_program_sources WHERE program_id=${quote(program)}) <> 1 OR (SELECT count(*) FROM public.program_work_program_revisions WHERE program_id=${quote(program)}) <> 1 THEN RAISE EXCEPTION 'Member did not read the seeded rows'; END IF; END $$;
    SELECT set_config('request.jwt.claim.sub',${quote(viewer)},true);
    DO $$ BEGIN IF (SELECT count(*) FROM public.program_work_program_sources WHERE program_id=${quote(program)}) <> 1 OR (SELECT count(*) FROM public.program_work_program_revisions WHERE program_id=${quote(program)}) <> 1 THEN RAISE EXCEPTION 'Viewer did not read the seeded rows'; END IF; END $$;
    SELECT set_config('request.jwt.claim.sub',${quote(outsider)},true);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.program_work_program_sources) OR EXISTS(SELECT 1 FROM public.program_work_program_revisions) THEN RAISE EXCEPTION 'Outsider read work-program rows'; END IF; END $$;
    RESET ROLE;`));
  it("denies direct mutation and authenticated RPC execution, including actor spoofing", () => exercise(({ program, owner }) => `
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub',${quote(owner)},true);
    DO $$ BEGIN
      BEGIN UPDATE public.program_work_program_sources SET source_role='comparison'; RAISE EXCEPTION 'Direct source update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN DELETE FROM public.program_work_program_revisions; RAISE EXCEPTION 'Direct revision delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(owner)},1,gen_random_uuid(),'{"schemaVersion":1,"elements":[]}'); RAISE EXCEPTION 'Authenticated RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$; RESET ROLE;
    SET LOCAL ROLE service_role;
    DO $$ BEGIN
      BEGIN UPDATE public.program_work_program_revisions SET content_json='{}'; RAISE EXCEPTION 'Service direct revision update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$; RESET ROLE;`));
  it("rechecks actor membership and source workspace ownership inside service RPCs", () => exercise(({ program, viewer, outsider, owner, document }) => `
    SET LOCAL ROLE service_role;
    DO $$ BEGIN
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(viewer)},1,gen_random_uuid(),'{"schemaVersion":1,"elements":[]}'); RAISE EXCEPTION 'Viewer save allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(outsider)},1,gen_random_uuid(),'{"schemaVersion":1,"elements":[]}'); RAISE EXCEPTION 'Outsider save allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.attach_program_work_program_source(${quote(program)},${quote(owner)},${quote(document)},${quote("b".repeat(64))},'comparison',NULL,2,'{}'); RAISE EXCEPTION 'Wrong checksum accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(owner)},1,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'elements',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('sourceId',gen_random_uuid()))))); RAISE EXCEPTION 'Unowned source accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(owner)},1,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'elements',jsonb_build_array(jsonb_build_object('projectId',gen_random_uuid())))); RAISE EXCEPTION 'Unowned project accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$; RESET ROLE;`));
  it("recovers duplicate retries, refuses changed payloads and stale versions, and chains the next revision", () => exercise(({ program, owner, request }) => `
    SET LOCAL ROLE service_role;
    DO $$ DECLARE original public.program_work_program_revisions; retried public.program_work_program_revisions; next_row public.program_work_program_revisions; BEGIN
      SELECT * INTO original FROM public.program_work_program_revisions WHERE program_id=${quote(program)};
      SELECT * INTO retried FROM public.save_program_work_program_revision(${quote(program)},${quote(owner)},0,${quote(request)},'{"schemaVersion":1,"elements":[]}');
      IF retried.id <> original.id OR retried.source_ids IS DISTINCT FROM original.source_ids OR cardinality(original.source_ids) <> 1 OR (SELECT count(*) FROM public.program_work_program_revisions WHERE program_id=${quote(program)}) <> 1 THEN RAISE EXCEPTION 'Retry created a duplicate revision'; END IF;
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(owner)},0,${quote(request)},'{"schemaVersion":1,"elements":[],"agency":"changed"}'); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM public.save_program_work_program_revision(${quote(program)},${quote(owner)},0,gen_random_uuid(),'{"schemaVersion":1,"elements":[]}'); RAISE EXCEPTION 'Stale save accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      SELECT * INTO next_row FROM public.save_program_work_program_revision(${quote(program)},${quote(owner)},1,gen_random_uuid(),'{"schemaVersion":1,"elements":[],"agency":"revision two"}');
      IF next_row.revision <> 2 OR next_row.previous_revision_id <> original.id OR next_row.content_sha256 = original.content_sha256 THEN RAISE EXCEPTION 'Revision chain or hash did not change'; END IF;
    END $$; RESET ROLE;`));
  it("freezes each revision's source inventory even when later attachments share its transaction timestamp", () => exercise(({ program, owner, document, request }) => `
    DO $$ DECLARE first_row public.program_work_program_revisions; next_row public.program_work_program_revisions; later_source public.program_work_program_sources; retried public.program_work_program_revisions; BEGIN
      SELECT * INTO first_row FROM public.program_work_program_revisions WHERE program_id=${quote(program)};
      SELECT * INTO later_source FROM public.attach_program_work_program_source(${quote(program)},${quote(owner)},${quote(document)},${quote("a".repeat(64))},'comparison','https://example.test/comparison.pdf',2,'{}');
      SELECT * INTO next_row FROM public.save_program_work_program_revision(${quote(program)},${quote(owner)},1,gen_random_uuid(),'{"schemaVersion":1,"elements":[]}');
      SELECT * INTO retried FROM public.save_program_work_program_revision(${quote(program)},${quote(owner)},0,${quote(request)},'{"schemaVersion":1,"elements":[]}');
      IF cardinality(first_row.source_ids) <> 1 OR later_source.id = ANY(first_row.source_ids) OR cardinality(next_row.source_ids) <> 2 OR NOT later_source.id = ANY(next_row.source_ids) OR retried.source_ids IS DISTINCT FROM first_row.source_ids THEN RAISE EXCEPTION 'Source inventory drifted across revisions'; END IF;
      IF first_row.created_at <> later_source.created_at THEN RAISE EXCEPTION 'Fixture did not exercise indistinguishable timestamps'; END IF;
    END $$;`));
  it("retains source provenance on retries and prevents deletion of the cited original", () => exercise(({ program, owner, document }) => `
    DO $$ DECLARE original_id uuid; retried_id uuid; BEGIN
      SELECT id INTO original_id FROM public.program_work_program_sources WHERE program_id=${quote(program)};
      SELECT id INTO retried_id FROM public.attach_program_work_program_source(${quote(program)},${quote(owner)},${quote(document)},${quote("a".repeat(64))},'predecessor','https://example.test/source.pdf',2,'{}');
      IF retried_id <> original_id THEN RAISE EXCEPTION 'Source retry duplicated its original'; END IF;
      BEGIN PERFORM public.attach_program_work_program_source(${quote(program)},${quote(owner)},${quote(document)},${quote("a".repeat(64))},'predecessor','https://example.test/changed.pdf',2,'{}'); RAISE EXCEPTION 'Source URL overwritten'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN DELETE FROM public.kb_documents WHERE id=${quote(document)}; RAISE EXCEPTION 'Cited original deleted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    END $$;`));
});
