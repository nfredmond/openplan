import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/*
  AN AUTHORITY RECORD IS DATED ON THE WORKSPACE'S CALENDAR (20261017000014).

  record_work_program_event refuses an evidence date in the future. It
  compared with current_date, the database's UTC day, so a Kiritimati
  workspace (UTC+14) was refused its own today until 2 p.m. local time, and a
  Pago Pago workspace (UTC-11) could record its tomorrow after 1 p.m.

  Which of the two is wrong at a given moment depends on the UTC hour: from
  10:00 UTC Kiritimati is a day ahead of UTC, and before 11:00 UTC Pago Pago is
  a day behind. The mutation harness at the end picks the one that tells the
  old comparison apart at the time it runs, so it proves the fix at any hour.

  BLIND CATEGORY: one function. Other routes that compare a planner's date
  with the database day are not seen here.
*/

const live = LIVE_RLS ? describe : describe.skip;
const migration = readFileSync(
  "supabase/migrations/20261017000014_work_program_evidence_date_workspace_calendar.sql",
  "utf8"
);
const rpc = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.record_work_program_event"),
  migration.indexOf("REVOKE ALL ON FUNCTION public.record_work_program_event")
);
const ZONE_GUARD =
  "  IF evidence_zone IS NULL OR evidence_zone IN ('posixrules','localtime','Factory') OR evidence_zone LIKE 'posix/%' OR evidence_zone LIKE 'right/%'\n   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=evidence_zone) THEN evidence_zone:='UTC'; END IF;\n";
const LOCAL_COMPARISON = "(p_command->>'evidenceDate')::date > (pg_catalog.now() AT TIME ZONE evidence_zone)::date";

