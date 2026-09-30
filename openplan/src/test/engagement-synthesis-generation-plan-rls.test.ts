import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { retainSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan-server";
import { createSynthesisGenerationPlan, synthesisGenerationPlanBatch, verifySynthesisGenerationPlanState } from "@/lib/engagement/synthesis-generation-plan";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const requestId = "f0000000-0000-4000-8000-000000000001";
const scope = { requestId: "d0000000-0000-4000-8000-000000000002", campaignId: "10c5cdd7-16c6-4b91-b9c0-d2f67598a54f", workspaceId: "d51d566d-28c6-49d2-95d2-3a7a2f0902e1" };
const migration = readFileSync("supabase/migrations/20261014000034_engagement_synthesis_generation_plans.sql", "utf8");
const sourceFixture = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const setup = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];

/** The actual source, request, TypeScript plan and native batches share one rollback transaction. */
async function exercise(comment = "") {
  const db = rollbackSqlConnection(resolveLocalDbContainer());
  const large = comment.includes("large packet");
  const selectedScope = { ...scope, requestId: large ? "d0000000-0000-4000-8000-000000000777" : scope.requestId };
  try {
    await db.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_PLAN_CANDIDATE === "1" ? migration : ""}
      ${sourceFixture}\n${setup}\n${comment}
      ${large ? `RESET ROLE; INSERT INTO engagement_items(id,campaign_id,body,status,source_type,configuration_version_id,created_at)
        SELECT 'b0000000-0000-4000-8000-000000000777',id,repeat('SYNTHETIC Unicode é ',70000)||'FULL LARGE TAIL',
          'approved','internal',configuration_version_id,'2026-01-02T12:00:00Z' FROM engagement_campaigns WHERE id='${scope.campaignId}';
        SET LOCAL ROLE authenticated; SELECT pg_temp.capture('${selectedScope.requestId}'); RESET ROLE;
        UPDATE generation_probe SET value=value||jsonb_build_object('taskByteLimit',1048576,'sourceId','${selectedScope.requestId}',
          'sourceSha256',(SELECT snapshot_sha256 FROM engagement_synthesis_sources WHERE id='${selectedScope.requestId}')) WHERE key='intent';` : ""}
      SET LOCAL ROLE authenticated; SELECT pg_temp.gen_create();`);
    const saved = JSON.parse((await db.query(`SELECT pg_temp.read_source('${selectedScope.requestId}');`)).at(-1)!);
    const request = JSON.parse((await db.query(`RESET ROLE; SELECT jsonb_build_object('id',id,'intentText',intent_text,'intentSha256',intent_sha256)
      FROM public.engagement_synthesis_generation_requests WHERE id='${requestId}';`)).at(-1)!);
    const plan = createSynthesisGenerationPlan(request, saved, selectedScope);
    if (large) expect(Math.max(...plan.entries.map(entry => entry.utf8Bytes))).toBeGreaterThan(200_000);
    expect(plan.header.contributionCount).toBe(large ? 304 : 303);
    const rpc = async (call: string) => JSON.parse((await db.query(`SET LOCAL ROLE service_role; SELECT ${call}; RESET ROLE;`)).at(-1)!);
    const prepared = await rpc(`prepare_engagement_synthesis_generation_plan('${requestId}',${literal(plan.headerText)})`);
    expect(verifySynthesisGenerationPlanState(plan, prepared).nextIndex).toBe(0);
    let start = 0;
    while (start < plan.entries.length) {
      const batch = synthesisGenerationPlanBatch(plan, start)!;
      const call = `stage_engagement_synthesis_generation_tasks('${requestId}',${start},'${batch.previousSha256}',${literal(batch.tasksText)})`;
      const result = await rpc(call);
      expect(verifySynthesisGenerationPlanState(plan, result).nextIndex).toBe(batch.nextIndex);
      // Reconstruct after an unknown acknowledgement, then retry the same bytes.
      expect(await rpc(call)).toEqual(result);
      start = batch.nextIndex;
    }
    const sealed = await rpc(`seal_engagement_synthesis_generation_plan('${requestId}','${plan.headerSha256}')`);
    expect(verifySynthesisGenerationPlanState(plan, sealed).seal).not.toBeNull();
    expect(await rpc(`seal_engagement_synthesis_generation_plan('${requestId}','${plan.headerSha256}')`)).toEqual(sealed);
    const retained = (await db.query(`SET LOCAL ROLE service_role; SELECT json_build_object('index',task_index,'canonical',task_text,'sha256',task_sha256,'utf8Bytes',task_bytes)
      FROM engagement_synthesis_generation_plan_tasks WHERE request_id='${requestId}' ORDER BY task_index; RESET ROLE;`)).map(line => JSON.parse(line));
    expect(retained).toEqual(plan.taskPlan.tasks);
    // The worker driver also crosses the real SQL boundary after a lost response.
    const driverId = "f0000000-0000-4000-8000-000000000002";
    await db.query(`SET LOCAL ROLE authenticated; SELECT pg_temp.gen_create('${driverId}'); RESET ROLE;`);
    const driverRequest = { ...request, id: driverId };
    const signatures: Record<string, string[]> = {
      prepare_engagement_synthesis_generation_plan: ["p_request", "p_header_text"],
      stage_engagement_synthesis_generation_tasks: ["p_request", "p_start", "p_previous_sha256", "p_tasks_text"],
      seal_engagement_synthesis_generation_plan: ["p_request", "p_header_sha256"],
    };
    let loseResponse = true, retainedThrough = 0;
    const starts: number[] = [];
    const service = { rpc: async (name: string, args: Record<string, unknown>) => {
      const keys = signatures[name]; if (!keys) throw new Error("Unexpected planning RPC");
      expect(Object.keys(args)).toEqual(keys);
      const data = await rpc(`${name}(${keys.map(key => typeof args[key] === "number" ? String(args[key]) : literal(String(args[key]))).join(",")})`);
      if (name === "stage_engagement_synthesis_generation_tasks") {
        starts.push(args.p_start as number);
        if (loseResponse) { loseResponse = false; retainedThrough = data.nextIndex; return { data: null, error: { message: "SYNTHETIC acknowledgement lost after commit" } }; }
      }
      return { data, error: null };
    } } as unknown as Pick<SupabaseClient, "rpc">;
    await expect(retainSynthesisGenerationPlan(service, driverRequest, saved, selectedScope)).rejects.toThrow("acknowledgement unavailable");
    expect(retainedThrough).toBeGreaterThan(0);
    const resumed = await retainSynthesisGenerationPlan(service, driverRequest, saved, selectedScope);
    expect(resumed.state.seal).not.toBeNull();
    if (retainedThrough < resumed.plan.entries.length) expect(starts[1]).toBe(retainedThrough);
    expect(await retainSynthesisGenerationPlan(service, driverRequest, saved, selectedScope)).toEqual(resumed);
    await db.query(`SET LOCAL ROLE authenticated; SELECT pg_temp.gen_cancel(); RESET ROLE;`);
    const cancelled = await rpc(`prepare_engagement_synthesis_generation_plan('${requestId}',${literal(plan.headerText)})`);
    expect(verifySynthesisGenerationPlanState(plan, cancelled)).toEqual({ ...sealed, cancelled: true });
  } finally { await db.close(); }
}
describe.skipIf(!LIVE_RLS)("native synthesis plan staging", () => {
  it.each(["", "-- Harmless plan custody control", "-- Native large packet control"])("retains complete native source bytes through resumable batches %s", exercise, 90_000);
});

const custodyFixture = readFileSync("src/test/fixtures/engagement/synthesis-generation-plans.sql", "utf8");
function nativeCustody(before = "") {
  const container = resolveLocalDbContainer();
  // The shared helper also checks the named isolated target before opening a session.
  requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
    ${process.env.OPENPLAN_SYNTHESIS_PLAN_CANDIDATE === "1" ? migration : ""}
    ${sourceFixture}\n${setup}\n${before}\n${custodyFixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
  });
}
describe.skipIf(!LIVE_RLS)("native synthesis plan guards", () => {
  it.each(["", "-- Harmless structural custody control"])("preserves source, prefix, cancellation and private access %s", before => {
    expect(nativeCustody(before)).toContain("synthesis-generation-plan-custody-verified");
  });
});

const prepareFunction = "public.prepare_engagement_synthesis_generation_plan(uuid,text)";
const stageFunction = "public.stage_engagement_synthesis_generation_tasks(uuid,bigint,text,text)";
const sealFunction = "public.seal_engagement_synthesis_generation_plan(uuid,text)";
const scopeFunction = "public.lock_synthesis_generation_plan_scope(uuid)";
const readFunction = "public.read_engagement_synthesis_generation_plan(uuid)";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing plan mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
const headerFaults = [
  ["schema", "OR header->'schemaVersion' IS DISTINCT FROM '1'::jsonb"],
  ["purpose", "OR header->>'purpose' IS DISTINCT FROM 'private_synthesis_segment_plan'"],
  ["request identity", "OR header->>'requestId' IS DISTINCT FROM p_request::text"],
  ["intent hash", "OR header->>'intentSha256' IS DISTINCT FROM request.intent_sha256"],
  ["recipe identity", "OR header->>'recipeId' IS DISTINCT FROM 'openplan.engagement.synthesis.segment.v1'"],
  ["recipe hash", "OR header->>'recipeSha256' IS DISTINCT FROM 'bc91bcf4ca0a31468a8a9c7aa4b383855382f7888eeb70ed7bb143ff2f8a473b'"],
];
const planFaults = [
  ...headerFaults.map(([name, seam]) => [name, change(prepareFunction, seam, ""), "Malformed plan header accepted"]),
  ["plan retry bytes", change(prepareFunction, "IF plan.header_text IS DISTINCT FROM p_header_text THEN", "IF false THEN"), "Changed plan header bytes replayed"],
  ["cancel before preparation", change(prepareFunction, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations", "IF false AND EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations"), "Cancelled request prepared"],
  ["task sequence and prefix", change(stageFunction, "p_start>next_index OR", "") + change(stageFunction, "IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN", "IF false THEN"), "Out of sequence task accepted"],
  ["task prefix", change(stageFunction, "IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN", "IF false THEN"), "Wrong prefix accepted"],
  ["batch limit", change(stageFunction, "OR octet_length(p_tasks_text)>4194304", ""), "Oversized staging packet accepted"],
  ["task count limit", change(stageFunction, "task_count NOT BETWEEN 1 AND 128", "task_count<1"), "Oversized task count accepted"],
  ["task byte limit", change(stageFunction, "OR octet_length(task)>(request.intent_text::jsonb->>'taskByteLimit')::integer", ""), "Oversized task accepted"],
  ...["requestId", "campaignId", "workspaceId", "sha256"].map(key => {
    const rhs = key === "requestId" ? "request.source_id::text" : key === "campaignId" ? "request.campaign_id::text" : key === "workspaceId" ? "request.workspace_id::text" : "request.intent_text::jsonb->>'sourceSha256'";
    return [`task ${key}`, change(stageFunction, `OR task::jsonb#>>'{input,source,${key}}' IS DISTINCT FROM ${rhs}`, ""), "Foreign task source accepted"];
  }),
  ["task retry bytes", change(stageFunction, "IF existing IS DISTINCT FROM entry#>>'{}' THEN", "IF false THEN"), "Changed task retry accepted"],
  ["byte total ceiling", change(stageFunction, "IF bytes>(header->>'taskBytes')::bigint THEN", "IF false THEN"), "Staging exceeded declared byte total"],
  ["cancel before staging", change(stageFunction, "state->>'cancelled'='true' OR", ""), "Cancelled plan staged new work"],
  ["seal header identity", change(sealFunction, "IF p_header_sha256 IS DISTINCT FROM state->>'headerSha256' THEN", "IF false THEN"), "Wrong plan identity sealed"],
  ["seal count", change(sealFunction, "state->'nextIndex' IS DISTINCT FROM header->'taskCount' OR", ""), "Seal ignored expected task count"],
  ["seal bytes", change(sealFunction, "state->'taskBytes' IS DISTINCT FROM header->'taskBytes'", "false"), "Seal ignored expected byte total"],
  ["seal chain", change(sealFunction, "OR state->>'tailSha256' IS DISTINCT FROM header->>'tailSha256'", ""), "Seal ignored expected chain"],
  ["cancel before sealing", change(sealFunction, "IF state->>'cancelled'='true' THEN", "IF false THEN"), "Cancelled complete plan sealed"],
  ["retained campaign scope", change(scopeFunction, "AND workspace_id=saved.workspace_id FOR SHARE NOWAIT", "FOR SHARE NOWAIT"), "Worker ignored changed campaign scope"],
  ["retained requester membership", change(scopeFunction, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Worker ignored revoked requester"],
  ["immutable header", "ALTER TABLE engagement_synthesis_generation_plans DISABLE TRIGGER synthesis_generation_plan_immutable;", "Retained plan mutation allowed"],
  ["immutable task", "ALTER TABLE engagement_synthesis_generation_plan_tasks DISABLE TRIGGER synthesis_generation_plan_task_immutable;", "Retained task mutation allowed"],
  ["immutable seal", "ALTER TABLE engagement_synthesis_generation_plan_seals DISABLE TRIGGER synthesis_generation_plan_seal_immutable;", "Retained seal deletion allowed"],
  ["private helper", `GRANT EXECUTE ON FUNCTION ${scopeFunction} TO service_role;`, "Worker private lock helper exposed"],
  ...[[readFunction, "reader"], [prepareFunction, "writer"], [stageFunction, "task writer"], [sealFunction, "seal writer"]].map(([target, name]) => [
    `authenticated ${name}`, `GRANT EXECUTE ON FUNCTION ${target} TO authenticated;`,
    name === "reader" || name === "writer" ? `Authenticated plan ${name} exposed` : `Authenticated ${name} exposed`,
  ]),
  ["anonymous read", `GRANT EXECUTE ON FUNCTION ${readFunction} TO anon;`, "Anonymous plan reader exposed"],
  ...[["plans", "plan"], ["plan_tasks", "task"], ["plan_seals", "seal"]].map(([suffix, name]) => [
    `private ${name} table`, `GRANT SELECT ON engagement_synthesis_generation_${suffix} TO authenticated; CREATE POLICY synthetic_plan_read ON engagement_synthesis_generation_${suffix} FOR SELECT TO authenticated USING(true);`, `Private ${name} table exposed`,
  ]),
];
describe.skipIf(!LIVE_RLS)("native synthesis plan fault evidence", () => {
  it("survives a harmless function comment change", () => {
    expect(nativeCustody(change(prepareFunction, "-- Exact acknowledgement recovery", "-- Retained acknowledgement control"))).toContain("synthesis-generation-plan-custody-verified");
  });
  it("retains prefix refusal when the removed sequence check survives", () => {
    expect(nativeCustody(change(stageFunction, "p_start>next_index OR", ""))).toContain("synthesis-generation-plan-custody-verified");
  });
  it.each(planFaults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown;
    try { nativeCustody(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});

/** An independent connection holds the same request fence used by cancellation.
 * Fixture creation alone skips its advisory lock, then restores that function
 * before either plan command or competing cancellation runs. All changes roll back.
 */
async function requestFence(heldRequest: string, removePlanFence = false) {
  const container = resolveLocalDbContainer();
  const db = rollbackSqlConnection(container), holder = rollbackSqlConnection(container);
  try {
    await db.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_PLAN_CANDIDATE === "1" ? migration : ""}
      ${sourceFixture}\n${setup}`);
    const original = (await db.query(`SELECT to_json(pg_get_functiondef('public.lock_synthesis_generation_request_scope(uuid,uuid)'::regprocedure));`));
    // JSON encoding keeps the function body in one protocol row.
    const body = JSON.parse(original.at(-1)!) as string;
    expect(body).toContain("IF NOT pg_try_advisory_xact_lock");
    await db.query(body.replace("IF NOT pg_try_advisory_xact_lock", "IF false AND NOT pg_try_advisory_xact_lock") + `;
      SET LOCAL ROLE authenticated; SELECT pg_temp.gen_create(); RESET ROLE;` + body + ";");
    await holder.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('synthesis-generation-request:${heldRequest}',0));`);
    if (removePlanFence) await db.query(change(scopeFunction, "IF NOT pg_try_advisory_xact_lock", "IF false AND NOT pg_try_advisory_xact_lock"));
    if (heldRequest !== requestId) {
      await db.query(`SET LOCAL ROLE service_role;
        SELECT pg_temp.expect_error('SELECT read_engagement_synthesis_generation_plan(''${requestId}'')','PT409','Unrelated lock blocked plan read');`);
    } else {
      await db.query(`SET LOCAL ROLE service_role;
        SELECT pg_temp.expect_error('SELECT read_engagement_synthesis_generation_plan(''${requestId}'')','PT503','Plan read ignored request fence');
        SELECT pg_temp.expect_error('SELECT prepare_engagement_synthesis_generation_plan(''${requestId}'',''{}'')','PT503','Plan preparation ignored request fence');
        SELECT pg_temp.expect_error('SELECT stage_engagement_synthesis_generation_tasks(''${requestId}'',0,repeat(''a'',64),''[]'')','PT503','Task staging ignored request fence');
        SELECT pg_temp.expect_error('SELECT seal_engagement_synthesis_generation_plan(''${requestId}'',repeat(''a'',64))','PT503','Plan seal ignored request fence');
        RESET ROLE; SET LOCAL ROLE authenticated;
        SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','PT503','Cancellation used another request fence');`);
    }
  } finally {
    await holder.close();
    await db.close();
  }
}
describe.skipIf(!LIVE_RLS)("native synthesis plan serialization", () => {
  it("allows an unrelated held request", async () => { await requestFence("f0000000-0000-4000-8000-000000000999"); });
  it("serializes every plan command with cancellation", async () => { await requestFence(requestId); });
  it("detects removal of the plan request fence", async () => {
    await expect(requestFence(requestId, true)).rejects.toThrow("Plan read ignored request fence");
  });
});
