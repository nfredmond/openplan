import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

// KI-2026-11-02-020, migration 20261102130000. Real database roles, triggers and
// transactions against synthetic rows. This does not run the ingest route, a
// crash source or the browser; the lock case uses two real sessions.
const KEYS = ["ACTOR", "OTHER", "PROJECT", "OTHER_PROJECT", "INGEST", "CAPTURED", "ELSEWHERE", "REPORT"] as const;
const PLACEHOLDER = new RegExp(`__(${KEYS.join("|")})__`, "g");
const PARENT_DIFFERS = "Observation source parent differs";
const CAPTURED = "Captured acquisition is immutable. Retain it and acquire a new source.";

function fixtureIds() {
  return Object.fromEntries(KEYS.map((key) => [key, randomUUID()])) as Record<(typeof KEYS)[number], string>;
}

(LIVE_RLS ? describe : describe.skip)("crash and person rows revise their acquisition once per statement", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir for Safety fixtures.");
    }
    container = resolveLocalDbContainer();
  });

  function psql(input: string, timeout = 60_000) {
    return spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres",
      "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { input, encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 });
  }

  function fill(sql: string, ids: Record<string, string>) {
    return sql.replace(PLACEHOLDER, (_, key: string) => ids[key]);
  }

  // Every case runs under the ingest's own 8-second statement limit and rolls back.
  function exercise(body: string) {
    const fixture = readFileSync("src/test/fixtures/safety/crash-statement-revision.sql", "utf8");
    const input = fill(`BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
      ${fixture}\n${body}\nSELECT 'CRASH_FENCE_ASSERTIONS_REACHED'; ROLLBACK;`, fixtureIds());
    const result = psql(input);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CRASH_FENCE_ASSERTIONS_REACHED");
    return result.stdout;
  }

  it("stores 500 crashes and 500 people per statement within the timeout on a large study area", () => {
    exercise(`
    -- A study polygon of about 1.4 MB, like a large tribal area. Each projects row
    -- trigger that serializes the row pays for it once per project update.
    UPDATE public.projects SET place_geometry_geojson=jsonb_build_object('type','Polygon','coordinates',
      jsonb_build_array((SELECT jsonb_agg(jsonb_build_array(-110+cos(g/8000.0*2*pi())*1.234567,36+sin(g/8000.0*2*pi())*1.234567))
      FROM generate_series(0,80000) g))) WHERE id='__PROJECT__';
    CREATE TEMP TABLE marks(label text PRIMARY KEY, at timestamptz NOT NULL, revision bigint NOT NULL, project_at timestamptz NOT NULL);
    GRANT INSERT, SELECT ON marks TO service_role;
    CREATE FUNCTION pg_temp.mark(l text) RETURNS void LANGUAGE sql AS $f$
      INSERT INTO marks SELECT l, clock_timestamp(), pg_temp.revision('__INGEST__'), pg_temp.project_at('__PROJECT__');
    $f$;
    SET LOCAL ROLE service_role;
    SELECT pg_temp.mark('start');
    INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude)
      SELECT pg_temp.ws('__ACTOR__'),'__INGEST__','ccrs-ca','case-'||g,'injury',0.5,0.5 FROM generate_series(1,500) g
      ON CONFLICT (workspace_id,ingest_id,source_id,external_id) DO UPDATE SET severity=EXCLUDED.severity;
    SELECT pg_temp.mark('inserted');
    -- The same 500 again: every row conflicts and takes the UPDATE path.
    INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude)
      SELECT pg_temp.ws('__ACTOR__'),'__INGEST__','ccrs-ca','case-'||g,'fatal',0.5,0.5 FROM generate_series(1,500) g
      ON CONFLICT (workspace_id,ingest_id,source_id,external_id) DO UPDATE SET severity=EXCLUDED.severity;
    SELECT pg_temp.mark('upserted');
    INSERT INTO public.safety_crash_parties(workspace_id,crash_id,ingest_id,source_id,external_party_id,party_role,age_band)
      SELECT workspace_id,id,ingest_id,source_id,external_id||'-driver','driver','unknown' FROM public.safety_crashes WHERE ingest_id='__INGEST__'
      ON CONFLICT (workspace_id,ingest_id,source_id,external_party_id) DO UPDATE SET party_role=EXCLUDED.party_role;
    SELECT pg_temp.mark('persons');
    RESET ROLE;
    DO $$ DECLARE s marks; i marks; u marks; p marks; BEGIN
      SELECT * INTO STRICT s FROM marks WHERE label='start';
      SELECT * INTO STRICT i FROM marks WHERE label='inserted';
      SELECT * INTO STRICT u FROM marks WHERE label='upserted';
      SELECT * INTO STRICT p FROM marks WHERE label='persons';
      PERFORM pg_temp.assert_crash(pg_temp.crashes('__INGEST__')=500 AND pg_temp.persons('__INGEST__')=500,'Rows missing');
      PERFORM pg_temp.assert_crash((SELECT bool_and(severity='fatal') FROM public.safety_crashes WHERE ingest_id='__INGEST__'),'Upsert did not update');
      PERFORM pg_temp.assert_crash(i.at-s.at < interval '3 seconds','Crash insert took '||(i.at-s.at));
      PERFORM pg_temp.assert_crash(u.at-i.at < interval '3 seconds','Crash upsert took '||(u.at-i.at));
      PERFORM pg_temp.assert_crash(p.at-u.at < interval '3 seconds','Person insert took '||(p.at-u.at));
      PERFORM pg_temp.assert_crash(i.revision=s.revision+1 AND u.revision=s.revision+2 AND p.revision=s.revision+3,
        format('Revision is not once per statement: %s %s %s %s',s.revision,i.revision,u.revision,p.revision));
      PERFORM pg_temp.assert_crash(s.project_at<i.project_at AND i.project_at<u.project_at AND u.project_at<p.project_at,'Project revision did not advance per statement');
      PERFORM pg_temp.assert_crash(pg_temp.revision('__CAPTURED__')=1 AND pg_temp.revision('__ELSEWHERE__')=1,'Unrelated acquisition revised');
    END $$;`);
  }, 60_000);

  it("refuses a whole statement when one row's acquisition, workspace or source differs", () => {
    exercise(`
    INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude)
      SELECT pg_temp.ws('__ACTOR__'),'__INGEST__','ccrs-ca','seed-'||g,'injury',0.5,0.5 FROM generate_series(1,3) g;
    INSERT INTO public.safety_crash_parties(workspace_id,crash_id,ingest_id,source_id,external_party_id,party_role,age_band)
      SELECT workspace_id,id,ingest_id,source_id,external_id||'-driver','driver','unknown' FROM public.safety_crashes WHERE ingest_id='__INGEST__';
    SET LOCAL ROLE service_role;
    DO $$ DECLARE ws uuid:=pg_temp.ws('__ACTOR__'); other uuid:=pg_temp.ws('__OTHER__'); r0 bigint:=pg_temp.revision('__INGEST__');
      p0 timestamptz:=pg_temp.project_at('__PROJECT__'); BEGIN
      PERFORM pg_temp.assert_crash(other IS NOT NULL AND other<>ws,'Missing second workspace');
      PERFORM pg_temp.refused(pg_temp.insert_crashes(concat_ws(',',pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','good-1'),
        pg_temp.crash_row(ws,'__INGEST__','fars-national','bad-source'),pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','good-2'))),'${PARENT_DIFFERS}');
      PERFORM pg_temp.refused(pg_temp.insert_crashes(concat_ws(',',pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','good-1'),
        pg_temp.crash_row(other,'__INGEST__','ccrs-ca','bad-workspace'))),'${PARENT_DIFFERS}');
      PERFORM pg_temp.refused(pg_temp.insert_crashes(concat_ws(',',pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','good-1'),
        pg_temp.crash_row(ws,gen_random_uuid(),'ccrs-ca','no-acquisition'))),'${PARENT_DIFFERS}');
      PERFORM pg_temp.refused($s$UPDATE public.safety_crashes SET source_id=CASE WHEN external_id='seed-2' THEN 'fars-national' ELSE source_id END
        WHERE ingest_id='__INGEST__'$s$,'${PARENT_DIFFERS}');
      PERFORM pg_temp.refused(format($s$UPDATE public.safety_crash_parties SET workspace_id=CASE WHEN external_party_id='seed-3-driver' THEN %L::uuid ELSE workspace_id END
        WHERE ingest_id='__INGEST__'$s$,other),'${PARENT_DIFFERS}');
      PERFORM pg_temp.assert_crash(pg_temp.crashes('__INGEST__')=3 AND pg_temp.persons('__INGEST__')=3,'A refused statement kept rows');
      PERFORM pg_temp.assert_crash(NOT EXISTS(SELECT FROM public.safety_crashes WHERE ingest_id='__INGEST__' AND (external_id LIKE 'good-%' OR source_id<>'ccrs-ca')),'A refused statement wrote a good row');
      PERFORM pg_temp.assert_crash((SELECT bool_and(workspace_id=ws) FROM public.safety_crash_parties WHERE ingest_id='__INGEST__'),'A refused person update persisted');
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r0 AND pg_temp.project_at('__PROJECT__')=p0,'A refused statement revised its sources');
    END $$; RESET ROLE;`);
  }, 60_000);

  it("refuses a whole statement that writes, moves or deletes any row of a captured acquisition", () => {
    exercise(`
    INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude)
      SELECT pg_temp.ws('__ACTOR__'),a,'ccrs-ca',left(a::text,8)||'-'||g,'injury',0.5,0.5
      FROM unnest(ARRAY['__INGEST__','__CAPTURED__']::uuid[]) a, generate_series(1,3) g;
    INSERT INTO public.safety_crash_parties(workspace_id,crash_id,ingest_id,source_id,external_party_id,party_role,age_band)
      SELECT workspace_id,id,ingest_id,source_id,external_id||'-driver','driver','unknown' FROM public.safety_crashes
      WHERE ingest_id IN ('__INGEST__','__CAPTURED__');
    SELECT pg_temp.capture('__CAPTURED__');
    SET LOCAL ROLE service_role;
    DO $$ DECLARE ws uuid:=pg_temp.ws('__ACTOR__'); r0 bigint:=pg_temp.revision('__INGEST__'); c0 bigint:=pg_temp.revision('__CAPTURED__');
      p0 timestamptz:=pg_temp.project_at('__PROJECT__'); open_crash uuid; BEGIN
      SELECT id INTO STRICT open_crash FROM public.safety_crashes WHERE ingest_id='__INGEST__' ORDER BY external_id LIMIT 1;
      PERFORM pg_temp.refused(pg_temp.insert_crashes(concat_ws(',',pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','open-new-1'),
        pg_temp.crash_row(ws,'__CAPTURED__','ccrs-ca','captured-new'),pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','open-new-2'))),'${CAPTURED}');
      PERFORM pg_temp.refused($s$UPDATE public.safety_crashes SET severity='fatal' WHERE ingest_id IN ('__INGEST__','__CAPTURED__')$s$,'${CAPTURED}');
      PERFORM pg_temp.refused($s$DELETE FROM public.safety_crashes WHERE ingest_id IN ('__INGEST__','__CAPTURED__')$s$,'${CAPTURED}');
      PERFORM pg_temp.refused(format($s$UPDATE public.safety_crashes SET ingest_id='__CAPTURED__' WHERE id=%L$s$,open_crash),'${CAPTURED}');
      PERFORM pg_temp.refused($s$INSERT INTO public.safety_crash_parties(workspace_id,crash_id,ingest_id,source_id,external_party_id,party_role,age_band)
        SELECT workspace_id,id,ingest_id,source_id,external_id||'-passenger','passenger','unknown' FROM public.safety_crashes
        WHERE ingest_id IN ('__INGEST__','__CAPTURED__')$s$,'${CAPTURED}');
      PERFORM pg_temp.refused($s$DELETE FROM public.safety_crash_parties WHERE ingest_id IN ('__INGEST__','__CAPTURED__')$s$,'${CAPTURED}');
      PERFORM pg_temp.assert_crash(pg_temp.crashes('__INGEST__')=3 AND pg_temp.crashes('__CAPTURED__')=3
        AND pg_temp.persons('__INGEST__')=3 AND pg_temp.persons('__CAPTURED__')=3,'A refused statement changed row counts');
      PERFORM pg_temp.assert_crash((SELECT bool_and(severity='injury') FROM public.safety_crashes WHERE ingest_id IN ('__INGEST__','__CAPTURED__')),'A refused update persisted');
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r0 AND pg_temp.revision('__CAPTURED__')=c0
        AND pg_temp.project_at('__PROJECT__')=p0,'A refused statement revised its sources');
      -- The open acquisition alone is still writable.
      EXECUTE pg_temp.insert_crashes(pg_temp.crash_row(ws,'__INGEST__','ccrs-ca','open-new-3'));
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r0+1 AND pg_temp.revision('__CAPTURED__')=c0,'Open acquisition write not revised once');
    END $$; RESET ROLE;`);
  }, 60_000);

  it("revises each acquisition and project once per update, delete and move, and not for an empty statement", () => {
    exercise(`
    INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude)
      SELECT pg_temp.ws('__ACTOR__'),'__INGEST__','ccrs-ca','move-'||g,'injury',0.5,0.5 FROM generate_series(1,4) g;
    INSERT INTO public.safety_crash_parties(workspace_id,crash_id,ingest_id,source_id,external_party_id,party_role,age_band)
      SELECT workspace_id,id,ingest_id,source_id,external_id||'-driver','driver','unknown' FROM public.safety_crashes WHERE ingest_id='__INGEST__';
    SET LOCAL ROLE service_role;
    DO $$ DECLARE r bigint; e bigint; p timestamptz; q timestamptz; BEGIN
      r:=pg_temp.revision('__INGEST__'); e:=pg_temp.revision('__ELSEWHERE__'); p:=pg_temp.project_at('__PROJECT__'); q:=pg_temp.project_at('__OTHER_PROJECT__');
      UPDATE public.safety_crashes SET severity='fatal' WHERE ingest_id='__INGEST__';
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r+1 AND pg_temp.project_at('__PROJECT__')>p,'Update not revised once');
      r:=r+1; p:=pg_temp.project_at('__PROJECT__');
      UPDATE public.safety_crashes SET severity='pdo' WHERE ingest_id='__INGEST__' AND external_id='none';
      UPDATE public.safety_crash_parties SET party_role='other' WHERE ingest_id='__INGEST__' AND external_party_id='none';
      DELETE FROM public.safety_crashes WHERE ingest_id='__INGEST__' AND external_id='none';
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r AND pg_temp.project_at('__PROJECT__')=p,'An empty statement revised its source');
      -- Moving two crashes and their people revises both acquisitions and both projects once.
      UPDATE public.safety_crashes SET ingest_id='__ELSEWHERE__' WHERE ingest_id='__INGEST__' AND external_id IN ('move-1','move-2');
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r+1 AND pg_temp.revision('__ELSEWHERE__')=e+1,'Move not revised once per acquisition');
      PERFORM pg_temp.assert_crash(pg_temp.project_at('__PROJECT__')>p AND pg_temp.project_at('__OTHER_PROJECT__')>q,'Move did not touch both projects');
      UPDATE public.safety_crash_parties SET ingest_id='__ELSEWHERE__' WHERE ingest_id='__INGEST__' AND external_party_id IN ('move-1-driver','move-2-driver');
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r+2 AND pg_temp.revision('__ELSEWHERE__')=e+2,'Person move not revised once per acquisition');
      r:=r+2; p:=pg_temp.project_at('__PROJECT__');
      -- Deleting two crashes cascades to their two people: one statement on each table.
      DELETE FROM public.safety_crashes WHERE ingest_id='__INGEST__' AND external_id IN ('move-3','move-4');
      PERFORM pg_temp.assert_crash(pg_temp.revision('__INGEST__')=r+2 AND pg_temp.crashes('__INGEST__')=0
        AND pg_temp.persons('__INGEST__')=0 AND pg_temp.project_at('__PROJECT__')>p,'Delete not revised once per table');
    END $$; RESET ROLE;
    -- Deleting the acquisition cascades through its crashes and people.
    DELETE FROM public.safety_crash_ingests WHERE id='__ELSEWHERE__';
    DO $$ BEGIN
      PERFORM pg_temp.assert_crash(pg_temp.crashes('__ELSEWHERE__')=0 AND pg_temp.persons('__ELSEWHERE__')=0
        AND pg_temp.revision('__ELSEWHERE__') IS NULL,'Acquisition delete did not cascade');
    END $$;`);
  }, 60_000);

  it("refuses at once, before writing, when another session holds the project or the acquisition", async () => {
    const ids = fixtureIds();
    const fixture = readFileSync("src/test/fixtures/safety/crash-statement-revision.sql", "utf8");
    const setup = psql(fill(`BEGIN; ${fixture}\nCOMMIT;`, ids));
    expect(setup.status, setup.stderr).toBe(0);
    try {
      for (const [table, id] of [["projects", ids.PROJECT], ["safety_crash_ingests", ids.INGEST]] as const) {
        const holder = spawn("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"],
          { stdio: ["pipe", "pipe", "pipe"] });
        const finished = new Promise<number | null>((resolve) => holder.once("close", resolve));
        const holding = new Promise<void>((resolve, reject) => {
          let out = "";
          const timer = setTimeout(() => reject(new Error("Lock holder did not start")), 20_000);
          holder.stdout.on("data", (bytes) => {
            out += String(bytes);
            if (out.includes("HOLDING")) { clearTimeout(timer); resolve(); }
          });
        });
        holder.stdin.end(`BEGIN; SELECT 1 FROM public.${table} WHERE id='${id}' FOR UPDATE; SELECT 'HOLDING'; SELECT pg_sleep(4); ROLLBACK;\n`);
        await holding;
        const started = Date.now();
        const writer = psql(fill(`BEGIN; SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='15s'; SET LOCAL ROLE service_role;
          INSERT INTO public.safety_crashes(workspace_id,ingest_id,source_id,external_id,severity,latitude,longitude)
            SELECT i.workspace_id,i.id,'ccrs-ca','locked-'||g,'injury',0.5,0.5 FROM public.safety_crash_ingests i, generate_series(1,3) g
            WHERE i.id='__INGEST__';
          ROLLBACK;`, ids));
        const elapsed = Date.now() - started;
        expect(await finished).toBe(0);
        expect(writer.status, `writer was admitted while ${table} was held`).not.toBe(0);
        expect(writer.stderr).toContain(`55P03: could not obtain lock on row in relation "${table}"`);
        expect(elapsed, "writer waited for the lock instead of refusing").toBeLessThan(2_500);
      }
      const after = psql(fill(`SELECT count(c.id)||':'||max(i.evidence_revision) FROM public.safety_crash_ingests i
        LEFT JOIN public.safety_crashes c ON c.ingest_id=i.id WHERE i.id='__INGEST__';`, ids));
      expect(after.status, after.stderr).toBe(0);
      expect(after.stdout.trim(), "a refused writer left a crash or a revision").toBe("0:1");
    } finally {
      const cleanup = psql(fill(`BEGIN;
        DELETE FROM public.workspaces WHERE id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN ('__ACTOR__','__OTHER__'));
        DELETE FROM auth.users WHERE id IN ('__ACTOR__','__OTHER__'); COMMIT;`, ids));
      expect(cleanup.status, cleanup.stderr).toBe(0);
    }
  }, 90_000);
});
