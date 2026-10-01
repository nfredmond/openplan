import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261014000039_engagement_synthesis_context_execution.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const contexts = readFileSync("src/test/fixtures/engagement/synthesis-context-requests.sql", "utf8").split("SELECT pg_temp.assert_true((SELECT value#>>'{request,actorId}'")[0];
const planHelpers = readFileSync("src/test/fixtures/engagement/synthesis-context-plans.sql", "utf8").split("-- Current staff commands")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-context-execution.sql", "utf8");
const parentFixture = readFileSync("src/test/fixtures/engagement/synthesis-context-parent-selections.sql", "utf8");
function probe(before = "", body = fixture) {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_CONTEXT_EXECUTION_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${contexts}\n${planHelpers}\nRESET ROLE;\n${before}\n${body}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000,
  });
}
const authorize = "public.authorize_engagement_synthesis_context(uuid,uuid,text)";
const claim = "public.claim_engagement_synthesis_context_attempt(uuid,bigint,uuid,uuid,text,uuid,uuid,text,text)";
const dispatch = "public.dispatch_engagement_synthesis_context_attempt(uuid,uuid)";
const current = "public.assert_synthesis_context_execution_current(uuid)";
const ancestors = "public.assert_synthesis_context_predecessors_current(uuid)";
const parentSelections = "public.read_engagement_synthesis_context_parent_selections(uuid,bigint,integer)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing context execution mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
const faults = [
  ["authorization version", change(authorize, "OR intent->'schemaVersion' IS DISTINCT FROM '1'::jsonb", ""), "Malformed context authorization accepted"],
  ["authorization fields", change(authorize, "OR (SELECT count(*) FROM jsonb_object_keys(intent))<>9", ""), "Malformed context authorization accepted"],
  ["charges acknowledged", change(authorize, "OR intent->'chargesAcknowledged' IS DISTINCT FROM 'true'::jsonb", ""), "Malformed context authorization accepted"],
  ["initial allowance", change(authorize, "IF (intent->>'maxAttempts')::bigint>(plan.header_text::jsonb->>'frameCount')::bigint THEN", "IF false THEN"), "Malformed context authorization accepted"],
  ["grant expiry", change(authorize, "expiry<=clock_timestamp()", "false"), "Expired context authorization accepted"],
  ["grant plan identity", change(authorize, "IF intent->>'headerSha256' IS DISTINCT FROM plan.header_sha256 THEN", "IF false THEN"), "Different context plan authorized"],
  ["grant actor", change(authorize, "IF auth.uid() IS DISTINCT FROM request.actor_id THEN", "IF false THEN"), "Other actor authorized context"],
  ["dynamic task byte bound", change(claim, "IF octet_length(p_task_text)>(request.intent_text::jsonb->>'taskByteLimit')::integer THEN", "IF false THEN"), "Dynamic context task exceeded byte limit"],
  ["private helper", `GRANT EXECUTE ON FUNCTION ${ancestors} TO service_role;`, "Private context authority helper exposed"],
  ["worker command", `GRANT EXECUTE ON FUNCTION ${claim} TO authenticated;`, "Context worker authority exposed"],
  ["staff command", `GRANT EXECUTE ON FUNCTION ${authorize} TO service_role;`, "Context staff authority exposed"],
  ["private task read", "GRANT SELECT ON engagement_synthesis_context_attempt_inputs TO authenticated; CREATE POLICY synthetic_context_task_read ON engagement_synthesis_context_attempt_inputs FOR SELECT TO authenticated USING(true);", "Private context task table exposed"],
  ["attempt allowance", change(claim, "IF (SELECT count(*) FROM engagement_synthesis_generation_attempts WHERE authorization_id=p_authorization)>=(intent->>'maxAttempts')::bigint THEN", "IF false THEN"), "Complete predecessor bypassed context attempt allowance"],
  ...[
    "OR saved.predecessor_attempt_id IS DISTINCT FROM p_predecessor_attempt",
    "OR saved.predecessor_selection_id IS DISTINCT FROM p_predecessor_selection",
    "OR saved.predecessor_capture_sha256 IS DISTINCT FROM p_predecessor_capture_sha256",
    "OR saved.previous_result_sha256 IS DISTINCT FROM p_previous_result_sha256",
  ].map(condition => [condition, change(claim, condition, ""), "Changed context predecessor claim replayed"] as const),
  ["authorization exact retry", change(authorize, "saved.intent_text IS DISTINCT FROM p_intent_text", "false"), "Changed context grant replayed"],
  ["task exact retry", change(claim, "OR saved.task_text IS DISTINCT FROM p_task_text", ""), "Changed context task replayed"],
  ["dynamic task identity", change(claim, "'taskSha256',encode(extensions.digest(p_task_text,'sha256'),'hex')", "'taskSha256',repeat('0',64)"), "Context task original or dynamic binding differs"],
  ["complete predecessor chain", change(ancestors, "current_attempt:=prior_attempt;", "RETURN;"), "Changed context ancestor permitted dispatch"],
  ["predecessor capture required", change(ancestors, "OR original.attempt_id IS NULL OR original.capture_sha256 IS DISTINCT FROM input.predecessor_capture_sha256", ""), "Context frame claimed before original predecessor"],
  ["fresh dispatch ancestry", change(dispatch, "PERFORM assert_synthesis_context_predecessors_current(p_attempt);", "PERFORM 1;"), "Changed context ancestor permitted dispatch"],
  ["one-time dispatch", change(dispatch, "'authorizedNow',allowed", "'authorizedNow',true"), "Context dispatch retry renewed permission"],
  ["provider revocation", change(current, "OR connection.revoked_at IS NOT NULL", ""), "Revoked context provider dispatched"],
  ["request cancellation", change(current, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN", "IF false THEN"), "Cancelled context provider dispatched"],
  ["current actor role", change("public.lock_synthesis_context_plan_scope(uuid)", "AND m.role IN ('owner','admin','member')", ""), "Current context requester role bypassed"],
  ["immutable original task", "ALTER TABLE engagement_synthesis_context_attempt_inputs DISABLE TRIGGER synthesis_context_attempt_input_immutable;", "Context task original changed"],
] as const;

describe.skipIf(!LIVE_RLS)("native contextual execution custody", () => {
  it.each(["", change(parentSelections, "through_sequence:=(context.context_text", "through_sequence:= (context.context_text")])("reads fixed parent pages after the original requester leaves %s", before => {
    expect(probe(before, parentFixture)).toContain("synthesis-context-parent-selections-verified");
  });
  it.each([
    ["parent sequence", change(parentSelections, "through_sequence:=(context.context_text::jsonb->>'selectionSequence')::bigint;", "SELECT max(sequence_no) INTO through_sequence FROM engagement_synthesis_generation_selections WHERE request_id=parent.id;"), "Context parent first page lost fixed history"],
    ["snapshot successor", change(parentSelections, "AND n.sequence_no<=through_sequence", ""), "Context parent first page lost fixed history"],
    ["page boundary", change(parentSelections, "s.task_index>p_after_task_index", "true"), "Context parent second page differs"],
    ["page size", change(parentSelections, "THEN entries-p_limit ELSE entries", "THEN entries ELSE entries"), "Context parent first page lost fixed history"],
    ["cursor floor", change(parentSelections, "p_after_task_index NOT BETWEEN -1 AND 9007199254740991", "false"), "Context parent cursor accepted invalid index"],
    ["cursor null", change(parentSelections, "p_after_task_index IS NULL OR", ""), "Context parent cursor accepted missing index"],
    ["page limit", change(parentSelections, "p_limit NOT BETWEEN 1 AND 128", "false"), "Context parent cursor exceeded limit"],
    ...["campaign_id", "workspace_id", "source_id"].map(field => [field, change(parentSelections, `OR parent.${field} IS DISTINCT FROM request.${field}`, ""), "Context parent scope corruption accepted"]),
    ["child authority", change("public.lock_synthesis_context_plan_scope(uuid)", "AND m.role IN ('owner','admin','member')", ""), "Departed child requester still read parent"],
  ])("detects context parent %s", (_name, mutation, expected) => {
    let failure: unknown; try { probe(mutation, parentFixture); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
  it.each(["", change(ancestors, "Follow the original selected chain", "Traverse the original selected chain")])("pins dynamic task and all selected ancestors %s", before => {
    expect(probe(before)).toContain("synthesis-context-execution-verified");
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown; try { probe(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
