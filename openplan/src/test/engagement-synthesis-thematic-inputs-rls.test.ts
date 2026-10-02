import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000006_engagement_synthesis_thematic_inputs.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const thematic = readFileSync("src/test/fixtures/engagement/synthesis-thematic-requests.sql", "utf8").split("-- Current staff can read")[0];
const choices = readFileSync("src/test/fixtures/engagement/synthesis-thematic-choices.sql", "utf8").split("SELECT pg_temp.gen_cancel(")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-thematic-inputs.sql", "utf8");
const save = "public.retain_engagement_synthesis_thematic_input(uuid,text,text,text)";
const read = "public.read_engagement_synthesis_thematic_input(uuid,text)";
const history = "public.read_engagement_synthesis_thematic_input_history(uuid,uuid,text)";
const scope = "public.lock_synthesis_thematic_input_scope(uuid)";
const record = "public.synthesis_thematic_input_record(uuid,text)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing input custody mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
function nativeInputs(mutation = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_THEMATIC_INPUTS_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${thematic}\n${choices}\nRESET ROLE;\n${mutation}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ...["schemaVersion", "purpose", "requestId", "campaignId", "workspaceId", "actorId", "intentSha256", "thematicSha256",
    "sourceId", "sourceSha256", "targetRecordId", "choiceSha256", "contextRequestId", "contextRequestSha256",
    "historyManifestSha256", "finalCaptureSha256", "finalResultSha256", "outputSha256"].map(key => [
    `bound ${key}`, change(save, "p_proof_text::jsonb IS DISTINCT FROM expected", `p_proof_text::jsonb - '${key}' IS DISTINCT FROM expected - '${key}'`), `Changed input proof accepted: ${key}`,
  ] as const),
  ["proof retry", change(save, "previous.proof_text IS DISTINCT FROM p_proof_text", "false"), "Changed input proof retry accepted"],
  ["output retry", change(save, "previous.output_text IS DISTINCT FROM p_output_text", "false"), "Changed input output retry accepted"],
  ["retry acknowledgement", change(save, "jsonb_build_object('replayed',true)", "jsonb_build_object('replayed',false)"), "Exact input retry differs"],
  ["proof digest", change(record, "'proofSha256',proof_sha256", "'proofSha256',repeat('0',64)"), "Retained input bytes differ"],
  ["output digest", change(record, "'outputSha256',output_sha256", "'outputSha256',repeat('0',64)"), "Retained input bytes differ"],
  ["raw output", change(record, "'outputText',output_text", "'outputText','changed'"), "Retained input bytes differ"],
  ["requester", change(scope, "AND m.user_id=saved.actor_id AND m.role IN ('owner','admin','member')", "AND m.role IN ('owner','admin','member','viewer')"), "Revoked requester read input"],
  ["campaign", change(scope, "IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=saved.campaign_id AND workspace_id=saved.workspace_id FOR SHARE NOWAIT) THEN", "IF false THEN"), "Foreign input campaign accepted"],
  ["stage", change(scope, "IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=p_request) THEN", "IF false THEN"), "Segment input scope accepted"],
  ["staff scope", change(history, "PERFORM read_engagement_synthesis_thematic_request(p_campaign,p_request);", "NULL;"), "Foreign campaign input history allowed"],
  ["immutability", "ALTER TABLE engagement_synthesis_thematic_inputs DISABLE TRIGGER synthesis_thematic_input_immutable;", "Input update allowed"],
  ["RLS", "ALTER TABLE engagement_synthesis_thematic_inputs DISABLE ROW LEVEL SECURITY;", "Input RLS disabled"],
  ["direct write", "GRANT INSERT ON engagement_synthesis_thematic_inputs TO service_role;", "Direct input mutation allowed"],
  ...[save, read].flatMap(signature => ["anon", "authenticated"].map(role => [
    `${role} ${signature}`, `GRANT EXECUTE ON FUNCTION ${signature} TO ${role};`, "Client input command allowed",
  ] as const)),
  ...[record, scope].map(signature => [signature, `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`, "Private input helper exposed"] as const),
  ["service history", `GRANT EXECUTE ON FUNCTION ${history} TO service_role;`, "History impersonation allowed"],
] as const;
describe.skipIf(!LIVE_RLS)("native thematic input custody", () => {
  it("preserves exact input custody and current scope across cancellation and departure", () => {
    expect(nativeInputs()).toContain("synthesis-thematic-input-custody-verified");
  });
  it("preserves a harmless comment change", () => {
    expect(nativeInputs(change(save, "Fresh writes recheck", "New writes recheck"))).toContain("synthesis-thematic-input-custody-verified");
  });
  it.each(faults)("detects broken %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativeInputs(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
