import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261014000037_engagement_synthesis_context_requests.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-context-requests.sql", "utf8");
const create = "public.create_engagement_synthesis_context_request(uuid,uuid,text,text)";
const read = "public.read_engagement_synthesis_context_request(uuid,uuid)";
const planScope = "public.lock_synthesis_generation_plan_scope(uuid)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing context mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
// Each command, fault and synthetic row rolls back. Proposed hashes are not
// semantically verified here, and this fixture makes no provider call.
function nativeContext(mutation = "", body = fixture) {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_CONTEXT_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${mutation}\n${body}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["retained parent identity", change(read, "'parentRequestId',context.parent_request_id", "'parentRequestId',context.request_id"), "Context request lost binding or current authorship"],
  ["context retry", change(create, "IF context.context_text IS DISTINCT FROM p_context_text THEN", "IF false THEN"), "Changed context bytes replayed"],
  ["existing stage", change(create, "IF existing.id IS NOT NULL THEN", "IF false THEN"), "Existing segment changed stage"],
  ["self reference", change(create, "IF (binding->>'parentRequestId')::uuid=p_request THEN", "IF false THEN"), "Self parent accepted"],
  ["missing parent", change(create, "IF parent.id IS NULL THEN", "IF false THEN"), "Absent parent accepted"],
  ["parent scope", change(create, "AND campaign_id=p_campaign AND workspace_id=workspace", ""), "Foreign parent accepted"],
  ["existing foreign identity", change(create, "IF existing.campaign_id IS DISTINCT FROM p_campaign OR existing.workspace_id IS DISTINCT FROM workspace\n  OR existing.actor_id IS DISTINCT FROM auth.uid() THEN", "IF false THEN"), "Foreign request identity exposed"],
  ["nested context", change(create, "WHERE request_id=parent.id) THEN", "WHERE false) THEN"), "Context parent treated as segment"],
  ["future sequence", change(create, "IF through_sequence>sequence THEN", "IF false THEN"), "Future parent sequence accepted"],
  ["parent source", change(create, "IF (base_state#>>'{request,intentText}')::jsonb->>'sourceId' IS DISTINCT FROM parent.source_id::text THEN", "IF false THEN"), "Different parent source accepted"],
  ["binding version", change(create, "OR binding->'schemaVersion' IS DISTINCT FROM '1'::jsonb", ""), "Malformed context binding accepted"],
  ["binding fields", change(create, "OR (SELECT count(*) FROM jsonb_object_keys(binding))<>8", ""), "Malformed context binding accepted"],
  ["result digest", change(create, "binding->>'segmentResultsManifestSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed context binding accepted"],
  ["context digest", change(create, "binding->>'contextManifestSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed context binding accepted"],
  ["content digest", change(create, "binding->>'contentManifestSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed context binding accepted"],
  ["target kind", change(create, "binding->>'targetRecordId' !~ '^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'", "false"), "Malformed context binding accepted"],
  ["sequence lower bound", change(create, "through_sequence NOT BETWEEN 0 AND 9007199254740991", "false"), "Malformed context binding accepted"],
  ["sequence integer", change(create, "OR through_sequence<>trunc(through_sequence)", ""), "Malformed context binding accepted"],
  ["frame bound", change(create, "(binding->>'frameByteLimit')::numeric NOT BETWEEN 4096 AND 1048576", "false"), "Malformed context binding accepted"],
  ["frame integer", change(create, "OR (binding->>'frameByteLimit')::numeric<>trunc((binding->>'frameByteLimit')::numeric)", ""), "Malformed context binding accepted"],
  ["segment executor", change(planScope, "WHERE request_id=p_request) THEN", "WHERE false) THEN"), "Context request entered segment executor"],
  ["segment context read", change(read, "IF context.request_id IS NULL THEN", "IF false THEN"), "Segment exposed as context"],
  ["immutable context", "ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_request_immutable;", "Context binding mutation allowed"],
  ["direct private read", "GRANT SELECT ON engagement_synthesis_context_requests TO authenticated; CREATE POLICY synthetic_context_read ON engagement_synthesis_context_requests FOR SELECT TO authenticated USING(true);", "Direct context table access allowed"],
  ["anonymous create", `GRANT EXECUTE ON FUNCTION ${create} TO anon;`, "Anonymous context creation allowed"],
  ["anonymous read", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous context read allowed"],
  ["service create", `GRANT EXECUTE ON FUNCTION ${create} TO service_role;`, "Service impersonated context requester"],
  ["service read", `GRANT EXECUTE ON FUNCTION ${read} TO service_role;`, "Service impersonated context reader"],
] as const;

describe.skipIf(!LIVE_RLS)("native retained context-stage requests", () => {
  it("retains new authorship and exact retries without renewing parent execution", () => {
    expect(nativeContext()).toContain("synthesis-context-requests-verified");
  });
  it("preserves a harmless comment mutation", () => {
    expect(nativeContext(change(create, "Creation preserves current staff authorship", "Creation retains current staff authorship"))).toContain("synthesis-context-requests-verified");
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativeContext(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });

  it("requires both the child and parent request fences", async () => {
    const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
    for (const held of ["f0000000-0000-4000-8000-000000000010", "f0000000-0000-4000-8000-000000000001"]) {
      const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "", error = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { error += data; });
      const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      void done.catch(() => {});
      try {
        child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('synthesis-generation-request:${held}',0)); SELECT 'CONTEXT_LOCK_READY';\n`);
        await vi.waitFor(() => { expect(child.exitCode, error).toBeNull(); expect(output, error).toContain("CONTEXT_LOCK_READY"); }, { timeout: 8000, interval: 25 });
        // Seed the parent's immutable row directly so its setup does not consume
        // the contested lock before the actual context command reaches it.
        const prefix = fixture.split("INSERT INTO context_probe VALUES('original'")[0].replace(
          "SET LOCAL ROLE authenticated;\nSELECT pg_temp.gen_create();\nSELECT pg_temp.gen_cancel();\nRESET ROLE;",
          `RESET ROLE; INSERT INTO engagement_synthesis_generation_requests(id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text)
           SELECT 'f0000000-0000-4000-8000-000000000001','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
           '13466ed2-dcb7-4861-a528-68cc5579eea9',(value->>'sourceId')::uuid,(value->>'configurationRevisionId')::uuid,value::text FROM generation_probe WHERE key='intent';`,
        );
        const body = prefix + "SELECT pg_temp.expect_error('SELECT pg_temp.ctx_create()','PT503','Context request lock bypassed'); SELECT 'context-lock-verified';";
        expect(nativeContext("", body)).toContain("context-lock-verified");
        if (held.endsWith("001")) {
          let failure: unknown;
          try { nativeContext(change(create, "PERFORM lock_synthesis_generation_request_scope(p_campaign,(binding->>'parentRequestId')::uuid);", "PERFORM 1;"), body); } catch (error) { failure = error; }
          expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain("Context request lock bypassed");
        }
        expect(child.exitCode, "Lock holder exited before command returned").toBeNull();
      } finally {
        if (child.exitCode === null && !child.stdin.destroyed) child.stdin.end("ROLLBACK;\n");
        expect(await done, error).toBe(0);
      }
    }
  }, 30000);
});
