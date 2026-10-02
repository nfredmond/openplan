import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000005_engagement_synthesis_thematic_preparation.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const thematic = readFileSync("src/test/fixtures/engagement/synthesis-thematic-requests.sql", "utf8").split("-- Current staff can read")[0];
const choices = readFileSync("src/test/fixtures/engagement/synthesis-thematic-choices.sql", "utf8").split("SELECT pg_temp.gen_cancel(")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-thematic-preparation.sql", "utf8");
const read = "public.read_engagement_synthesis_thematic_preparation(uuid,text)";
const page = "public.read_engagement_synthesis_thematic_preparation_selections(uuid,text,text,bigint,integer)";
const scope = "public.lock_synthesis_thematic_preparation_scope(uuid)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing preparation mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
// Candidate functions, fixtures and deliberate faults roll back together.
function nativePreparation(mutation = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_THEMATIC_PREPARATION_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${thematic}\n${choices}\nRESET ROLE;\n${mutation}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["page dependency", change(page, "s.request_id=dependency", "s.request_id='f0000000-0000-4000-8000-000000000020'::uuid"), "Anchored first parent page differs"],
  ["page cursor predicate", change(page, "s.task_index>p_after_task_index", "true"), "Anchored final parent page differs"],
  ["page anchor", change(page, "s.sequence_no<=through_sequence", "true"), "Anchored final parent page differs"],
  ["later successor", change(page, "n.sequence_no<=through_sequence", "true"), "Anchored earlier context page differs"],
  ["page receipt digest", change(page, "'receiptSha256',s.receipt_sha256", "'receiptSha256',repeat('0',64)"), "Anchored first parent page differs"],
  ["page hasMore", change(page, "'hasMore',jsonb_array_length(entries)>p_limit", "'hasMore',false"), "Anchored first parent page differs"],
  ["page extra row", change(page, "THEN entries-p_limit ELSE entries END", "THEN entries ELSE entries END"), "Anchored first parent page differs"],
  ["parent campaign_id", change(read, "parent.campaign_id IS DISTINCT FROM request.campaign_id", "false"), "Foreign parent campaign_id accepted"],
  ["parent workspace_id", change(read, "parent.workspace_id IS DISTINCT FROM request.workspace_id", "false"), "Foreign parent workspace_id accepted"],
  ["parent source_id", change(read, "parent.source_id IS DISTINCT FROM request.source_id", "false"), "Foreign parent source_id accepted"],
  ["context campaign_id", change(read, "child.campaign_id IS DISTINCT FROM request.campaign_id", "false"), "Foreign context campaign_id accepted"],
  ["context workspace_id", change(read, "child.workspace_id IS DISTINCT FROM request.workspace_id", "false"), "Foreign context workspace_id accepted"],
  ["context source_id", change(read, "child.source_id IS DISTINCT FROM request.source_id", "false"), "Foreign context source_id accepted"],
  ["source campaign_id", change(read, "source.campaign_id IS DISTINCT FROM request.campaign_id", "false"), "Foreign source campaign_id accepted"],
  ["source workspace_id", change(read, "source.workspace_id IS DISTINCT FROM request.workspace_id", "false"), "Foreign source workspace_id accepted"],
  ["context parentRequestId", change(read, "child_binding->'parentRequestId' IS DISTINCT FROM binding->'parentRequestId'", "false"), "Changed context parentRequestId accepted"],
  ["context selectionSequence", change(read, "child_binding->'selectionSequence' IS DISTINCT FROM binding->'selectionSequence'", "false"), "Changed context selectionSequence accepted"],
  ["context segmentResultsManifestSha256", change(read, "child_binding->'segmentResultsManifestSha256' IS DISTINCT FROM binding->'segmentResultsManifestSha256'", "false"), "Changed context segmentResultsManifestSha256 accepted"],
  ["context contextManifestSha256", change(read, "child_binding->'contextManifestSha256' IS DISTINCT FROM binding->'contextManifestSha256'", "false"), "Changed context contextManifestSha256 accepted"],
  ["context parent column", change(read, "context.parent_request_id IS DISTINCT FROM parent.id", "false"), "Changed context parent column accepted"],
  ["context target", change(read, "child_binding->>'targetRecordId' IS DISTINCT FROM p_target", "false"), "Changed context targetRecordId accepted"],
  ["source membership", change(read, "IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements", "IF false AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements"), "Target outside source accepted"],
  ["root campaign", change(scope, "IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=saved.campaign_id AND workspace_id=saved.workspace_id FOR SHARE NOWAIT) THEN", "IF false THEN"), "Foreign root campaign accepted"],
  ["requester", change(scope, "AND m.user_id=saved.actor_id AND m.role IN ('owner','admin','member')", "AND m.role IN ('owner','admin','member','viewer')"), "Revoked thematic requester read preparation"],
  ["cancelled root", change(scope, "IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN", "IF false THEN"), "Cancelled thematic request prepared new input"],
  ["stage", change(scope, "IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=p_request) THEN", "IF false THEN"), "Segment request accepted as thematic"],
  ["choice author", change(read, "OR choice.created_by IS DISTINCT FROM request.actor_id", "OR false"), "Different choice author accepted"],
  ["context sequence", change(page, "IF through_sequence NOT BETWEEN 0 AND available_sequence THEN", "IF false THEN"), "Unretained context sequence accepted"],
  ["cursor", change(page, "p_after_task_index NOT BETWEEN -1 AND 9007199254740991", "false"), "Invalid page cursor accepted"],
  ["page bound", change(page, "p_limit NOT BETWEEN 1 AND 128", "false"), "Invalid page limit accepted"],
  ["anonymous scope read", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous preparation allowed"],
  ["staff scope read", `GRANT EXECUTE ON FUNCTION ${read} TO authenticated;`, "Staff bypassed preparation delegation"],
  ["anonymous page read", `GRANT EXECUTE ON FUNCTION ${page} TO anon;`, "Anonymous preparation allowed"],
  ["staff page read", `GRANT EXECUTE ON FUNCTION ${page} TO authenticated;`, "Staff bypassed preparation delegation"],
  ["private formatter", "GRANT EXECUTE ON FUNCTION public.synthesis_preparation_request_record(uuid) TO service_role;", "Private preparation helper exposed"],
  ["private scope", `GRANT EXECUTE ON FUNCTION ${scope} TO service_role;`, "Private preparation helper exposed"],
] as const;
describe.skipIf(!LIVE_RLS)("native thematic preparation delegation", () => {
  it("checks the new requester while retaining departed parent authorship", () => {
    expect(nativePreparation()).toContain("synthesis-thematic-preparation-verified");
  });
  it("preserves a harmless comment change", () => {
    expect(nativePreparation(change(read, "before reading selected history", "before inspecting selected history"))).toContain("synthesis-thematic-preparation-verified");
  });
  it.each(faults)("detects broken %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativePreparation(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
