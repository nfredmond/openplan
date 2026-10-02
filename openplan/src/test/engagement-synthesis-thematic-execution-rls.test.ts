// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000009_engagement_synthesis_thematic_execution.sql", "utf8");
const readFixture = (name: string) => readFileSync(`src/test/fixtures/engagement/synthesis-${name}.sql`, "utf8");
const source = readFixture("source-custody");
const requests = readFixture("generation-requests").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const thematic = readFixture("thematic-requests").split("-- Current staff can read")[0];
const choices = readFixture("thematic-choices").split("SELECT pg_temp.gen_cancel(")[0];
const inputs = readFixture("thematic-inputs").split("SELECT pg_temp.gen_cancel(")[0];
const seals = readFixture("thematic-input-seals");
const helpers = seals.split("DO $$ DECLARE signature")[0];
const complete = seals.slice(seals.indexOf("-- Complete every actual source member"), seals.indexOf("DO $$ DECLARE page jsonb;"));
const planHelpers = readFixture("thematic-plans").split("SELECT set_config('request.jwt.claim.sub'")[0];
const fixture = readFixture("thematic-execution");
function probe(mutation = "") {
 const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
 return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
  input: `BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';
  ${process.env.OPENPLAN_SYNTHESIS_THEMATIC_EXECUTION_CANDIDATE === "1" ? migration : ""}
  ${source}\n${requests}\n${thematic}\n${choices}\n${inputs}\nRESET ROLE;\n${helpers}\n${complete}\n${planHelpers}\n${mutation}\n${fixture}\nROLLBACK;`,
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 90000, maxBuffer: 16 * 1024 * 1024,
 });
}
const authorize = "public.authorize_engagement_synthesis_thematic(uuid,uuid,text)";
const claim = "public.claim_engagement_synthesis_thematic_attempt(uuid,bigint,uuid,uuid,text,uuid,uuid,text,text)";
const dispatch = "public.dispatch_engagement_synthesis_thematic_attempt(uuid,uuid)";
const current = "public.assert_synthesis_thematic_execution_current(uuid)";
const ancestors = "public.assert_synthesis_thematic_predecessors_current(uuid)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing thematic execution mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
const faults = [
 ["proposal counted", change(authorize,"plan.header_text::jsonb->>'taskCount'","plan.header_text::jsonb->>'frameCount'"),"Full thematic inventory authorization refused"],
 ["active retry",change(authorize,"AND greatest(previous.claim_expires_at,coalesce((SELECT expires_at FROM engagement_synthesis_generation_dispatches WHERE attempt_id=previous.id),previous.claim_expires_at))>clock_timestamp()","AND false"),"Active thematic attempt retried"],
 ["retry successor",change(authorize,"OR EXISTS(SELECT 1 FROM engagement_synthesis_generation_attempts WHERE previous_attempt_id=previous.id)",""),"Thematic retry predecessor reused"],
 ["status ancestor",change("public.read_engagement_synthesis_thematic_execution_status(uuid,uuid)","PERFORM assert_synthesis_thematic_predecessors_current(p_attempt);","PERFORM 1;"),"Changed thematic ancestor kept execution alive"],
  ["authorization version", change(authorize, "OR intent->'schemaVersion' IS DISTINCT FROM '1'::jsonb", ""), "Malformed thematic authorization accepted"],
  ["authorization fields", change(authorize, "OR (SELECT count(*) FROM jsonb_object_keys(intent))<>9", ""), "Malformed thematic authorization accepted"],
  ["charges acknowledged", change(authorize, "OR intent->'chargesAcknowledged' IS DISTINCT FROM 'true'::jsonb", ""), "Malformed thematic authorization accepted"],
  ["initial allowance", change(authorize, "IF (intent->>'maxAttempts')::bigint>(plan.header_text::jsonb->>'taskCount')::bigint THEN", "IF false THEN"), "Malformed thematic authorization accepted"],
  ["grant expiry", change(authorize, "expiry<=clock_timestamp()", "false"), "Expired thematic authorization accepted"],
  ["grant plan identity", change(authorize, "IF intent->>'headerSha256' IS DISTINCT FROM plan.header_sha256 THEN", "IF false THEN"), "Different thematic plan authorized"],
  ["grant actor", change(authorize, "IF auth.uid() IS DISTINCT FROM request.actor_id THEN", "IF false THEN"), "Other actor authorized thematic"],
  ["dynamic task byte bound", change(claim, "IF octet_length(p_task_text)>(request.intent_text::jsonb->>'taskByteLimit')::integer THEN", "IF false THEN"), "Dynamic thematic task exceeded byte limit"],
  ["private helper", `GRANT EXECUTE ON FUNCTION ${ancestors} TO service_role;`, "Private thematic authority helper exposed"],
  ["worker command", `GRANT EXECUTE ON FUNCTION ${claim} TO authenticated;`, "Thematic worker authority exposed"],
  ["staff command", `GRANT EXECUTE ON FUNCTION ${authorize} TO service_role;`, "Thematic staff authority exposed"],
  ["private task read", "GRANT SELECT ON engagement_synthesis_thematic_attempt_inputs TO authenticated; CREATE POLICY synthetic_thematic_task_read ON engagement_synthesis_thematic_attempt_inputs FOR SELECT TO authenticated USING(true);", "Private thematic task table exposed"],
  ["attempt allowance", change(claim, "IF (SELECT count(*) FROM engagement_synthesis_generation_attempts WHERE authorization_id=p_authorization)>=(intent->>'maxAttempts')::bigint THEN", "IF false THEN"), "Complete predecessor bypassed thematic attempt allowance"],
  ...[
    "OR saved.predecessor_attempt_id IS DISTINCT FROM p_predecessor_attempt",
    "OR saved.predecessor_selection_id IS DISTINCT FROM p_predecessor_selection",
    "OR saved.predecessor_capture_sha256 IS DISTINCT FROM p_predecessor_capture_sha256",
    "OR saved.previous_result_sha256 IS DISTINCT FROM p_previous_result_sha256",
  ].map(condition => [condition, change(claim, condition, ""), "Changed thematic predecessor claim replayed"] as const),
  ["authorization exact retry", change(authorize, "saved.intent_text IS DISTINCT FROM p_intent_text", "false"), "Changed thematic grant replayed"],
  ["task exact retry", change(claim, "OR saved.task_text IS DISTINCT FROM p_task_text", ""), "Changed thematic task replayed"],
  ["dynamic task identity", change(claim, "'taskSha256',encode(extensions.digest(p_task_text,'sha256'),'hex')", "'taskSha256',repeat('0',64)"), "Thematic task original or dynamic binding differs"],
  ["complete predecessor chain", change(ancestors, "current_attempt:=prior_attempt;", "RETURN;"), "Changed thematic ancestor permitted dispatch"],
  ["predecessor capture required", change(ancestors, "OR original.attempt_id IS NULL OR original.capture_sha256 IS DISTINCT FROM input.predecessor_capture_sha256", ""), "Thematic frame claimed before original predecessor"],
  ["fresh dispatch ancestry", change(dispatch, "PERFORM assert_synthesis_thematic_predecessors_current(p_attempt);", "PERFORM 1;"), "Changed thematic ancestor permitted dispatch"],
  ["one-time dispatch", change(dispatch, "'authorizedNow',allowed", "'authorizedNow',true"), "Thematic dispatch retry renewed permission"],
  ["provider revocation", change(current, "OR connection.revoked_at IS NOT NULL", ""), "Revoked thematic provider dispatched"],
  ["request cancellation", change(current, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN", "IF false THEN"), "Cancelled thematic provider dispatched"],
  ["current actor role", change("public.lock_synthesis_thematic_input_scope(uuid)", "AND m.role IN ('owner','admin','member')", ""), "Current thematic requester role bypassed"],
  ["immutable original task", "ALTER TABLE engagement_synthesis_thematic_attempt_inputs DISABLE TRIGGER synthesis_thematic_attempt_input_immutable;", "Thematic task original changed"],
] as const;

describe.skipIf(!LIVE_RLS)("native thematic execution custody", () => {
 it("pins frame and final-proposal tasks to current authority and original ancestors", () => {
  expect(probe()).toContain("synthesis-thematic-execution-verified");
 },90000);
 it("preserves a harmless comment mutation", () => {
  expect(probe(change(ancestors,"Follow the original selected chain","Traverse the original selected chain"))).toContain("synthesis-thematic-execution-verified");
 },90000);
 it.each(faults)("detects %s", (_name, mutation, expected) => {
  let failure: unknown; try { probe(mutation); } catch (error) { failure=error; }
  expect(failure).toBeDefined(); expect(String((failure as {stderr?: unknown}).stderr)).toContain(expected);
 },90000);
});
