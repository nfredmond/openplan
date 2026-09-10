import { randomUUID } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";

const live = LIVE_RLS ? describe : describe.skip;
live("approved submittal concurrency and connection loss", () => {
  let container: string;
  beforeAll(() => { container = resolveLocalDbContainer(); });
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  function args(name = "submittal-probe") { return ["exec", "-i", "-e", `PGAPPNAME=${name}`, container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]; }
  function sql(statement: string) { return execFileSync("docker", args(), { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  function background(statement: string, name: string) {
    return new Promise<{ code: number; output: string }>(resolve => {
      const child = execFile("docker", args(name), { encoding: "utf8" }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: stdout + stderr }));
      child.stdin!.end(statement);
    });
  }
  function transaction(statement: string) {
    const child = spawn("docker", args(`submittal-${randomUUID()}`), { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let pid = 0;
    const done = new Promise<{ code: number | null; output: string }>(resolve => child.on("close", code => resolve({ code, output })));
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Transaction never reached READY: ${output}`)), 10_000);
      child.stdout.on("data", chunk => {
        output += chunk.toString();
        const match = output.match(/PID:(\d+)/);
        if (match) pid = Number(match[1]);
        if (output.includes("TRANSACTION_READY")) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on("data", chunk => { output += chunk.toString(); });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", () => { clearTimeout(timer); if (!output.includes("TRANSACTION_READY")) reject(new Error(output)); });
    });
    child.stdin.write(`BEGIN; SELECT 'PID:'||pg_backend_pid(); ${statement}; SELECT 'TRANSACTION_READY';\n`);
    return { ready, done, pid: () => pid, finish: (commit: boolean) => { if (!child.stdin.destroyed) child.stdin.end(`${commit ? "COMMIT" : "ROLLBACK"};\n`); } };
  }
  async function waitForLock(name: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'`) === "1") return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Competing execution never waited on a database lock");
  }
  function fixture() {
    const user=randomUUID(), workspace=randomUUID(), project=randomUUID(), approval=randomUUID();
    const action=canonicalizeActionPayload({kind:"create_project_record",projectId:project,recordType:"submittal",title:"Synthetic concurrent submittal"});
    sql(`BEGIN;
      INSERT INTO auth.users(id,email) VALUES(${quote(user)},${quote(`${user}@example.test`)});
      INSERT INTO public.workspaces(id,name,slug) VALUES(${quote(workspace)},'Synthetic submittal concurrency',${quote(workspace)});
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(${quote(workspace)},${quote(user)},'owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES(${quote(project)},${quote(workspace)},'Synthetic concurrent project');
      INSERT INTO public.assistant_action_approvals(id,workspace_id,user_id,action_kind,input_hash,expires_at,execution_context)
      SELECT ${quote(approval)},w.id,${quote(user)},'create_project_record',encode(extensions.digest(${quote(action)},'sha256'),'hex'),now()+interval '5 minutes',
        jsonb_build_object('version',1,'action',${quote(action)}::jsonb,'project',jsonb_build_object('id',${quote(project)},'workspaceId',${quote(workspace)},'name','Synthetic concurrent project')) FROM public.workspaces w WHERE w.id=${quote(workspace)};
      COMMIT;`);
    const call=`SELECT public.record_assistant_project_submittal(${quote(approval)},${quote(user)},${quote(workspace)},${quote(action)})`;
    const count=()=>JSON.parse(sql(`SELECT jsonb_build_object('records',(SELECT count(*) FROM public.project_submittals WHERE project_id=${quote(project)}),'receipts',(SELECT count(*) FROM public.assistant_action_executions WHERE approval_id=${quote(approval)}),'consumed',(SELECT consumed_at IS NOT NULL FROM public.assistant_action_approvals WHERE id=${quote(approval)}))`));
    // These synthetic committed rows stay in the explicitly disposable stack for
    // inspection. They are never used as browser acceptance fixtures.
    return {user,workspace,project,approval,call,count};
  }

  it("serializes simultaneous uses of one approval and returns the same committed receipt", async () => {
    const f=fixture(), first=transaction(f.call);
    try {
      await first.ready;
      expect(f.count()).toEqual({records:0,receipts:0,consumed:false});
      const name=`submittal-${randomUUID()}`, second=background(f.call,name);
      await waitForLock(name);
      first.finish(true);
      const [one,two]=await Promise.all([first.done,second]);
      expect(one.code).toBe(0);expect(two.code,two.output).toBe(0);
      const original=JSON.parse(one.output.split('\n').find(line=>line.startsWith('{'))!);
      const replay=JSON.parse(two.output.trim());
      expect(original.replayed).toBe(false);expect(replay.replayed).toBe(true);expect(replay.receipt).toEqual(original.receipt);
      expect(f.count()).toEqual({records:1,receipts:1,consumed:true});
    } finally { first.finish(false); }
  });

  it("waits for an in-flight project move and refuses the old scope", async () => {
    const f=fixture(), other=randomUUID();
    sql(`INSERT INTO public.workspaces(id,name,slug) VALUES(${quote(other)},'Synthetic other scope',${quote(other)})`);
    const move=transaction(`UPDATE public.projects SET workspace_id=${quote(other)} WHERE id=${quote(f.project)}`);
    try {
      await move.ready;
      const name=`submittal-${randomUUID()}`, agent=background(f.call,name);
      await waitForLock(name);
      move.finish(true);expect((await move.done).code).toBe(0);
      const result=await agent;
      expect(result.code).toBe(1);expect(result.output).toContain('Project is not in the approved workspace');
      expect(f.count()).toEqual({records:0,receipts:0,consumed:false});
    } finally { move.finish(false); }
  });

  it("rolls back a lost database connection and safely executes the same approval afterward", async () => {
    const f=fixture(), interrupted=transaction(f.call);
    try {
      await interrupted.ready;
      expect(interrupted.pid()).toBeGreaterThan(0);
      expect(f.count()).toEqual({records:0,receipts:0,consumed:false});
      // Terminate only the backend PID created and observed by this test.
      expect(sql(`SELECT pg_terminate_backend(${interrupted.pid()})`)).toBe('t');
      interrupted.finish(false);
      expect((await interrupted.done).code).not.toBe(0);
      expect(f.count()).toEqual({records:0,receipts:0,consumed:false});
      const retry=JSON.parse(sql(f.call));expect(retry.replayed).toBe(false);
      expect(f.count()).toEqual({records:1,receipts:1,consumed:true});
    } finally { interrupted.finish(false); }
  });
});
