import { createHash, randomUUID } from "node:crypto";
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
    return {user,workspace,project,connection,request,packet,create,claim,finish,rows};
  }
  const jsonLine=(output:string)=>JSON.parse(output.split('\n').find(line=>line.startsWith('{'))!);

  function apiConnection(base: ReturnType<typeof fixture>) {
    const connectionId=randomUUID(),revisionId=randomUUID();
    const configuration=JSON.stringify({label:'Synthetic concurrency API',protocol:'openai_chat_completions',endpoint:'https://model.fixture.invalid/v1/',modelIds:['synthetic-api-model'],structuredOutput:true,authMode:'none',timeoutSeconds:120});
    const hash=createHash('sha256').update(configuration).digest('hex');
    const save=(revision=revisionId,previous:string|null=null)=>`SELECT public.save_workspace_provider_api_revision(${quote(base.user)},${quote(base.workspace)},${quote(connectionId)},${quote(revision)},${previous?quote(previous):'NULL'},${quote(configuration)},NULL)`;
    sql(save());
    const create=(request=base.request)=>`SELECT public.create_assistant_api_turn(${quote(request)},${quote(base.user)},${quote(base.workspace)},${quote(base.project)},${quote(connectionId)},${quote(revisionId)},${quote(hash)},'synthetic-api-model','connection_no_key',true,'Synthetic question',${quote(JSON.stringify(base.packet))})`;
    const claim="SELECT coalesce(public.claim_assistant_api_turn(),'null'::jsonb)";
    const finish=(turn:{id:string;attempt_id:string})=>`SELECT public.finish_assistant_provider_turn(${quote(turn.id)},${quote(turn.attempt_id)},${quote(base.user)},NULL,NULL,
      ${quote(JSON.stringify({answer:'Synthetic concurrency answer.',citations:[base.packet.source],proposal:null}))}::jsonb,
      jsonb_build_object('schemaVersion',1,'provider','api_connection','model','synthetic-api-model','authMode','connection_no_key','turnId',${quote(turn.id)},'attemptId',${quote(turn.attempt_id)},'connectionId',${quote(connectionId)},'revisionId',${quote(revisionId)},'configurationHash',${quote(hash)},'packetHash',${quote(createHash('sha256').update(JSON.stringify(base.packet)).digest('hex'))},'endpoint','https://model.fixture.invalid/v1/','protocol','openai_chat_completions'),NULL)`;
    const cleanup=()=>sql(`DELETE FROM public.assistant_provider_turns WHERE api_connection_id=${quote(connectionId)};
      DELETE FROM public.usage_events WHERE workspace_id=${quote(base.workspace)} AND idempotency_key LIKE 'assistant_api_dispatch:%'`);
    return {...base,connectionId,revisionId,save,create,claim,finish,cleanup};
  }
  function apiFixture() {
    // A global claim must never consume another session's committed test work.
    expect(sql("SELECT count(*) FROM public.assistant_provider_turns WHERE provider='api_connection' AND state IN ('queued','running')")).toBe('0');
    return apiConnection(fixture());
  }

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

  it("saved API identical creation retains one request",async()=>{
    const f=apiFixture(),first=transaction(f.create());let second:ReturnType<typeof background>|undefined;
    try {await first.ready;const name=`api-create-${randomUUID()}`;second=background(f.create(),name);await waitForLock(name);first.finish(true);
      const [one,two]=await Promise.all([first.done,second]);expect(one.code,one.output).toBe(0);expect(two.code,two.output).toBe(0);
      expect(jsonLine(one.output).created).toBe(true);expect(jsonLine(two.output).created).toBe(false);expect(jsonLine(two.output).turn).toEqual(jsonLine(one.output).turn);expect(f.rows()).toHaveLength(1);
    }finally{first.finish(false);await first.done;await second;f.cleanup();}
  });

  it("saved API competing claims retain one attempt and dispatch reservation",async()=>{
    const f=apiFixture();sql(f.create());const first=transaction(f.claim);let second:ReturnType<typeof background>|undefined;
    try {await first.ready;const name=`api-claim-${randomUUID()}`;second=background(f.claim,name);await waitForLock(name);first.finish(true);
      const [one,two]=await Promise.all([first.done,second]);expect(one.code,one.output).toBe(0);expect(two.code,two.output).toBe(0);
      const claimed=jsonLine(one.output);expect(claimed.state).toBe('running');expect(two.output.trim()).toBe('null');
      expect(f.rows()).toEqual([{id:claimed.id,state:'running',attempt:claimed.attempt_id,result:null}]);
      expect(sql(`SELECT count(*) FROM public.usage_events WHERE workspace_id=${quote(f.workspace)} AND idempotency_key LIKE 'assistant_api_dispatch:%'`)).toBe('1');
    }finally{first.finish(false);await first.done;await second;f.cleanup();}
  });

  it.each(['membership','project'])("saved API claim waits for an in-flight %s change",async change=>{
    const f=apiFixture();sql(f.create());const other=randomUUID();sql(`INSERT INTO public.workspaces(id,name,slug) VALUES(${quote(other)},'Synthetic API moved workspace',${quote(other)})`);
    const statement=change==='membership'?`DELETE FROM public.workspace_members WHERE user_id=${quote(f.user)} AND workspace_id=${quote(f.workspace)}`:`UPDATE public.projects SET workspace_id=${quote(other)} WHERE id=${quote(f.project)}`;
    const first=transaction(statement);let second:ReturnType<typeof background>|undefined;
    try {await first.ready;const name=`api-scope-${randomUUID()}`;second=background(f.claim,name);await waitForLock(name);first.finish(true);
      expect((await first.done).code).toBe(0);const denied=await second;expect(denied.code,denied.output).toBe(0);expect(denied.output.trim()).toBe('null');expect(f.rows()[0]).toMatchObject({state:'interrupted',result:null});
      expect(sql(`SELECT count(*) FROM public.usage_events WHERE workspace_id=${quote(f.workspace)} AND idempotency_key LIKE 'assistant_api_dispatch:%'`)).toBe('0');
    }finally{first.finish(false);await first.done;await second;f.cleanup();}
  });

  it.each(['edit','revoke','cancel'])("saved API completion waits for an in-flight %s and preserves the interruption",async operation=>{
    const f=apiFixture();sql(f.create());const turn=jsonLine(sql(f.claim));
    const statement=operation==='edit'?f.save(randomUUID(),f.revisionId):operation==='revoke'?`SELECT public.revoke_workspace_provider_api_connection(${quote(f.user)},${quote(f.workspace)},${quote(f.connectionId)},${quote(f.revisionId)})`:`SELECT public.cancel_assistant_provider_turn(${quote(turn.id)},${quote(f.user)})`;
    const first=transaction(statement);let second:ReturnType<typeof background>|undefined;
    try {await first.ready;const name=`api-stop-${randomUUID()}`;second=background(f.finish(turn),name);await waitForLock(name);first.finish(true);
      expect((await first.done).code).toBe(0);const stopped=await second;expect(stopped.code,stopped.output).toBe(0);
      expect(jsonLine(stopped.output)).toMatchObject({state:operation==='cancel'?'cancelled':'interrupted',result:null});
      expect(f.rows()[0]).toMatchObject({state:operation==='cancel'?'cancelled':'interrupted',result:null});
    }finally{first.finish(false);await first.done;await second;f.cleanup();}
  });

  it("saved API concurrent completions preserve the same result",async()=>{
    const f=apiFixture();sql(f.create());const turn=jsonLine(sql(f.claim)),first=transaction(f.finish(turn));let second:ReturnType<typeof background>|undefined;
    try {await first.ready;const name=`api-finish-${randomUUID()}`;second=background(f.finish(turn),name);await waitForLock(name);first.finish(true);
      const [one,two]=await Promise.all([first.done,second]);expect(one.code,one.output).toBe(0);expect(two.code,two.output).toBe(0);
      expect(jsonLine(two.output)).toEqual(jsonLine(one.output));expect(f.rows()[0].state).toBe('succeeded');expect(f.rows()).toHaveLength(1);
    }finally{first.finish(false);await first.done;await second;f.cleanup();}
  });

  it("saved API status locks its connection before reading the turn",async()=>{
    const f=apiFixture();sql(f.create());const turn=jsonLine(sql(f.claim));
    const first=transaction(`SELECT id FROM public.workspace_provider_api_connections WHERE id=${quote(f.connectionId)} FOR UPDATE`);let second:ReturnType<typeof background>|undefined;
    try {await first.ready;const name=`api-status-${randomUUID()}`;second=background(`SELECT public.read_assistant_api_turn_status(${quote(turn.id)},${quote(turn.attempt_id)})`,name);await waitForLock(name);
      expect(sql(`SELECT ${first.pid()}=ANY(pg_blocking_pids(pid)) FROM pg_stat_activity WHERE application_name=${quote(name)}`)).toBe('t');
      first.finish(true);expect((await first.done).code).toBe(0);const read=await second;expect(read.code,read.output).toBe(0);expect(jsonLine(read.output).state).toBe('running');
    }finally{first.finish(false);await first.done;await second;f.cleanup();}
  });

  it("saved API budget serializes different connections at the final reservation",async()=>{
    const a=apiFixture(),b=apiConnection(a);
    sql(`INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight) SELECT ${quote(a.workspace)},n::text,'assistant_chat',1 FROM generate_series(1,19) n`);
    // B's older creation is invisible until A has claimed the newer visible job.
    // Once B commits, a second claimant can select B while A still owns the
    // reservation lock. A connection lock alone cannot serialize this race.
    const older=transaction(b.create(randomUUID()));let first:ReturnType<typeof transaction>|undefined;let second:ReturnType<typeof background>|undefined;
    try {await older.ready;sql(a.create());first=transaction(a.claim);await first.ready;older.finish(true);expect((await older.done).code).toBe(0);
      const name=`api-budget-${randomUUID()}`;second=background(b.claim,name);await waitForLock(name);
      expect(sql(`SELECT wait_event FROM pg_stat_activity WHERE application_name=${quote(name)}`)).toBe('advisory');
      expect(sql(`SELECT ${first.pid()}=ANY(pg_blocking_pids(pid)) FROM pg_stat_activity WHERE application_name=${quote(name)}`)).toBe('t');
      first.finish(true);expect((await first.done).code).toBe(0);const denied=await second;expect(denied.code,denied.output).toBe(0);expect(denied.output.trim()).toBe('null');
      expect(sql(`SELECT state||':'||failure_code FROM public.assistant_provider_turns WHERE api_connection_id=${quote(b.connectionId)}`)).toBe('failed:api_rate_limited');
      expect(sql(`SELECT count(*) FROM public.usage_events WHERE workspace_id=${quote(a.workspace)} AND bucket_key='assistant_chat'`)).toBe('20');
    }finally{older.finish(false);first?.finish(false);await older.done;await first?.done;await second;a.cleanup();b.cleanup();}
  });
});
