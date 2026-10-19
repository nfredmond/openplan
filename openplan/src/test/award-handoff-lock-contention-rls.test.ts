import { AssertionError, deepStrictEqual } from "node:assert";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

// Prepared, UNEXECUTED. Exercise installed SQL, without installing migrations or
// granting privileges. Four isolated cases include real parent-trigger removal,
// not arbitrary transaction order, managed Auth internals or application journeys.
class OwnedClientError extends Error {
  readonly terminated: boolean;
  constructor(code: number | null, stderr: string, auth = false) {
    super(auth ? `Owned Auth contention client exited (${code}); diagnostics suppressed` : `Owned contention client exited (${code}): ${stderr}`);
    const states = [...stderr.matchAll(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/g)].map(match => match[1]);
    this.terminated = (code === 2 || code === 3) && states.length === 1 && states[0] === "57P01"
      && stderr.includes("terminating connection due to administrator command");
  }
}

// Auth DELETE uses its installed login, not a postgres SET ROLE or peer login.
// Keep inspected credentials local to this spawn and suppress Auth diagnostics.
function connection(container: string, auth = false) {
  let childEnv: NodeJS.ProcessEnv | undefined;
  if (auth) {
    try {
      if (!/^supabase_db_[a-z0-9][a-z0-9_.-]*$/.test(container)) throw new Error();
      const authContainer = `supabase_auth_${container.slice("supabase_db_".length)}`;
      const metadata: unknown = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .Config.Env}}", authContainer], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      }));
      if (!Array.isArray(metadata) || !metadata.every((value: unknown) => typeof value === "string")) throw new Error();
      const entries = (metadata as string[]).filter(value => value.startsWith("GOTRUE_DB_DATABASE_URL="));
      if (entries.length !== 1) throw new Error();
      const raw = entries[0].slice("GOTRUE_DB_DATABASE_URL=".length);
      if (raw.includes("?") || raw.includes("#") || [...raw].some(value => value.charCodeAt(0) <= 32 || value.charCodeAt(0) === 127)) throw new Error();
      const url = new URL(raw);
      if (!(url.protocol === "postgres:" || url.protocol === "postgresql:")
        || url.username !== "supabase_auth_admin" || url.hostname !== container
        || url.port !== "5432" || url.pathname !== "/postgres" || url.search || url.hash) throw new Error();
      const password = decodeURIComponent(url.password);
      if (!password || password.includes("\0")) throw new Error();
      childEnv = { ...process.env, PGPASSWORD: password };
    } catch {
      // Do not attach the URL, inspect output, parser error or child-process cause.
      throw new Error("Unable to resolve matching Auth database login metadata");
    }
  }
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn("docker", ["exec", "-i", ...(auth ? ["--env", "PGPASSWORD", "--env", "PGCONNECT_TIMEOUT=5"] : []),
      container, "psql", "-X", ...(auth ? ["-h", "127.0.0.1", "-p", "5432", "-w"] : []),
      "-U", auth ? "supabase_auth_admin" : "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
    { stdio: ["pipe", "pipe", "pipe"], env: childEnv });
  } catch (error) {
    if (auth) throw new Error("Unable to start owned Auth contention client");
    throw error;
  } finally {
    // spawn copies the child environment synchronously. Retain no password here.
    if (childEnv) delete childEnv.PGPASSWORD;
  }
  const lines = createInterface({ input: child.stdout });
  let stderr = "", serial = 0, closed = false;
  let pending: { marker: string; rows: string[]; resolve: (rows: string[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  child.stderr.on("data", bytes => { stderr += String(bytes); });
  child.stdin.on("error", () => undefined); // The close/error event reports a failed client.
  lines.on("line", line => {
    if (!pending) return;
    if (line === pending.marker) {
      const done = pending; pending = undefined; clearTimeout(done.timer); done.resolve(done.rows);
    } else if (line) pending.rows.push(line);
  });
  const ended = new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; }
      reject(error);
    };
    child.once("error", error => fail(auth ? new Error("Owned Auth contention client failed") : error));
    child.once("close", code => {
      closed = true; lines.close();
      if (code !== 0 || pending) fail(new OwnedClientError(code, stderr, auth));
      else resolve();
    });
  });
  void ended.catch(() => undefined);
  return {
    get available() { return !closed && !pending; },
    query(sql: string): Promise<string[]> {
      if (pending || closed) throw new Error("Owned contention client is busy or closed");
      return new Promise((resolve, reject) => {
        const marker = `contention-${++serial}`;
        const timer = setTimeout(() => { reject(new Error("Owned contention query exceeded 25s")); }, 25_000);
        pending = { marker, rows: [], resolve, reject, timer };
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async close() {
      if (!closed) child.stdin.end("ROLLBACK;\n\\q\n");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
      try { await ended; } finally { clearTimeout(timer); }
    },
  };
}

type Connection = ReturnType<typeof connection>;
type LockState = { gateWait: boolean; gateBlocker: boolean; deleteHas713: boolean; saveHas713: boolean; saveWaits713: boolean; saveBlocker: boolean; saveWaitsParent: boolean };
type ParentTrigger = { definition: string; enabled: string };
const correctOrder: LockState = {
  gateWait: true, gateBlocker: true, deleteHas713: true,
  saveHas713: false, saveWaits713: true, saveBlocker: true, saveWaitsParent: false,
};
const orderMessage = "DELETE must own 713 at its row gate; first save must wait on that exact mutex";
function assertCorrectOrder(locks: LockState) { deepStrictEqual(locks, correctOrder, orderMessage); }

// Poll observed locks, with a finite deadline. The pause limits catalog traffic;
// it never determines when either competing command starts or completes.
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 6_000;
  let value = await read();
  while (!ready(value)) {
    if (Date.now() >= deadline) throw new Error(`Expected native lock state not reached: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 25));
    value = await read();
  }
  return value;
}

(LIVE_RLS ? describe : describe.skip)("award handoff parent DELETE lock order", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR?.trim() ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir.");
    }
    container = resolveLocalDbContainer();
  });

  it.each([
    ["program", "comment survivor"], ["program", "entry removed"],
    ["auth user", "comment survivor"], ["auth user", "entry removed"],
  ] as const)("checks permitted %s DELETE / first save (%s)", async (parent, control) => {
    const actor = randomUUID(), owner = randomUUID(), program = randomUUID(), opportunity = randomUUID(), request = randomUUID();
    const suffix = randomUUID().replaceAll("-", "");
    const name = `handoff_parent_${suffix}`, application = `handoff-contention-${suffix}`;
    const table = parent === "program" ? "public.programs" : "auth.users";
    const target = parent === "program" ? program : actor;
    const role = parent === "program" ? "service_role" : "supabase_auth_admin";
    const entry = parent === "program" ? "aaa_handoff_program_delete" : "aaa_handoff_auth_delete";
    const removed = control === "entry removed";
    const expectedTrigger: ParentTrigger = {
      definition: `CREATE TRIGGER ${entry} BEFORE DELETE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION public.handoff_statement_lock()`, enabled: "O",
    };
    // One-argument BIGINT locks have objsubid=1; production (713,1) has 2.
    const gate = BigInt(`0x${suffix.slice(0, 15)}`) + BigInt(1);
    const gateClass = gate >> BigInt(32), gateObject = gate & BigInt("0xffffffff");
    const observer = connection(container);
    let deleter: Connection | undefined, saver: Connection | undefined;
    let observerPid = 0, deletePid = 0, savePid = 0;
    let workspaceIds: string[] = [];
    let deletion: Promise<string[]> | undefined, saving: Promise<string[]> | undefined;
    let captured: ParentTrigger | undefined, restoreEntry = false, fixturesStarted = false, faultProven = false, abortingFault = false;
    const failures: unknown[] = [];
    const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { failures.push(error); } };
    const recordQueryError = (error: unknown) => {
      if (!(abortingFault && error instanceof OwnedClientError && error.terminated)) failures.push(error);
    };
    const readTrigger = async (client: Connection): Promise<ParentTrigger | undefined> => {
      const rows = await client.query(`SELECT json_build_object('definition',pg_get_triggerdef(oid,false),'enabled',tgenabled)
        FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='${entry}' AND NOT tgisinternal;`);
      expect(rows.length).toBeLessThanOrEqual(1);
      return rows.length ? JSON.parse(rows[0]) : undefined;
    };
    try {
      observerPid = Number((await observer.query(`SET application_name='${application}-observer'; SET search_path=''; SET statement_timeout='20s'; SET lock_timeout='15s'; SELECT pg_backend_pid();`)).at(-1));
      expect(Number.isInteger(observerPid) && observerPid > 0).toBe(true);
      expect((await observer.query(`SELECT has_table_privilege('${role}','${table}','DELETE');`)).at(-1), `Required installed DELETE privilege for ${role}`).toBe("t");
      // Prove the DELETE login before changing either fixtures or parent entries.
      deleter = connection(container, parent === "auth user");
      deletePid = Number((await deleter.query(`SET application_name='${application}-delete'; SET statement_timeout='20s'; SET lock_timeout='15s'; SELECT pg_backend_pid();`)).at(-1));
      expect(Number.isInteger(deletePid) && deletePid > 0).toBe(true);
      if (parent === "auth user") {
        expect(await deleter.query("SELECT session_user,current_user;")).toEqual(["supabase_auth_admin|supabase_auth_admin"]);
      }
      await observer.query(`BEGIN; LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE;`);
      captured = await readTrigger(observer);
      deepStrictEqual(captured, expectedTrigger, "Refuse missing, changed or disabled starting parent entry");
      if (removed) {
        restoreEntry = true; // Restore even when DROP/COMMIT has an uncertain outcome.
        await observer.query(`DROP TRIGGER ${entry} ON ${table};`);
        expect(await readTrigger(observer)).toBeUndefined();
      }
      await observer.query("COMMIT;");
      fixturesStarted = true;
      await observer.query(`BEGIN;
        INSERT INTO auth.users(id,email) VALUES ('${actor}','${actor}@example.test'),('${owner}','${owner}@example.test');`);
      // Retain exact signup workspace IDs before COMMIT, so a replacement
      // cleanup connection never depends on a lost session's temporary table.
      workspaceIds = await observer.query(`SELECT DISTINCT workspace_id FROM public.workspace_members WHERE user_id IN ('${actor}','${owner}');`);
      expect(workspaceIds).toHaveLength(2);
      await observer.query(`
        INSERT INTO public.workspace_members(workspace_id,user_id,role)
          SELECT workspace_id,'${owner}','owner' FROM public.workspace_members WHERE user_id='${actor}' AND role='owner'
          ON CONFLICT (workspace_id,user_id) DO NOTHING;
        INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name,created_by)
          SELECT '${program}',workspace_id,'Synthetic parent contention','other','Synthetic cycle','${owner}'
          FROM public.workspace_members WHERE user_id='${actor}' AND role='owner' LIMIT 1;
        INSERT INTO public.funding_opportunities(id,workspace_id,program_id,title)
          SELECT '${opportunity}',workspace_id,id,'Synthetic FK child' FROM public.programs WHERE id='${program}';
        CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $gate$
          BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(${gate}::bigint); RETURN OLD; END $gate$;
        CREATE TRIGGER ${name} BEFORE DELETE ON ${table} FOR EACH ROW WHEN (OLD.id='${target}'::uuid) EXECUTE FUNCTION public.${name}();
        COMMIT;`);
      // Fixture writes acquired 713. COMMIT above releases it before A/B exist.
      expect((await observer.query(`SELECT
        EXISTS(SELECT FROM public.programs p JOIN public.workspace_members m ON m.workspace_id=p.workspace_id
          WHERE p.id='${program}' AND p.created_by='${owner}' AND m.user_id='${actor}' AND m.role='owner')
        AND EXISTS(SELECT FROM public.funding_opportunities WHERE id='${opportunity}' AND program_id='${program}')
        AND NOT EXISTS(SELECT FROM public.workspace_members a WHERE a.user_id='${actor}' AND a.role='owner'
          AND NOT EXISTS(SELECT FROM public.workspace_members b WHERE b.workspace_id=a.workspace_id AND b.role='owner' AND b.user_id<>a.user_id))
        AND NOT EXISTS(SELECT FROM public.program_work_program_revisions WHERE program_id='${program}')
        AND NOT EXISTS(SELECT FROM public.program_work_program_sources WHERE program_id='${program}')
        AND NOT EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=713 AND objid=1 AND objsubid=2);`)).at(-1)).toBe("t");
      await observer.query(`SELECT pg_advisory_lock(${gate}::bigint);`);
      saver = connection(container);
      savePid = Number((await saver.query(`SET application_name='${application}-save'; SET statement_timeout='20s'; SET lock_timeout='15s'; SELECT pg_backend_pid();`)).at(-1));
      expect(new Set([observerPid, deletePid, savePid]).size).toBe(3);
      expect([deletePid, savePid].every(pid => Number.isInteger(pid) && pid > 0)).toBe(true);
      const state = async (): Promise<LockState> => JSON.parse((await observer.query(`SELECT json_build_object(
        'gateWait',EXISTS(SELECT FROM pg_locks WHERE pid=${deletePid} AND locktype='advisory' AND classid=${gateClass}::oid AND objid=${gateObject}::oid AND objsubid=1 AND NOT granted),
        'gateBlocker',${observerPid}=ANY(pg_blocking_pids(${deletePid})),
        'deleteHas713',EXISTS(SELECT FROM pg_locks WHERE pid=${deletePid} AND locktype='advisory' AND classid=713 AND objid=1 AND objsubid=2 AND granted),
        'saveHas713',EXISTS(SELECT FROM pg_locks WHERE pid=${savePid} AND locktype='advisory' AND classid=713 AND objid=1 AND objsubid=2 AND granted),
        'saveWaits713',EXISTS(SELECT FROM pg_locks WHERE pid=${savePid} AND locktype='advisory' AND classid=713 AND objid=1 AND objsubid=2 AND NOT granted),
        'saveBlocker',${deletePid}=ANY(pg_blocking_pids(${savePid})),
        'saveWaitsParent',EXISTS(SELECT FROM pg_locks waiting JOIN pg_locks held
          ON held.locktype='transactionid' AND held.transactionid=waiting.transactionid AND held.pid=${deletePid} AND held.granted
          WHERE waiting.pid=${savePid} AND waiting.locktype='transactionid' AND NOT waiting.granted));`)).at(-1)!);
      deletion = deleter.query(`BEGIN; ${parent === "program" ? "SET LOCAL ROLE service_role;" : ""} SELECT current_user;
        ${removed ? "" : "/* Harmless control: this SQL comment changes no DELETE behavior. */"}
        DELETE FROM ${table} WHERE id='${target}' RETURNING id; COMMIT; SELECT 'DELETE_COMMITTED';`);
      void deletion.catch(recordQueryError);
      await until(state, locks => locks.gateWait && locks.gateBlocker);
      saving = saver.query(`BEGIN; SET LOCAL ROLE service_role;
        DO $save$ BEGIN
          PERFORM public.save_program_work_program_revision('${program}','${actor}',0,'${request}','{"schemaVersion":1,"elements":[]}'::jsonb);
          RAISE EXCEPTION 'First save unexpectedly succeeded';
        EXCEPTION WHEN SQLSTATE '42501' THEN
          IF SQLERRM <> 'Work program access denied' THEN RAISE; END IF;
        END $save$;
        COMMIT; SELECT 'SAVE_DENIED_42501';`);
      void saving.catch(recordQueryError);
      const locks = await until(state, value => value.saveBlocker && (value.saveWaits713 || value.saveWaitsParent));
      if (removed) {
        deepStrictEqual(locks, { ...correctOrder, deleteHas713: false, saveHas713: true, saveWaits713: false, saveWaitsParent: true }, "Exact missing-entry counterfactual before gate release");
        let rejection: unknown;
        try { assertCorrectOrder(locks); } catch (error) { rejection = error; }
        expect(rejection).toBeInstanceOf(AssertionError);
        const error = rejection as AssertionError;
        expect(error.message.split("\n")[0]).toBe(orderMessage);
        expect(error.operator).toBe("deepStrictEqual");
        expect(error.actual).toBe(locks);
        expect(error.expected).toBe(correctOrder);
        faultProven = true;
      } else {
        assertCorrectOrder(locks); // The SAME assertion must reject the fault above.
        expect((await observer.query(`SELECT pg_advisory_unlock(${gate}::bigint);`)).at(-1)).toBe("t");
        expect(await deletion).toEqual([role, target, "DELETE_COMMITTED"]);
        expect(await saving).toEqual(["SAVE_DENIED_42501"]);
        expect((await observer.query(`SELECT NOT EXISTS(SELECT FROM ${table} WHERE id='${target}')
          AND NOT EXISTS(SELECT FROM public.program_work_program_revisions WHERE program_id='${program}')
          AND ${parent === "program"
            ? `EXISTS(SELECT FROM public.funding_opportunities WHERE id='${opportunity}' AND program_id IS NULL)`
            : `EXISTS(SELECT FROM public.programs WHERE id='${program}') AND NOT EXISTS(SELECT FROM public.workspace_members WHERE user_id='${actor}')`};`)).at(-1)).toBe("t");
      }
    } catch (error) { failures.push(error); }
    finally {
      const cleanup = observer.available ? observer : connection(container);
      const pairFilter = `(pid=${deletePid} AND application_name='${application}-delete') OR (pid=${savePid} AND application_name='${application}-save')`;
      await attempt(() => cleanup.query(`ROLLBACK; SET search_path=''; SET statement_timeout='20s'; SET lock_timeout='15s';`));
      // Do not release C (even a failed C) until A/B finish. Releasing the fault
      // here would deliberately create the cycle instead of testing its order.
      await attempt(async () => {
        abortingFault = faultProven; // Accept exact 57P01 only after the proven fault, for our cancellation.
        const stopped = await cleanup.query(`SELECT pid,pg_terminate_backend(pid) FROM pg_stat_activity WHERE ${pairFilter};`);
        if (faultProven) expect(stopped.sort()).toEqual([`${deletePid}|t`, `${savePid}|t`].sort());
      });
      await Promise.allSettled([deletion, saving]);
      for (const client of [deleter, saver]) {
        if (client) await client.close().catch(error => {
          if (!(error instanceof OwnedClientError && error.terminated)) failures.push(error);
        }); // Earlier query errors remain recorded, except the exact proven fault cancellation.
      }
      let pairsFinished = false;
      await attempt(async () => {
        await until(async () => (await cleanup.query(`SELECT NOT EXISTS(SELECT FROM pg_stat_activity WHERE ${pairFilter});`)).at(-1), value => value === "t");
        pairsFinished = true;
      });
      if (pairsFinished) {
        if (cleanup !== observer) await attempt(() => cleanup.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=${observerPid} AND application_name='${application}-observer';`));
        await attempt(() => cleanup.query(`SELECT pg_advisory_unlock(${gate}::bigint);`));
        // Each cleanup stage rolls back a prior failed stage and is attempted
        // independently. Restore the captured entry before ANY fixture DELETE.
        await attempt(async () => {
          await cleanup.query(`ROLLBACK; BEGIN; LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE;`);
          if (captured) {
            const current = await readTrigger(cleanup);
            // Starting state requires O. CREATE restores that enabled default;
            // ALTER TABLE would need table ownership on managed auth.users.
            if (restoreEntry && !current) await cleanup.query(`${captured.definition};`);
            deepStrictEqual(await readTrigger(cleanup), captured, "Restore exact parent entry definition and enabled state");
          }
          await cleanup.query("COMMIT;");
        });
        if (fixturesStarted) await attempt(() => cleanup.query(`ROLLBACK; BEGIN; DROP TRIGGER IF EXISTS ${name} ON ${table}; DROP FUNCTION IF EXISTS public.${name}(); COMMIT;`));
        if (fixturesStarted) await attempt(async () => {
          await cleanup.query("ROLLBACK;");
          deepStrictEqual(await readTrigger(cleanup), expectedTrigger, "Require restored parent entry before fixture DELETE");
          expect((await cleanup.query(`SELECT NOT EXISTS(SELECT FROM public.program_work_program_revisions WHERE program_id='${program}');`)).at(-1)).toBe("t");
          await cleanup.query(`BEGIN;
            DELETE FROM public.funding_opportunities WHERE id='${opportunity}';
            DELETE FROM public.programs WHERE id='${program}';
            DELETE FROM public.workspaces WHERE id IN (${workspaceIds.map(id => `'${id}'`).join(",") || "NULL"});
            DELETE FROM auth.users WHERE id IN ('${actor}','${owner}'); COMMIT;`);
        });
        await attempt(async () => {
          const result = await cleanup.query(`ROLLBACK; SELECT NOT EXISTS(SELECT FROM auth.users WHERE id IN ('${actor}','${owner}'))
          AND NOT EXISTS(SELECT FROM public.workspaces WHERE id IN (${workspaceIds.map(id => `'${id}'`).join(",") || "NULL"}))
          AND NOT EXISTS(SELECT FROM public.programs WHERE id='${program}')
          AND NOT EXISTS(SELECT FROM public.funding_opportunities WHERE id='${opportunity}')
          AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='${name}')
          AND to_regprocedure('public.${name}()') IS NULL
          AND NOT EXISTS(SELECT FROM pg_stat_activity WHERE ${pairFilter})
          AND NOT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND classid=${gateClass}::oid AND objid=${gateObject}::oid AND objsubid=1);`);
          expect(result.at(-1), "Owned fixture and gate cleanup").toBe("t");
        });
        await observer.close().catch(error => {
          if (!(cleanup !== observer && error instanceof OwnedClientError && error.terminated)) failures.push(error);
        });
      } // If session termination cannot be established, retain C's gate and fail.
      if (cleanup !== observer) await attempt(() => cleanup.close());
    }
    if (failures.length) throw new AggregateError(failures, `${parent} DELETE / first save or owned cleanup failed`);
  }, 90_000);
});
