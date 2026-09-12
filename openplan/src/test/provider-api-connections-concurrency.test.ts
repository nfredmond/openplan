import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live("concurrent workspace API configuration", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) throw new Error("API concurrency fixtures require an isolated stack.");
    container = resolveLocalDbContainer();
  });
  function args(label = "api-config-probe") { return ["exec", "-i", "-e", `PGAPPNAME=${label}`, container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]; }
  function sql(text: string) { return execFileSync("docker", args(), { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  function start(text: string, label: string) {
    const child = spawn("docker", args(label), { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", data => { out += data; }); child.stderr.on("data", data => { err += data; });
    const done = new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      child.once("error", reject); child.once("close", code => resolve({ code, out, err }));
    });
    child.stdin.end(text); return done;
  }
  for (const mode of ["edit", "revoke", "membership", "identical-save"]) {
    it(`serializes ${mode} before a concurrent save`, async () => {
      const user = randomUUID(), custodian = randomUUID(), workspace = randomUUID(), connection = randomUUID(), revision = randomUUID(), next = randomUUID(), competing = randomUUID();
      const a = `api-a-${randomUUID()}`, b = `api-b-${randomUUID()}`;
      const config = JSON.stringify({ label: "Synthetic API", protocol: "openai_chat_completions", endpoint: "https://model.fixture.invalid/v1/", modelIds: ["synthetic-model"], structuredOutput: true, authMode: "none", timeoutSeconds: 120 });
      const save = (id: string, previous: string | null) => `public.save_workspace_provider_api_revision('${user}','${workspace}','${connection}','${id}',${previous ? `'${previous}'` : "NULL"},'${config}',NULL)`;
      const pending: Array<ReturnType<typeof start>> = [];
      try {
        sql(`BEGIN; INSERT INTO auth.users(id,email) VALUES('${user}','${user}@example.test'),('${custodian}','${custodian}@example.test');
          INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','Synthetic API concurrency','${workspace}');
          INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${user}','owner'),('${workspace}','${custodian}','owner');
          SELECT ${save(revision,null)}; COMMIT;`);
        const first = mode === "edit" || mode === "identical-save" ? `SELECT ${save(next,revision)};` : mode === "revoke"
          ? `SELECT public.revoke_workspace_provider_api_connection('${user}','${workspace}','${connection}','${revision}');`
          : `UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='${workspace}' AND user_id='${user}';`;
        pending.push(start(`BEGIN; ${first} SELECT pg_sleep(4); COMMIT;`,a));
        await vi.waitFor(() => expect(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${a}' AND wait_event='PgSleep';`)).toBe("1"), { timeout: 5000, interval: 50 });
        const second = mode === "identical-save" ? `SELECT (${save(next,revision)})->>'created';` : `DO $$ BEGIN
          BEGIN PERFORM ${save(competing,revision)}; RAISE EXCEPTION 'Concurrent unauthorized or stale save accepted';
          EXCEPTION WHEN SQLSTATE '${mode === "membership" ? "42501" : "PT409"}' THEN NULL; END; END $$; SELECT 'CONCURRENT_SAVE_REFUSED';`;
        pending.push(start(second,b));
        let blocked = false;
        try {
          await vi.waitFor(() => expect(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${b}' AND wait_event_type='Lock';`)).toBe("1"), { timeout: 2500, interval: 50 });
          blocked = true;
        } catch { /* Report the competing command's result before a missing lock. */ }
        const [firstResult, secondResult] = await Promise.all(pending);
        expect(firstResult.code, firstResult.err).toBe(0); expect(secondResult.code, secondResult.err).toBe(0);
        expect(blocked, "Competing save never waited for the current transaction").toBe(true);
        expect(secondResult.out).toContain(mode === "identical-save" ? "false" : "CONCURRENT_SAVE_REFUSED");
        expect(sql(`SELECT count(*) FROM public.workspace_provider_api_revisions WHERE connection_id='${connection}';`)).toBe(mode === "edit" || mode === "identical-save" ? "2" : "1");
      } finally {
        await Promise.allSettled(pending);
        sql(`BEGIN; DELETE FROM public.workspaces WHERE id='${workspace}' OR (name IN ('${user}','${custodian}') AND id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id IN ('${user}','${custodian}'))); DELETE FROM auth.users WHERE id IN ('${user}','${custodian}'); COMMIT;`);
      }
    });
  }
});