live("work program evidence dates on the workspace calendar", () => {
  let container: string;
  beforeAll(() => {
    container = resolveLocalDbContainer();
  });
  const run = (sql: string) =>
    execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

  /**
   * One workspace in `zone` (or a stored value `zone` written past the
   * trigger, when `bypassTrigger`), with a revision submitted and approved so
   * an adoption can be recorded. `body` runs with `local_today` set to the
   * workspace's date and everything rolls back.
   */
  function exercise(zone: string | null, body: string, options: { replacement?: string; bypassTrigger?: boolean } = {}) {
    const tag = randomUUID();
    const zoneLiteral = zone === null ? "NULL" : `'${zone.replace(/'/g, "''")}'`;
    const localZone = options.bypassTrigger || zone === null ? "'UTC'" : zoneLiteral;
    return run(`BEGIN; ${options.replacement ?? ""}
    CREATE FUNCTION pg_temp.command(k text, p uuid, r uuid) RETURNS jsonb LANGUAGE sql AS $c$
      SELECT jsonb_build_object('requestId',gen_random_uuid(),'expectedSequence',coalesce((SELECT sequence FROM public.program_work_program_workflow WHERE program_id=p),0),'expectedRevision',(SELECT max(revision) FROM public.program_work_program_revisions WHERE program_id=p),'revisionId',r,'revisionHash',(SELECT content_sha256 FROM public.program_work_program_revisions WHERE id=r),'kind',k,'note','Synthetic engineering exercise, no agency decision','visibility','internal','reviewerIds','[]'::jsonb,'documentIds','[]'::jsonb,'dueOn',NULL,'evidenceDate',NULL,'authority','','scope','','targetEventId',NULL)
    $c$;
    CREATE FUNCTION pg_temp.adopt(p uuid, r uuid, actor uuid, doc uuid, evidence date) RETURNS public.program_work_program_events LANGUAGE sql AS $c$
      SELECT * FROM public.record_work_program_event(p,actor,pg_temp.command('adoption',p,r)||jsonb_build_object('authority','Synthetic board','scope','Engineering exercise only','evidenceDate',evidence,'documentIds',jsonb_build_array(doc)))
    $c$;
    DO $test$ DECLARE
      owner_id uuid:=gen_random_uuid(); reviewer_id uuid:=gen_random_uuid();
      workspace_id uuid:=gen_random_uuid(); program_id uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid();
      r public.program_work_program_revisions; e public.program_work_program_events; msg text;
      local_today date:=(now() AT TIME ZONE ${localZone})::date;
    BEGIN
      INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(reviewer_id,reviewer_id||'@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES(workspace_id,'Synthetic evidence date test ${tag}',workspace_id::text);
      ${options.bypassTrigger ? "ALTER TABLE public.workspaces DISABLE TRIGGER workspaces_time_zone_is_iana;" : ""}
      UPDATE public.workspaces w SET time_zone=${zoneLiteral} WHERE w.id=workspace_id;
      ${options.bypassTrigger ? "ALTER TABLE public.workspaces ENABLE TRIGGER workspaces_time_zone_is_iana;" : ""}
      IF (SELECT time_zone FROM public.workspaces w WHERE w.id=workspace_id) IS DISTINCT FROM ${zoneLiteral} THEN RAISE EXCEPTION 'Zone fixture not stored'; END IF;
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace_id,owner_id,'owner'),(workspace_id,reviewer_id,'member');
      INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(program_id,workspace_id,'Synthetic OWP evidence date','other','Exercise');
      INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,checksum,page_count,status,storage_ref,byte_size) VALUES(doc,workspace_id,'Synthetic decision fixture, not a signature','uploaded_pdf',repeat('a',64),1,'stored','storage://kb-documents/synthetic',100);
      SELECT * INTO r FROM public.save_program_work_program_revision(program_id,owner_id,0,gen_random_uuid(),'{"schemaVersion":1,"elements":[],"agency":"Synthetic evidence date"}');
      PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('submit',program_id,r.id)||jsonb_build_object('reviewerIds',jsonb_build_array(reviewer_id)));
      PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('approve',program_id,r.id));
      ${body}
    END $test$;
    SELECT 'EVIDENCE_DATE_ASSERTIONS_REACHED'; ROLLBACK;`);
  }

  // The day after the workspace's today is refused with the existing message.
  const refusesTomorrow = `
    BEGIN PERFORM pg_temp.adopt(program_id,r.id,owner_id,doc,local_today+1); RAISE EXCEPTION 'Local tomorrow accepted';
    EXCEPTION WHEN invalid_parameter_value THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      IF msg<>'A future event is not recorded evidence' THEN RAISE EXCEPTION 'Wrong refusal: %', msg; END IF;
    END;`;
  // The workspace's today is recorded.
  const recordsToday = `
    BEGIN SELECT * INTO e FROM pg_temp.adopt(program_id,r.id,owner_id,doc,local_today);
    EXCEPTION WHEN invalid_parameter_value THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; RAISE EXCEPTION 'Local today refused: %', msg;
    END;
    IF e.kind IS DISTINCT FROM 'adoption' OR e.payload->>'evidenceDate' IS DISTINCT FROM local_today::text THEN RAISE EXCEPTION 'Adoption not recorded on local today'; END IF;`;
  const both = `${refusesTomorrow} ${recordsToday}`;
  const marker = (output: string) => expect(output).toContain("EVIDENCE_DATE_ASSERTIONS_REACHED");

  it("records a UTC+14 workspace's own today and refuses its tomorrow", () => {
    marker(exercise("Pacific/Kiritimati", both));
  });

  it("refuses a UTC-11 workspace's tomorrow even after UTC has reached it", () => {
    marker(exercise("Pacific/Pago_Pago", both));
  });

  it("uses the UTC day when no zone is saved", () => {
    marker(exercise(null, both));
  });

  it("uses the UTC day, without failing, when the stored zone is not a zone name", () => {
    marker(exercise("Not/A_Zone", both, { bypassTrigger: true }));
    marker(exercise("PST", both, { bypassTrigger: true }));
  });

  it("mutation harness admits a harmless edit and kills the UTC comparison and the missing zone guard", () => {
    expect(rpc).toContain(ZONE_GUARD);
    expect(rpc).toContain(LOCAL_COMPARISON);
    // Harmless: the same fallback zone under another name.
    const harmless = rpc.replace("evidence_zone:='UTC'", "evidence_zone:='Etc/UTC'");
    expect(harmless).not.toBe(rpc);
    marker(exercise("Pacific/Kiritimati", both, { replacement: harmless }));
    marker(exercise("Not/A_Zone", both, { replacement: harmless, bypassTrigger: true }));

    // The comparison this migration replaced. From 10:00 UTC Kiritimati is a
    // day ahead of UTC; before 11:00 UTC Pago Pago is a day behind.
    const utcDay = rpc.replace(LOCAL_COMPARISON, "(p_command->>'evidenceDate')::date > current_date");
    expect(utcDay).not.toBe(rpc);
    if (new Date().getUTCHours() >= 10) {
      expect(() => exercise("Pacific/Kiritimati", both, { replacement: utcDay })).toThrow(/Local today refused/);
    } else {
      expect(() => exercise("Pacific/Pago_Pago", both, { replacement: utcDay })).toThrow(/Local tomorrow accepted/);
    }

    // Without the guard, a bad stored value reaches AT TIME ZONE and the function fails.
    const unguarded = rpc.replace(ZONE_GUARD, "  evidence_zone:=coalesce(evidence_zone,'UTC');\n");
    expect(unguarded).not.toBe(rpc);
    expect(() => exercise("Not/A_Zone", both, { replacement: unguarded, bypassTrigger: true })).toThrow(/time zone "Not\/A_Zone" not recognized/);
  });
});
