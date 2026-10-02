import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const setup = readFileSync("src/test/fixtures/engagement/synthesis-thematic-requests.sql", "utf8").split("-- Current staff can read")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-thematic-choices.sql", "utf8");
const create = "public.retain_engagement_synthesis_thematic_choice(uuid,uuid,text)";
const read = "public.read_engagement_synthesis_thematic_choice(uuid,uuid,text)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing thematic mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
// Each command, fault and synthetic row rolls back. Proposed hashes are not
// semantically verified here, and this fixture makes no provider call.
function nativeChoices(mutation = "", body = fixture) {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${source}\n${requests}\n${setup}\nRESET ROLE;\n${mutation}\n${body}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["author", change(create, "IF state#>>'{request,actorId}' IS DISTINCT FROM auth.uid()::text THEN", "IF false THEN"), "Other staff replayed choice write"],
  ["scope", change(create, "IF context.request_id IS NULL OR context_request.campaign_id IS DISTINCT FROM p_campaign\n OR context_request.workspace_id IS DISTINCT FROM thematic_request.workspace_id\n OR context_request.source_id IS DISTINCT FROM thematic_request.source_id THEN", "IF false THEN"), "Absent context accepted"],
  ["campaign", change(create, "OR context_request.campaign_id IS DISTINCT FROM p_campaign", "OR false"), "Foreign context identity accepted"],
  ["workspace", change(create, "OR context_request.workspace_id IS DISTINCT FROM thematic_request.workspace_id", "OR false"), "Foreign context identity accepted"],
  ["source", change(create, "OR context_request.source_id IS DISTINCT FROM thematic_request.source_id", "OR false"), "Foreign context identity accepted"],
  ["parent", change(create, "context.parent_request_id::text IS DISTINCT FROM requested->>'parentRequestId'", "false"), "Changed context binding accepted"],
  ["parent sequence", change(create, "context_binding->'selectionSequence' IS DISTINCT FROM requested->'selectionSequence'", "false"), "Changed context binding accepted"],
  ["segment manifest", change(create, "context_binding->>'segmentResultsManifestSha256' IS DISTINCT FROM requested->>'segmentResultsManifestSha256'", "false"), "Changed context binding accepted"],
  ["context manifest", change(create, "context_binding->>'contextManifestSha256' IS DISTINCT FROM requested->>'contextManifestSha256'", "false"), "Changed context binding accepted"],
  ["target", change(create, "context_binding->>'targetRecordId' IS DISTINCT FROM choice->>'targetRecordId'", "false"), "Changed context binding accepted"],
  ["future selection", change(create, "IF through_sequence>available_sequence THEN", "IF false THEN"), "Future context selection accepted"],
  ["source membership", change(create, "IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements", "IF false AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements"), "Unknown retained contribution accepted"],
  ["retry", change(create, "IF previous.choice_text IS DISTINCT FROM p_choice_text THEN", "IF false THEN"), "Changed choice replayed"],
  ["cancelled write", change(create, "IF state->'cancellation'<>'null'::jsonb THEN", "IF false THEN"), "Cancelled request accepted new choice"],
  ["version", change(create, "choice->'schemaVersion' IS DISTINCT FROM '1'::jsonb", "false"), "Malformed choice accepted"],
  ["extra fields", change(create, "(SELECT count(*) FROM jsonb_object_keys(choice))<>7", "false"), "Malformed choice accepted"],
  ["history digest", change(create, "choice->>'historyManifestSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed choice accepted"],
  ["capture digest", change(create, "choice->>'finalCaptureSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed choice accepted"],
  ["result digest", change(create, "choice->>'finalResultSha256' !~ '^[a-f0-9]{64}$'", "false"), "Malformed choice accepted"],
  ["sequence range", change(create, "through_sequence NOT BETWEEN 0 AND 9007199254740991", "false"), "Malformed choice accepted"],
  ["sequence integer", change(create, "through_sequence<>trunc(through_sequence)", "false"), "Malformed choice accepted"],
  ["immutable rows", "ALTER TABLE engagement_synthesis_thematic_choices DISABLE TRIGGER synthesis_thematic_choice_immutable;", "Choice update allowed"],
  ["direct read", "GRANT SELECT ON engagement_synthesis_thematic_choices TO authenticated; CREATE POLICY synthetic_choice_read ON engagement_synthesis_thematic_choices FOR SELECT TO authenticated USING(true);", "Direct choice read allowed"],
  ["anonymous write", `GRANT EXECUTE ON FUNCTION ${create} TO anon;`, "Anonymous choice write allowed"],
  ["service write", `GRANT EXECUTE ON FUNCTION ${create} TO service_role;`, "Service impersonated choice author"],
  ["anonymous read", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous choice read allowed"],
  ["service read", `GRANT EXECUTE ON FUNCTION ${read} TO service_role;`, "Service impersonated choice reader"],
  ["original authorship", change(read, "'createdBy',saved.created_by", "'createdBy',auth.uid()"), "Current staff lost cancelled choice history"],
] as const;

describe.skipIf(!LIVE_RLS)("native thematic input choices", () => {
  it("retains scoped original inputs and exact recovery", () => {
    expect(nativeChoices()).toContain("synthesis-thematic-choices-verified");
  });
  it("survives a harmless comment change", () => {
    expect(nativeChoices(change(create, "Original acknowledgement recovery", "Exact acknowledgement recovery"))).toContain("synthesis-thematic-choices-verified");
  });
  it.each(faults)("detects broken %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativeChoices(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
