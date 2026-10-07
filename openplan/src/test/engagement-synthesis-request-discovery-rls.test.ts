import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000013_engagement_synthesis_request_discovery.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const thematic = readFileSync("src/test/fixtures/engagement/synthesis-thematic-requests.sql", "utf8").split("SELECT pg_temp.assert_true((SELECT value#>>'{request,actorId}'")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-request-discovery.sql", "utf8");
const target = "public.list_engagement_synthesis_generation_requests(uuid,uuid,jsonb)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(old: string, next: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
   IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing discovery mutation seam'; END IF;
   EXECUTE replace(body,${literal(old)},${literal(next)}); END $fault$;`;
}
// All commands and faults roll back. Listing checks metadata and access, not proposal semantics.
function native(mutation = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_REQUEST_DISCOVERY_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${thematic}\nRESET ROLE;\n${mutation}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["context stage", change("THEN 'context'", "THEN 'segment'"), "Generation stages or parent links differ"],
  ["thematic stage", change("THEN 'thematic'", "THEN 'segment'"), "Generation stages or parent links differ"],
  ["segment stage", change("ELSE 'segment' END stage", "ELSE 'thematic' END stage"), "Generation stages or parent links differ"],
  ["parent link", change("'parentRequestId',v.parent_request_id", "'parentRequestId',NULL"), "Discovery ordering, cancellation or authorship differs"],
  ["intent hash", change("'intentSha256',v.intent_sha256", "'intentSha256',repeat('0',64)"), "Generation intent hash differs"],
  ["principal", change("m.user_id=auth.uid()", "true"), "Viewer browsed generation requests"],
  ["staff role", change("m.role IN ('owner','admin','member')", "true"), "Viewer browsed generation requests"],
  ["source identity", change("r.source_id=p_source", "true"), "Discovery tail page differs"],
  ["missing source", change("IF NOT FOUND THEN RAISE EXCEPTION 'Saved source not accessible'", "IF false THEN RAISE EXCEPTION 'Saved source not accessible'"), "Foreign source exposed"],
  ["cursor membership", change("(r.created_at,r.id)<(before_time,before_id)", "true"), "Discovery tail page differs"],
  ["cursor tie", change("(r.created_at,r.id)<(before_time,before_id)", "r.created_at<before_time"), "Discovery tail page differs"],
  ["page limit", change("LIMIT 25", "LIMIT 24"), "Discovery first page bound differs"],
  ["tail cursor", change("(SELECT count(*) FROM page)>25", "true"), "Discovery tail page differs"],
  ["cancellation", change("'cancelled',v.cancelled", "'cancelled',false"), "Discovery ordering, cancellation or authorship differs"],
  ["requester filter", change("r.source_id=p_source AND", "r.actor_id=auth.uid() AND r.source_id=p_source AND"), "Discovery tail page differs"],
  ["cursor fields", change("(SELECT count(*) FROM jsonb_object_keys(p_before))<>2", "false"), "Unknown cursor field accepted"],
  ["date cursor", change("IF p_before->>'createdAt' !~", "IF false AND p_before->>'createdAt' !~"), "Date-only cursor accepted"],
  ["anonymous privilege", `GRANT EXECUTE ON FUNCTION ${target} TO anon;`, "Anonymous discovery grant"],
  ["service privilege", `GRANT EXECUTE ON FUNCTION ${target} TO service_role;`, "Service discovery grant"],
] as const;
describe.skipIf(!LIVE_RLS)("native generation request discovery", () => {
  it("browses current-staff history with tied keyset pages and exact source scope", () => expect(native()).toContain("generation-discovery-verified"));
  it("preserves a harmless message change", () => expect(native(change("Generation history is busy", "Generation browsing is busy"))).toContain("generation-discovery-verified"));
  it.each(faults)("detects %s", (_name, mutation, reason) => {
    let failure: unknown; try { native(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(reason);
  });
});
