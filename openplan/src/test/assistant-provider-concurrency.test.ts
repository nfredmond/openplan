import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live("provider transaction competition", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) throw new Error("Provider fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    container = resolveLocalDbContainer();
  });
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  function args(name = "provider-probe") { return ["exec", "-i", "-e", `PGAPPNAME=${name}`, container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"]; }
  function sql(statement: string) { return execFileSync("docker", args(), { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  function background(statement: string, name: string) {
    return new Promise<{ code: number; output: string }>(resolve => {
      const child = execFile("docker", args(name), { encoding: "utf8" }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: stdout + stderr }));
      child.stdin!.end(statement);
    });
  }
  function transaction(statement: string) {
    const child = spawn("docker", args(`provider-${randomUUID()}`), { stdio: ["pipe", "pipe", "pipe"] });
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
    child.stdin.write(`BEGIN; SET LOCAL statement_timeout='12s'; SELECT 'PID:'||pg_backend_pid(); ${statement}; SELECT 'TRANSACTION_READY';\n`);
    return { ready, done, pid: () => pid, finish: (commit: boolean) => { if (!child.stdin.destroyed) child.stdin.end(`${commit ? "COMMIT" : "ROLLBACK"};\n`); } };
  }
  async function waitForLock(name: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(name)} AND wait_event_type='Lock'`) === "1") return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Competing execution never waited on a database lock");
  }
  function fixture(provider: "codex" | "anthropic" = "codex") {
    const custodian=randomUUID(),user=randomUUID(),workspace=randomUUID(),project=randomUUID(),connection=randomUUID(),request=randomUUID(),tokenHash=randomUUID().replaceAll("-","")+randomUUID().replaceAll("-","");
    const packet={version:1,workspaceId:workspace,capturedAt:"2026-09-10T00:00:00Z",project:{id:project,name:"Synthetic provider concurrency",summary:null,status:"active",planType:"corridor",deliveryPhase:"planning",updatedAt:"2026-09-10T00:00:00Z"},source:{id:`project:${project}`,href:`/projects/${project}`,label:"Synthetic provider concurrency"}};
    sql(`BEGIN; INSERT INTO auth.users(id,email) VALUES(${quote(user)},${quote(`${user}@example.test`)}),(${quote(custodian)},${quote(`${custodian}@example.test`)});
      INSERT INTO public.workspaces(id,name,slug) VALUES(${quote(workspace)},'Synthetic provider concurrency',${quote(workspace)});
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(${quote(workspace)},${quote(user)},'owner'),(${quote(workspace)},${quote(custodian)},'owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES(${quote(project)},${quote(workspace)},'Synthetic provider concurrency');
      SELECT public.create_assistant_provider_connection(${quote(connection)},${quote(user)},${quote(workspace)},${quote(project)},'Synthetic connection',${quote(tokenHash)},'chatgpt'); COMMIT;`);
    const create=(id=request)=>`SELECT public.create_assistant_provider_turn(${quote(id)},${quote(user)},${quote(workspace)},${quote(project)},${provider==='codex'?quote(connection):'NULL'},${quote(provider)},'fixture-model',${quote(provider==='codex'?'chatgpt':'deployment_api_key')},'Synthetic question',${quote(JSON.stringify(packet))})`;
    const claim=`SELECT public.claim_assistant_provider_turn(${quote(connection)},${quote(tokenHash)},'chatgpt','connected')`;
    const finish=(turn: {id:string;attempt_id:string})=>`SELECT public.finish_assistant_provider_turn(${quote(turn.id)},${quote(turn.attempt_id)},${provider==='codex'?'NULL':quote(user)},${provider==='codex'?quote(connection):'NULL'},${provider==='codex'?quote(tokenHash):'NULL'},${quote(JSON.stringify({answer:'Synthetic answer; costs unknown.',citations:[packet.source],proposal:null}))}::jsonb,${quote(JSON.stringify({schemaVersion:1,provider,model:'fixture-model',authMode:provider==='codex'?'chatgpt':'deployment_api_key'}))}::jsonb,NULL)`;
    const rows=()=>JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'attempt',attempt_id,'result',result) ORDER BY created_at,id),'[]'::jsonb) FROM public.assistant_provider_turns WHERE project_id=${quote(project)}`));
    // Committed synthetic records remain only in the named disposable SQL stack.
    return {user,workspace,project,connection,request,create,claim,finish,rows};
  }
  const jsonLine=(output:string)=>JSON.parse(output.split('\n').find(line=>line.startsWith('{'))!);

  it.each(["codex","anthropic"] as const)("serializes identical %s creation without another attempt", async provider => {
    const f=fixture(provider),first=transaction(f.create());
    try {
      await first.ready;expect(f.rows()).toHaveLength(0);
      const name=`provider-${randomUUID()}`,second=background(f.create(),name);await waitForLock(name);first.finish(true);
      const [one,two]=await Promise.all([first.done,second]);expect(one.code,one.output).toBe(0);expect(two.code,two.output).toBe(0);
      const original=jsonLine(one.output),replay=jsonLine(two.output);expect(original.created).toBe(true);expect(replay.created).toBe(false);expect(replay.turn).toEqual(original.turn);expect(f.rows()).toHaveLength(1);
    } finally {first.finish(false);await first.done;}
  });

  it("only claims one queued turn while another connector is committing a claim",async()=>{
    const f=fixture();sql(f.create());sql(f.create(randomUUID()));const first=transaction(f.claim);
    try {await first.ready;const name=`provider-${randomUUID()}`,second=background(f.claim,name);await waitForLock(name);first.finish(true);
      const [one,two]=await Promise.all([first.done,second]);expect(one.code,one.output).toBe(0);expect(two.code,two.output).toBe(0);expect(jsonLine(one.output).turn.state).toBe('running');expect(jsonLine(two.output).turn).toBeNull();
      expect(f.rows().map((row:{state:string})=>row.state)).toEqual(['running','queued']);
    }finally{first.finish(false);await first.done;}
  });

  it.each(["membership","project"])("waits for an in-flight %s change before disclosing a claim",async change=>{
    const f=fixture();sql(f.create());const other=randomUUID();sql(`INSERT INTO public.workspaces(id,name,slug) VALUES(${quote(other)},'Synthetic other workspace',${quote(other)})`);
    const statement=change==='membership'?`DELETE FROM public.workspace_members WHERE user_id=${quote(f.user)} AND workspace_id=${quote(f.workspace)}`:`UPDATE public.projects SET workspace_id=${quote(other)} WHERE id=${quote(f.project)}`;
    const first=transaction(statement);
    try{await first.ready;const name=`provider-${randomUUID()}`,second=background(f.claim,name);await waitForLock(name);first.finish(true);expect((await first.done).code).toBe(0);const denied=await second;expect(denied.code,denied.output).toBe(1);expect(denied.output).toContain('Provider project access denied');expect(f.rows()[0].state).toBe('queued');}
    finally{first.finish(false);await first.done;}
  });

  it.each(["cancel","revoke"])("does not publish a delivery after an in-flight %s commits",async operation=>{
    const f=fixture();sql(f.create());const turn=JSON.parse(sql(f.claim)).turn;
    const first=transaction(operation==='cancel'?`SELECT public.cancel_assistant_provider_turn(${quote(turn.id)},${quote(f.user)})`:`SELECT public.revoke_assistant_provider_connection(${quote(f.connection)},${quote(f.user)})`);
    try{await first.ready;const name=`provider-${randomUUID()}`,second=background(f.finish(turn),name);await waitForLock(name);first.finish(true);expect((await first.done).code).toBe(0);const denied=await second;expect(denied.code,denied.output).toBe(1);expect(denied.output).toContain(operation==='cancel'?'Provider attempt is no longer running':'Provider connection denied');expect(f.rows()[0]).toMatchObject({state:'cancelled',result:null});}
    finally{first.finish(false);await first.done;}
  });

  it("returns the original result when two deliveries race",async()=>{
    const f=fixture();sql(f.create());const turn=JSON.parse(sql(f.claim)).turn,first=transaction(f.finish(turn));
    try{await first.ready;const name=`provider-${randomUUID()}`,second=background(f.finish(turn),name);await waitForLock(name);first.finish(true);const [one,two]=await Promise.all([first.done,second]);expect(one.code,one.output).toBe(0);expect(two.code,two.output).toBe(0);expect(jsonLine(two.output)).toEqual(jsonLine(one.output));expect(f.rows()[0].state).toBe('succeeded');expect(f.rows()).toHaveLength(1);}
    finally{first.finish(false);await first.done;}
  });
});
