import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSynthesisGenerationPlan, synthesisGenerationPlanBatch, verifySynthesisGenerationPlanState } from "@/lib/engagement/synthesis-generation-plan";
import { createSynthesisGenerationResult, type SynthesisGenerationAttemptBinding } from "@/lib/engagement/synthesis-generation-results";
import { retainSynthesisGenerationOutput } from "@/lib/engagement/synthesis-generation-delivery";
import { readSynthesisGenerationSelections } from "@/lib/engagement/synthesis-generation-selections-server";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const migration = readFileSync("supabase/migrations/20261014000035_engagement_synthesis_generation_execution.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const plans = readFileSync("src/test/fixtures/engagement/synthesis-generation-plans.sql", "utf8").split("-- Clear the staff JWT claim.")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-generation-execution.sql", "utf8");

// These transaction probes establish native custody, not process-crash recovery,
// provider authenticity, network protection or semantic usefulness of results.
function nativeExecution(before = "", keyed = false) {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const setup = keyed ? requests.replace('"authMode":"none"', '"authMode":"api_key"')
    .replace('"timeoutSeconds":10}\',NULL);', '"timeoutSeconds":10}\',\'v2:SYNTHETIC original key\');') : requests;
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_EXECUTION_CANDIDATE === "1" ? migration : ""}
      ${source}\n${setup}\n${plans}\n${before}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
  });
}
const grant = "public.authorize_engagement_synthesis_generation(uuid,uuid,text)";
const claim = "public.claim_engagement_synthesis_generation_attempt(uuid,bigint,uuid,uuid)";
const dispatch = "public.dispatch_engagement_synthesis_generation_attempt(uuid,uuid)";
const output = "public.retain_engagement_synthesis_generation_output(uuid,uuid,text,text)";
const current = "public.assert_synthesis_generation_execution_current(uuid)";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing execution mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
const faults = [
  ["sealed preparation", change(current, "NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_seals WHERE request_id=p_request)", "false"), "Unsealed plan authorized"],
  ["nonempty contribution selection", change(current, "(header_text::jsonb->>'contributionCount')::bigint>0", "true"), "Empty selection authorized"],
  ["original requester", change(grant, "auth.uid() IS DISTINCT FROM request.actor_id", "false"), "Different actor granted execution"],
  ["grant exact retry", change(grant, "saved.intent_text IS DISTINCT FROM p_intent_text", "false"), "Changed grant replayed"],
  ["grant schema", change(grant, "OR intent->'schemaVersion' IS DISTINCT FROM '1'::jsonb", ""), "Malformed execution grant accepted"],
  ["explicit charge acknowledgement", change(grant, "OR intent->'chargesAcknowledged' IS DISTINCT FROM 'true'::jsonb", ""), "Malformed execution grant accepted"],
  ["grant unknown field", change(grant, "(SELECT count(*) FROM jsonb_object_keys(intent))<>9", "false"), "Malformed execution grant accepted"],
  ["output token limit", change(grant, "(intent->>'maxOutputTokens')::bigint>65536", "false"), "Malformed execution grant accepted"],
  ["response byte limit", change(grant, "(intent->>'responseByteLimit')::bigint NOT BETWEEN 4096 AND 4194304", "false"), "Malformed execution grant accepted"],
  ["sealed plan binding", change(grant, "intent->>'headerSha256' IS DISTINCT FROM plan.header_sha256", "false"), "Wrong plan authorized"],
  ["expired grant creation", change(grant, "expiry<=clock_timestamp()", "false"), "Expired grant created"],
  ["initial grant inventory", change(grant, "(intent->>'maxAttempts')::bigint>(plan.header_text::jsonb->>'taskCount')::bigint", "false"), "Malformed execution grant accepted"],
  ["claim exact task", change(claim, "OR attempt.task_index IS DISTINCT FROM p_task_index", ""), "Changed claim replayed"],
  ["claim exact worker", change(claim, "OR attempt.worker_id IS DISTINCT FROM p_worker", ""), "Changed worker claim replayed"],
  ["attempt budget", change(claim, "(SELECT count(*) FROM engagement_synthesis_generation_attempts WHERE authorization_id=p_authorization)>=(intent->>'maxAttempts')::bigint", "false"), "Valid task exceeded grant allowance"],
  ["no automatic task retry", change(claim, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_attempts WHERE request_id=grant_row.request_id AND task_index=p_task_index) THEN", "IF false THEN"), "Initial grant retried an attempted task"],
  ["dispatch worker", change(dispatch, "OR attempt.worker_id IS DISTINCT FROM p_worker", ""), "Wrong worker dispatched"],
  ["one-time dispatch acknowledgement", change(dispatch, "allowed boolean:=false", "allowed boolean:=true"), "Dispatch acknowledgement replay authorized another call"],
  ["claim expiry", change(dispatch, "attempt.claim_expires_at<=clock_timestamp()", "false"), "Expired claim dispatched"],
  ["claim authorization expiry", change(claim, "expiry<=clock_timestamp()", "false"), "Expired authorization claimed"],
  ["dispatch authorization expiry", change(dispatch, "OR expiry<=clock_timestamp()", ""), "Expired grant dispatched"],
  ["connection revocation", change(current, "OR connection.revoked_at IS NOT NULL", ""), "Revoked connection dispatched"],
  ["current revision", change(current, "OR connection.current_revision_id IS DISTINCT FROM request.configuration_revision_id", ""), "Changed revision dispatched"],
  ["credential row custody", change(current, "IF NOT FOUND OR (revision.configuration->>'authMode'='api_key'", "IF false OR (revision.configuration->>'authMode'='api_key'"), "Missing credential dispatched"],
  ["cancellation", change(current, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations", "IF false AND EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations"), "Cancelled job dispatched"],
  ["active predecessor", change(grant, "AND greatest(previous.claim_expires_at", "AND false AND greatest(previous.claim_expires_at"), "Active attempt retried"],
  ["capture checksum", change(output, "OR encode(extensions.digest(capture,'sha256'),'hex') IS DISTINCT FROM p_capture_sha256", ""), "Wrong capture checksum accepted"],
  ["canonical base64", change(output, "OR replace(encode(convert_to(capture,'UTF8'),'base64'),E'\\n','') IS DISTINCT FROM p_capture_base64", ""), "Noncanonical base64 accepted"],
  ["capture resource bound", change(output, "octet_length(p_capture_base64)>((byte_limit+2)/3)*4", "false") + change(output, "octet_length(capture)>byte_limit", "false"), "Oversized capture retained"],
  ["capture exact bytes", change(output, "saved.capture_text IS DISTINCT FROM capture", "false"), "Changed output replayed"],
  ["capture worker", change(output, "OR attempt.worker_id IS DISTINCT FROM p_worker", ""), "Wrong worker retained output"],
  ...["authorizations", "attempts", "dispatches", "outputs"].map((name, index) => [
    `immutable ${name}`, `ALTER TABLE engagement_synthesis_generation_${name} DISABLE TRIGGER synthesis_generation_${["authorization", "attempt", "dispatch", "output"][index]}_immutable;`,
    `Execution history deletion allowed: ${name}`,
  ]),
  ["service authorization privilege", `GRANT EXECUTE ON FUNCTION ${grant} TO service_role;`, "Service granted human execution"],
  ["private authority helper", `GRANT EXECUTE ON FUNCTION ${current} TO service_role;`, "Private execution authority helper exposed"],
  ...[[claim, "claim"], [dispatch, "dispatch"], [output, "output"]].map(([target, name]) => [
    `authenticated ${name}`, `GRANT EXECUTE ON FUNCTION ${target} TO authenticated;`, `Authenticated ${name} command exposed`,
  ]),
  ...["authorizations", "attempts", "dispatches", "outputs"].map(name => [
    `private ${name}`, `GRANT SELECT ON engagement_synthesis_generation_${name} TO authenticated; CREATE POLICY synthetic_execution_read ON engagement_synthesis_generation_${name} FOR SELECT TO authenticated USING(true);`, `Private execution table exposed: ${name}`,
  ]),
];
describe.skipIf(!LIVE_RLS)("native synthesis execution custody", () => {
  it("retains bounded claims, one-shot dispatch and exact late outputs", () => {
    expect(nativeExecution()).toContain("synthesis-generation-execution-custody-verified");
  });
  it("survives a harmless local variable rename", () => {
    expect(nativeExecution(change(dispatch, "allowed", "allowed_control"))).toContain("synthesis-generation-execution-custody-verified");
  });
  it("retains keyed API revision binding without decrypting or calling a provider", () => {
    expect(nativeExecution("", true)).toContain("synthesis-generation-execution-custody-verified");
  });
  it.each([[claim, "Changed credential claimed"], [dispatch, "Changed credential dispatched"]])("detects rotated credential acceptance in %s", (target, expected) => {
    let failure: unknown;
    try { nativeExecution(change(target, "credential_hash IS DISTINCT FROM grant_row.credential_sha256", "false"), true); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown;
    try { nativeExecution(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});

// An independent connection holds the real cancellation key. Only fixture setup
// bypasses it; restore every original body before probing competing commands.
async function executionFence(unrelated = false, removeFence?: string) {
  const container = resolveLocalDbContainer();
  const db = rollbackSqlConnection(container), holder = rollbackSqlConnection(container);
  try {
    await db.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_EXECUTION_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}`);
    const originals: string[] = [];
    for (const target of ["public.lock_synthesis_generation_request_scope(uuid,uuid)", "public.lock_synthesis_generation_plan_scope(uuid)", claim, dispatch]) {
      const body = JSON.parse((await db.query(`SELECT to_json(pg_get_functiondef('${target}'::regprocedure));`)).at(-1)!) as string;
      expect(body).toContain("IF NOT pg_try_advisory_xact_lock"); originals.push(body);
      await db.query(body.replace("IF NOT pg_try_advisory_xact_lock", "IF false AND NOT pg_try_advisory_xact_lock") + ";");
    }
    await db.query(`${plans}\n${fixture.split("-- Preparation and empty selections")[0]}
      SET LOCAL ROLE authenticated; SELECT pg_temp.execution_grant(); RESET ROLE;
      SET LOCAL ROLE service_role; SELECT pg_temp.execution_claim(); SELECT pg_temp.execution_dispatch(); RESET ROLE;`);
    for (const body of originals) await db.query(body + ";");
    const requestId = unrelated ? "f0000000-0000-4000-8000-000000000999" : "f0000000-0000-4000-8000-000000000001";
    await holder.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('synthesis-generation-request:${requestId}',0));`);
    if (removeFence) await db.query(change(removeFence, "IF NOT pg_try_advisory_xact_lock", "IF false AND NOT pg_try_advisory_xact_lock"));
    if (unrelated) {
      await db.query(`SET LOCAL ROLE service_role; SELECT pg_temp.execution_claim();
        SELECT pg_temp.assert_true(pg_temp.execution_dispatch()->>'authorizedNow'='false','Unrelated lock changed dispatch replay');
        SELECT pg_temp.assert_true(read_engagement_synthesis_generation_execution_status('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001')->>'canContinue'='true','Unrelated lock stopped status');
        SELECT read_engagement_synthesis_generation_selections('f0000000-0000-4000-8000-000000000001');
        SELECT pg_temp.execution_output();`);
    } else {
      await db.query(`SET LOCAL ROLE service_role;
        SELECT pg_temp.expect_error('SELECT pg_temp.execution_claim()','PT503','Claim ignored cancellation fence');
        SELECT pg_temp.expect_error('SELECT pg_temp.execution_dispatch()','PT503','Dispatch ignored cancellation fence');
        SELECT pg_temp.expect_error('SELECT pg_temp.execution_output()','PT503','Output ignored cancellation fence');
        SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_execution_status('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001')$q$,'PT503','Status ignored cancellation fence');
        SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_generation_selections('f0000000-0000-4000-8000-000000000001')$q$,'PT503','Selection inventory ignored cancellation fence');
        RESET ROLE; SET LOCAL ROLE authenticated;
        SELECT pg_temp.expect_error($q$SELECT select_engagement_synthesis_generation_attempt('f0000000-0000-4000-8000-000000000001',0,'a4000000-0000-4000-8000-000000000001',NULL,NULL,'SYNTHETIC held selection')$q$,'PT503','Staff selection ignored cancellation fence');
        SELECT pg_temp.expect_error('SELECT pg_temp.execution_grant()','PT503','Authorization ignored cancellation fence');
        SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','PT503','Cancellation used a different execution fence');`);
    }
  } finally { await holder.close(); await db.close(); }
}
describe.skipIf(!LIVE_RLS)("native synthesis execution serialization", () => {
  it("allows an unrelated held request", async () => { await executionFence(true); });
  it("uses the cancellation fence for all execution commands", async () => { await executionFence(); });
  it.each([[claim, "Claim"], [dispatch, "Dispatch"], [output, "Output"]])("detects removal of %s fence", async (target, label) => {
    await expect(executionFence(false, target)).rejects.toThrow(`${label} ignored cancellation fence`);
  });
  it("detects status losing the shared request fence", async () => {
    await expect(executionFence(false, "public.lock_synthesis_generation_plan_scope(uuid)")).rejects.toThrow("Status ignored cancellation fence");
  });
});

async function nativeOutputDelivery(mutation = "") {
    const db = rollbackSqlConnection(resolveLocalDbContainer());
    const requestId = "f0000000-0000-4000-8000-000000000001", authorizationId = "a1000000-0000-4000-8000-000000000001";
    const attemptId = "a2000000-0000-4000-8000-000000000001", workerId = "a3000000-0000-4000-8000-000000000001";
    const scope = { requestId: "d0000000-0000-4000-8000-000000000002", campaignId: "10c5cdd7-16c6-4b91-b9c0-d2f67598a54f", workspaceId: "d51d566d-28c6-49d2-95d2-3a7a2f0902e1" };
    const rpc = async (sql: string) => JSON.parse((await db.query(`SET LOCAL ROLE service_role; SELECT ${sql}; RESET ROLE;`)).at(-1)!);
    try {
      await db.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
        ${process.env.OPENPLAN_SYNTHESIS_EXECUTION_CANDIDATE === "1" ? migration : ""}
        ${source}\n${requests}\n${mutation}\nSET LOCAL ROLE authenticated; SELECT pg_temp.gen_create();`);
      const saved = JSON.parse((await db.query(`SELECT pg_temp.read_source('${scope.requestId}'); RESET ROLE;`)).at(-1)!);
      const request = JSON.parse((await db.query(`SELECT jsonb_build_object('id',id,'intentText',intent_text,'intentSha256',intent_sha256)
        FROM engagement_synthesis_generation_requests WHERE id='${requestId}';`)).at(-1)!);
      const plan = createSynthesisGenerationPlan(request, saved, scope);
      expect(plan.header.contributionCount).toBe(303);
      await rpc(`prepare_engagement_synthesis_generation_plan('${requestId}',${literal(plan.headerText)})`);
      let index = 0;
      while (index < plan.entries.length) {
        const batch = synthesisGenerationPlanBatch(plan, index)!;
        const state = await rpc(`stage_engagement_synthesis_generation_tasks('${requestId}',${index},'${batch.previousSha256}',${literal(batch.tasksText)})`);
        expect(verifySynthesisGenerationPlanState(plan, state).nextIndex).toBe(batch.nextIndex);
        index = batch.nextIndex;
      }
      expect(verifySynthesisGenerationPlanState(plan, await rpc(`seal_engagement_synthesis_generation_plan('${requestId}','${plan.headerSha256}')`)).seal).not.toBeNull();
      const intent = { schemaVersion: 1, headerSha256: plan.headerSha256, maxAttempts: 1, maxOutputTokens: 4096, responseByteLimit: 8192,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null };
      await db.query(`SET LOCAL ROLE authenticated; SELECT authorize_engagement_synthesis_generation('${requestId}','${authorizationId}',${literal(JSON.stringify(intent))}); RESET ROLE;`);
      const claimAck = await rpc(`claim_engagement_synthesis_generation_attempt('${authorizationId}',0,'${attemptId}','${workerId}')`);
      const binding: SynthesisGenerationAttemptBinding = { jobId: requestId, planSha256: plan.header.taskManifestSha256,
        configurationRevisionId: "e0000000-0000-4000-8000-000000000002", configurationHash: JSON.parse(request.intentText).configurationHash,
        provider: "api_connection", modelId: "synthetic", taskSha256: plan.entries[0].sha256, attemptId };
      expect(JSON.parse(claimAck.bindingText)).toEqual(binding);
      expect((await rpc(`dispatch_engagement_synthesis_generation_attempt('${attemptId}','${workerId}')`)).authorizedNow).toBe(true);
      expect((await rpc(`dispatch_engagement_synthesis_generation_attempt('${attemptId}','${workerId}')`)).authorizedNow).toBe(false);
      // Native authorization exists, but the fixture does not invoke a provider.
      const outputText = "SYNTHETIC original\n\u0000\ud800\udc00\ud800 é 😀";
      const result = createSynthesisGenerationResult(binding, { schemaVersion: 1, binding,
        startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z", outcome: "returned",
        outputText, providerReceiptText: "SYNTHETIC original receipt\u0000\udc00", finishReason: "length", responseId: null,
        inputTokens: null, outputTokens: null, failureCode: null });
      await db.query(`SET LOCAL ROLE authenticated; SELECT pg_temp.gen_cancel(); RESET ROLE;
        UPDATE workspace_members SET role='viewer' WHERE workspace_id='${scope.workspaceId}' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';`);
      let loseResponse = true;
      const calls: unknown[] = [];
      const service = { rpc: (name: string, args: Record<string, string>) => ({ abortSignal: async (signal: AbortSignal) => {
        signal.throwIfAborted();
        expect(name).toBe("retain_engagement_synthesis_generation_output");
        const keys = ["p_attempt", "p_worker", "p_capture_base64", "p_capture_sha256"];
        expect(Object.keys(args)).toEqual(keys); calls.push(args);
        const data = await rpc(`${name}(${keys.map(key => literal(args[key])).join(",")})`);
        if (loseResponse) { loseResponse = false; return { data: null, error: { message: "SYNTHETIC lost output acknowledgement" } }; }
        return { data, error: null };
      } }) } as unknown as Pick<SupabaseClient, "rpc">;
      const args = { binding, result, workerId, responseByteLimit: 8192 };
      await expect(retainSynthesisGenerationOutput(service, args)).rejects.toThrow("retain and retry the same capture");
      const retained = await retainSynthesisGenerationOutput(service, args);
      expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
      expect(retained.capture.outputText).toBe(outputText);
      expect(retained.capture.providerReceiptText).toBe("SYNTHETIC original receipt\u0000\udc00");
      expect(retained.canonical).toBe(result.canonical); expect(retained.sha256).toBe(result.sha256);
      expect((await db.query(`SELECT count(*) FROM engagement_synthesis_generation_outputs WHERE attempt_id='${attemptId}';`)).at(-1)).toBe("1");
      await db.query(`UPDATE workspace_members SET role='owner' WHERE workspace_id='${scope.workspaceId}' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';`);
      const reader = { rpc: (name: string, command: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
        signal.throwIfAborted(); expect(name).toBe("read_engagement_synthesis_generation_selections");
        expect(command).toEqual({ p_request: requestId, p_through_sequence: null, p_after_task_index: -1, p_limit: 128 });
        return { data: await rpc(`${name}('${requestId}',NULL,-1,128)`), error: null };
      } }) } as unknown as Pick<SupabaseClient, "rpc">;
      const choices = await readSynthesisGenerationSelections(reader, { request, saved, scope, actorId: "13466ed2-dcb7-4861-a528-68cc5579eea9" });
      expect(choices.throughSequence).toBe(1);
      expect(choices.selections).toEqual([{ taskSha256: binding.taskSha256, attemptId }]);
      expect(choices.entries[0].receipt.origin).toBe("authorization");
      expect(choices.plan).toEqual(plan);
    } finally { await db.close(); }
}
describe.skipIf(!LIVE_RLS)("synthesis output native delivery join", () => {
  it.each(["", "-- Harmless delivery join control"])("retains source-bound Unicode output after unknown acknowledgement and revoked access %s", nativeOutputDelivery, 90000);
  it("detects PostgreSQL JSON narrowing of retained provider strings", async () => {
    const mutation = change(output, "capture:=convert_from(decode(p_capture_base64,'base64'),'UTF8');",
      "capture:=convert_from(decode(p_capture_base64,'base64'),'UTF8'); PERFORM capture::jsonb;");
    await expect(nativeOutputDelivery(mutation)).rejects.toThrow("Invalid synthesis output capture");
  }, 90000);
});
