import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261014000038_engagement_synthesis_context_plans.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const contexts = readFileSync("src/test/fixtures/engagement/synthesis-context-requests.sql", "utf8").split("SELECT pg_temp.assert_true((SELECT value#>>'{request,actorId}'")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-context-plans.sql", "utf8");
function probe(before = "", body = fixture, contextSeed = contexts) {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_CONTEXT_PLAN_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${contextSeed}\nRESET ROLE;\n${before}\n${body}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000,
  });
}
const prepare = "public.prepare_engagement_synthesis_context_plan(uuid,text)";
const stage = "public.stage_engagement_synthesis_context_frames(uuid,bigint,text,text)";
const seal = "public.seal_engagement_synthesis_context_plan(uuid,text)";
const scope = "public.lock_synthesis_context_plan_scope(uuid)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing context plan mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
// Structural fixtures establish byte custody and scope refusal. They do not
// establish source reconstruction, provider authenticity or semantic usefulness.
const faults: [string, string, string][] = [
  ...[
    ["version", "OR header->'schemaVersion' IS DISTINCT FROM '1'::jsonb"],
    ["field count", "OR (SELECT count(*) FROM jsonb_object_keys(header))<>16"],
    ["purpose", "OR header->>'purpose' IS DISTINCT FROM 'private_synthesis_context_frame_plan'"],
    ["request", "OR header->>'requestId' IS DISTINCT FROM p_request::text"],
    ["actor", "OR header->>'actorId' IS DISTINCT FROM request.actor_id::text"],
    ["intent", "OR header->>'intentSha256' IS DISTINCT FROM request.intent_sha256"],
    ["binding", "OR header->>'contextRequestSha256' IS DISTINCT FROM context.context_sha256"],
    ["recipe ID", "OR header->>'recipeId' IS DISTINCT FROM 'openplan.engagement.synthesis.context.v1'"],
    ["recipe checksum", "OR header->>'recipeSha256' IS DISTINCT FROM '1ef05631ff83fbf8a85e08110c800f820586580b91c76824728de944d0d88abc'"],
    ["content", "OR header->'contentManifestSha256' IS DISTINCT FROM binding->'contentManifestSha256'"],
    ["context", "OR header->'contextManifestSha256' IS DISTINCT FROM binding->'contextManifestSha256'"],
    ["target", "OR header->'targetRecordId' IS DISTINCT FROM binding->'targetRecordId'"],
    ["frame limit", "OR header->'frameByteLimit' IS DISTINCT FROM binding->'frameByteLimit'"],
    ["continuation checksum", "OR header->>'continuationHeaderSha256' !~ '^[a-f0-9]{64}$'"],
    ["tail checksum", "OR header->>'tailSha256' !~ '^[a-f0-9]{64}$'"],
  ].map(([name, condition]): [string, string, string] => [name, change(prepare, condition, ""), "Malformed context plan header accepted"]),
  ["header size", change(prepare, "OR octet_length(p_header_text)>4096", ""), "Oversized context header accepted"],
  ["header uniqueness", change(prepare, "p_header_text IS NOT JSON OBJECT WITH UNIQUE KEYS", "p_header_text IS NOT JSON OBJECT"), "Duplicate context header accepted"],
  ["header retry", change(prepare, "IF plan.header_text IS DISTINCT FROM p_header_text THEN", "IF false THEN"), "Changed context plan header replayed"],
  ["cancel before preparation", change(prepare, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN", "IF false THEN"), "Cancelled context prepared new work"],
  ["batch size", change(stage, "OR octet_length(p_frames_text)>4194304", ""), "Oversized context staging packet accepted"],
  ["batch count", change(stage, "task_count NOT BETWEEN 1 AND 128", "task_count<1"), "Context batch count limit bypassed"],
  ["batch minimum", change(stage, "task_count NOT BETWEEN 1 AND 128", "task_count>128"), "Empty context frame batch accepted"],
  // Each of these guards also has a later refusal. Remove both checks to test
  // the broken behavior; the initial single faults survived those backstops.
  ["sequence", change(stage, "p_start>next_index OR ", "") + change(stage, "IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN", "IF false THEN"), "Out of sequence context frame accepted"],
  ["prefix", change(stage, "IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN", "IF false THEN"), "Wrong context prefix accepted"],
  ["overlap", change(stage, "IF p_start+task_count>next_index THEN", "IF false THEN") + change(stage, "IF existing IS DISTINCT FROM entry#>>'{}' THEN", "IF position<next_index AND existing IS DISTINCT FROM entry#>>'{}' THEN"), "Context retry overlapped new work"],
  ["frame retry", change(stage, "IF existing IS DISTINCT FROM entry#>>'{}' THEN", "IF false THEN"), "Changed context frame retry accepted"],
  ["cancel before append", change(stage, "state->>'cancelled'='true' OR ", ""), "Cancelled context staged new frames"],
  ["frame byte bound", change(stage, "OR octet_length(task)>(header->>'frameByteLimit')::integer", ""), "Context individual frame limit bypassed"],
  ["total byte bound", change(stage, "IF bytes>(header->>'frameBytes')::bigint THEN", "IF false THEN"), "Context byte ceiling exceeded"],
  ["original strings", change(stage, "IF task IS NOT JSON OBJECT OR", "IF jsonb_typeof(task::jsonb)<>'object' OR"), "Invalid context frame batch"],
  ["frame reference", change(stage, "'frameSha256',sha", "'frameSha256',repeat('0',64)"), "Context frame reference differs from original"],
  ["seal identity", change(seal, "IF p_header_sha256 IS DISTINCT FROM state->>'headerSha256' THEN", "IF false THEN"), "Wrong context plan sealed"],
  ["cancel before seal", change(seal, "IF state->>'cancelled'='true' THEN", "IF false THEN"), "Cancelled complete context sealed"],
  ["seal count", change(seal, "state->'nextIndex' IS DISTINCT FROM header->'frameCount' OR ", ""), "Wrong context frame count sealed"],
  ["seal bytes", change(seal, "state->'frameBytes' IS DISTINCT FROM header->'frameBytes'", "false"), "Wrong context byte total sealed"],
  ["seal chain", change(seal, "OR state->>'tailSha256' IS DISTINCT FROM header->>'tailSha256'", ""), "Wrong context chain sealed"],
  ["context scope", change(scope, "IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=p_request) THEN", "IF false THEN"), "Segment request entered context plan"],
  ["current requester role", change(scope, "AND m.role IN ('owner','admin','member')", ""), "Revoked parent gained context worker access"],
  ["original immutability", "ALTER TABLE engagement_synthesis_context_frames DISABLE TRIGGER synthesis_context_frame_immutable;", "Context frame original changed"],
  ["private frame read", "GRANT SELECT ON engagement_synthesis_context_frames TO authenticated; CREATE POLICY synthetic_frame_read ON engagement_synthesis_context_frames FOR SELECT TO authenticated USING(true);", "Private context frame table exposed"],
  ["private scope command", `GRANT EXECUTE ON FUNCTION ${scope} TO service_role;`, "Private context plan scope exposed"],
  ...["public.read_engagement_synthesis_context_plan(uuid)", prepare, stage, seal].map((signature): [string, string, string] => [signature, `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`, "Context worker command exposed to staff or public"]),
];

describe.skipIf(!LIVE_RLS)("native context frame plan custody", () => {
  it.each(["", change(prepare, "does not create new work", "does not append new work")])("retains every original frame and exact retry %s", before => {
    expect(probe(before)).toContain("synthesis-context-plan-verified");
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown;
    try { probe(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });

  it("refuses staging commands while another connection holds the request fence", async () => {
    const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
    const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { error += data; });
    const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    void done.catch(() => {});
    try {
      child.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('synthesis-generation-request:f0000000-0000-4000-8000-000000000010',0)); SELECT 'CONTEXT_PLAN_LOCK_READY';\n");
      await vi.waitFor(() => { expect(child.exitCode, error).toBeNull(); expect(output, error).toContain("CONTEXT_PLAN_LOCK_READY"); }, { timeout: 8000, interval: 25 });
      // Direct synthetic seeding avoids acquiring the tested fence in setup.
      const seed = contexts.replace("INSERT INTO context_probe VALUES('original',pg_temp.ctx_create());", `RESET ROLE;
        INSERT INTO engagement_synthesis_generation_requests(id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text)
        SELECT 'f0000000-0000-4000-8000-000000000010','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
          '7a50d4fb-35b7-41f4-9bce-8a4e7d157569',(value->>'sourceId')::uuid,(value->>'configurationRevisionId')::uuid,value::text FROM generation_probe WHERE key='intent';
        INSERT INTO engagement_synthesis_context_requests(request_id,parent_request_id,context_text)
        SELECT 'f0000000-0000-4000-8000-000000000010','f0000000-0000-4000-8000-000000000001',value::text FROM context_probe WHERE key='binding';`);
      const body = `SET LOCAL ROLE service_role;
        SELECT pg_temp.expect_error($q$SELECT prepare_engagement_synthesis_context_plan('f0000000-0000-4000-8000-000000000010','{}')$q$,'PT503','Context plan lock bypassed');
        SELECT 'context-plan-lock-verified';`;
      expect(probe("", body, seed)).toContain("context-plan-lock-verified");
      let failure: unknown;
      try { probe(change(scope, "IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||p_request::text,0)) THEN", "IF false THEN"), body, seed); } catch (caught) { failure = caught; }
      expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain("Context plan lock bypassed");
      expect(child.exitCode, "Lock holder exited before command returned").toBeNull();
    } finally {
      if (child.exitCode === null && !child.stdin.destroyed) child.stdin.end("ROLLBACK;\n");
      expect(await done, error).toBe(0);
    }
  }, 30000);
});
