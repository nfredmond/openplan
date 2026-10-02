import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000003_engagement_synthesis_thematic_requests.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-thematic-requests.sql", "utf8");
const create = "public.create_engagement_synthesis_thematic_request(uuid,uuid,text,text)";
const read = "public.read_engagement_synthesis_thematic_request(uuid,uuid)";
const planScope = "public.lock_synthesis_generation_plan_scope(uuid)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing thematic mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
// Each command, fault and synthetic row rolls back. Proposed hashes are not
// semantically verified here, and this fixture makes no provider call.
function nativeThematic(mutation = "", body = fixture) {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_THEMATIC_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${mutation}\n${body}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["context parent", change(create, "OR EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=parent.id)", "OR false"), "Context parent entered thematic creation"],
  ["thematic context parent", "ALTER TABLE engagement_synthesis_context_requests DISABLE TRIGGER synthesis_context_parent_stage;", "Thematic parent entered context creation"],
  ["retained parent identity", change(read, "'parentRequestId',thematic.parent_request_id", "'parentRequestId',thematic.request_id"), "Thematic request lost binding or current authorship"],
  ["thematic retry", change(create, "IF thematic.thematic_text IS DISTINCT FROM p_thematic_text THEN", "IF false THEN"), "Changed thematic bytes replayed"],
  ["existing stage", change(create, "IF existing.id IS NOT NULL THEN", "IF false THEN"), "Existing segment changed stage"],
  ["self reference", change(create, "IF (binding->>'parentRequestId')::uuid=p_request THEN", "IF false THEN"), "Self parent accepted"],
  ["missing parent", change(create, "IF parent.id IS NULL THEN", "IF false THEN"), "Absent parent accepted"],
  ["parent scope", change(create, "AND campaign_id=p_campaign AND workspace_id=workspace", ""), "Foreign parent accepted"],
  ["existing foreign identity", change(create, "IF existing.campaign_id IS DISTINCT FROM p_campaign OR existing.workspace_id IS DISTINCT FROM workspace\n  OR existing.actor_id IS DISTINCT FROM auth.uid() THEN", "IF false THEN"), "Foreign request identity exposed"],
  ["nested thematic", change(create, "IF EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=parent.id)", "IF false"), "Thematic parent treated as segment"],
  ["future sequence", change(create, "IF through_sequence>sequence THEN", "IF false THEN"), "Future parent sequence accepted"],
  ["parent source", change(create, "IF (base_state#>>'{request,intentText}')::jsonb->>'sourceId' IS DISTINCT FROM parent.source_id::text THEN", "IF false THEN"), "Different parent source accepted"],
  ["binding version", change(create, "OR binding->'schemaVersion' IS DISTINCT FROM '1'::jsonb", ""), "Malformed thematic binding accepted"],
  ["binding fields", change(create, "OR (SELECT count(*) FROM jsonb_object_keys(binding))<>6", ""), "Malformed thematic binding accepted"],
  ["result digest", change(create, "binding->>'segmentResultsManifestSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed thematic binding accepted"],
  ["thematic digest", change(create, "binding->>'contextManifestSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed thematic binding accepted"],
  ["sequence lower bound", change(create, "through_sequence NOT BETWEEN 0 AND 9007199254740991", "false"), "Malformed thematic binding accepted"],
  ["sequence integer", change(create, "OR through_sequence<>trunc(through_sequence)", ""), "Malformed thematic binding accepted"],
  ["frame bound", change(create, "(binding->>'frameByteLimit')::numeric NOT BETWEEN 4096 AND 1048576", "false"), "Malformed thematic binding accepted"],
  ["frame integer", change(create, "OR (binding->>'frameByteLimit')::numeric<>trunc((binding->>'frameByteLimit')::numeric)", ""), "Malformed thematic binding accepted"],
  ["segment executor", change(planScope, "WHERE request_id=p_request) THEN", "WHERE false) THEN"), "Thematic request entered segment executor"],
  ["segment thematic read", change(read, "IF thematic.request_id IS NULL THEN", "IF false THEN"), "Segment exposed as thematic"],
  ["immutable thematic", "ALTER TABLE engagement_synthesis_thematic_requests DISABLE TRIGGER synthesis_thematic_request_immutable;", "Thematic binding mutation allowed"],
  ["direct private read", "GRANT SELECT ON engagement_synthesis_thematic_requests TO authenticated; CREATE POLICY synthetic_thematic_read ON engagement_synthesis_thematic_requests FOR SELECT TO authenticated USING(true);", "Direct thematic table access allowed"],
  ["anonymous create", `GRANT EXECUTE ON FUNCTION ${create} TO anon;`, "Anonymous thematic creation allowed"],
  ["anonymous read", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous thematic read allowed"],
  ["service create", `GRANT EXECUTE ON FUNCTION ${create} TO service_role;`, "Service impersonated thematic requester"],
  ["service read", `GRANT EXECUTE ON FUNCTION ${read} TO service_role;`, "Service impersonated thematic reader"],
] as const;

describe.skipIf(!LIVE_RLS)("native retained thematic-stage requests", () => {
  it("retains new authorship and exact retries without renewing parent execution", () => {
    expect(nativeThematic()).toContain("synthesis-thematic-requests-verified");
  });
  it("preserves a harmless comment mutation", () => {
    expect(nativeThematic(change(create, "Creation preserves current staff authorship", "Creation retains current staff authorship"))).toContain("synthesis-thematic-requests-verified");
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativeThematic(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });

});
