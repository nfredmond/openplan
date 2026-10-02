// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSynthesisThematicInputManifest } from "@/lib/engagement/synthesis-thematic-input-manifest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000007_engagement_synthesis_thematic_input_seals.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const thematic = readFileSync("src/test/fixtures/engagement/synthesis-thematic-requests.sql", "utf8").split("-- Current staff can read")[0];
const choices = readFileSync("src/test/fixtures/engagement/synthesis-thematic-choices.sql", "utf8").split("SELECT pg_temp.gen_cancel(")[0];
const inputs = readFileSync("src/test/fixtures/engagement/synthesis-thematic-inputs.sql", "utf8").split("SELECT pg_temp.gen_cancel(")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-thematic-input-seals.sql", "utf8");
const save = "public.seal_engagement_synthesis_thematic_inputs(uuid,text)";
const read = "public.read_engagement_synthesis_thematic_input_inventory(uuid,text,integer)";
const identity = "public.synthesis_thematic_input_inventory_identity(uuid)";
const input = "public.retain_engagement_synthesis_thematic_input(uuid,text,text,text)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing input seal mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
function nativeSeal(mutation = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_THEMATIC_SEALS_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${thematic}\n${choices}\n${inputs}\nRESET ROLE;\n${mutation}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 90000, maxBuffer: 16 * 1024 * 1024,
  });
}
const membershipStart = migration.indexOf(" IF EXISTS(SELECT 1 FROM unnest(members) member WHERE NOT EXISTS(");
const membershipEnd = migration.indexOf(" seed:=", membershipStart);
const membershipBlock = migration.slice(membershipStart, membershipEnd);
const faults = [
  ...["schemaVersion", "purpose", "requestId", "campaignId", "workspaceId", "actorId", "intentSha256", "thematicSha256",
    "sourceId", "sourceSha256", "inputCount", "outputBytes", "seedSha256", "tailSha256"].map(key => [
    `manifest ${key}`, change(save, "p_manifest_text::jsonb IS DISTINCT FROM expected", `p_manifest_text::jsonb - '${key}' IS DISTINCT FROM expected - '${key}'`), `Changed seal manifest accepted: ${key}`,
  ] as const),
  ["complete membership", change(save, "IF EXISTS(SELECT 1 FROM unnest(members) member WHERE NOT EXISTS(", "IF false AND EXISTS(SELECT 1 FROM unnest(members) member WHERE NOT EXISTS("), "Incomplete source sealed"],
  ["same-count substitution", change(save, membershipBlock, ` IF member_count<>(SELECT count(*) FROM engagement_synthesis_thematic_inputs WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Thematic inputs do not cover the exact retained source' USING ERRCODE='PT409';
 END IF;
`), "Same-count substituted source sealed"],
  ["foreign input substitution", change(save, "i.request_id=p_request AND i.target_record_id=member", "i.target_record_id=member"), "Missing last input sealed"],
  ["inventory dependency", change(read, "WHERE request_id=p_request", "WHERE request_id='f0000000-0000-4000-8000-000000000011'::uuid"), "Inventory metadata differs"],
  ["source campaign", change(identity, "source.campaign_id IS DISTINCT FROM request.campaign_id", "false"), "Foreign inventory source campaign accepted"],
  ["source workspace", change(identity, "source.workspace_id IS DISTINCT FROM request.workspace_id", "false"), "Foreign inventory source workspace accepted"],
  ["source ID", change(identity, "request.intent_text::jsonb->>'sourceId' IS DISTINCT FROM source.id::text", "false"), "Substituted inventory source ID accepted"],
  ["source hash", change(identity, "request.intent_text::jsonb->>'sourceSha256' IS DISTINCT FROM source.snapshot_sha256", "false"), "Substituted inventory source hash accepted"],
  ["chain target", change(save, "||':'||row.target_record_id", "||':omitted'"), "Thematic input manifest differs from retained bytes"],
  ["chain proof", change(save, "||':'||row.proof_sha256", "||':omitted'"), "Thematic input manifest differs from retained bytes"],
  ["chain output", change(save, "||':'||row.output_sha256", "||':omitted'"), "Thematic input manifest differs from retained bytes"],
  ["chain bytes", change(save, "||':'||octet_length(row.output_text)::text", "||':omitted'"), "Thematic input manifest differs from retained bytes"],
  ["page cursor", change(read, 'target_record_id COLLATE "C">p_after_target COLLATE "C"', "true"), "Inventory ordering differs"],
  ["page continuation", change(read, "'hasMore',jsonb_array_length(entries)>p_limit", "'hasMore',false"), "Inventory silently omitted its tail"],
  ["page trimming", change(read, "THEN entries-p_limit ELSE entries END", "THEN entries ELSE entries END"), "Inventory page bound differs"],
  ["page size", change(read, "p_limit NOT BETWEEN 1 AND 128", "false"), "Zero page limit accepted"],
  ["cancelled seal", change(save, "IF identity#>'{thematic,cancellation}'<>'null'::jsonb THEN", "IF false THEN"), "Cancelled source sealed"],
  ["duplicate source", change(save, "member_count<>distinct_count", "false"), "Duplicate source membership sealed"],
  ["exact retry", change(save, "IF existing.manifest_text IS DISTINCT FROM p_manifest_text THEN", "IF false THEN"), "Changed seal retry accepted"],
  ["sealed insertion", change(input, "IF EXISTS(SELECT 1 FROM engagement_synthesis_thematic_input_seals WHERE request_id=p_request) THEN", "IF false THEN"), "Fresh input entered sealed request"],
  ["seal immutable", "ALTER TABLE engagement_synthesis_thematic_input_seals DISABLE TRIGGER synthesis_thematic_input_seal_immutable;", "Seal update allowed"],
  ["seal RLS", "ALTER TABLE engagement_synthesis_thematic_input_seals DISABLE ROW LEVEL SECURITY;", "Seal RLS disabled"],
  ["direct seal write", "GRANT INSERT ON engagement_synthesis_thematic_input_seals TO service_role;", "Direct seal mutation allowed"],
  ["staff seal", `GRANT EXECUTE ON FUNCTION ${save} TO authenticated;`, "Client seal command allowed"],
  ["anonymous inventory", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Client seal command allowed"],
] as const;
describe.skipIf(!LIVE_RLS)("native complete-source thematic input seal", () => {
  it("compares whole-source custody and its chain with the application implementation", () => {
    const output = nativeSeal(); expect(output).toContain("synthesis-thematic-input-seal-verified");
    const line = output.split("\n").find(line => line.startsWith("SEAL-COMPATIBILITY:")); expect(line).toBeDefined();
    const packet = z.object({ scope: z.object({ campaignId: z.string(), workspaceId: z.string(), requestId: z.string() }),
      request: z.unknown(), source: z.unknown(), entries: z.array(z.unknown()), manifest: z.unknown() }).parse(JSON.parse(line!.slice("SEAL-COMPATIBILITY:".length)));
    const plan = createSynthesisThematicInputManifest(packet.request, packet.scope, packet.source, packet.entries);
    expect(plan.manifest).toEqual(packet.manifest); expect(plan.manifest.inputCount).toBeGreaterThan(300);
  }, 90000);
  it("preserves a harmless comment change", () => {
    expect(nativeSeal(change(input, "Fresh writes recheck", "New writes recheck"))).toContain("synthesis-thematic-input-seal-verified");
  }, 90000);
  it.each(faults)("detects broken %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativeSeal(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  }, 90000);
});
