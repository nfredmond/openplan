import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const sourceFixture = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-review-custody.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261014000027_engagement_synthesis_reviews.sql", "utf8");
const retain = "public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text)";
const read = "public.read_engagement_synthesis_review(uuid,uuid,uuid)";
const roots = "public.list_engagement_synthesis_reviews(uuid,uuid,jsonb)";
const revisions = "public.list_engagement_synthesis_review_revisions(uuid,uuid,integer)";
const tiedRoots = "ALTER TABLE engagement_synthesis_reviews ALTER COLUMN created_at SET DEFAULT '2026-01-01T00:00:00Z'::timestamptz;";
function change(signature: string, old: string, replacement: string) {
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${signature}'::regprocedure); IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing review mutation seam'; END IF; EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
/** Each native case rolls back its data and faults, and candidate mode also rolls back the new migration. */
function run(fault = "", unscopedSourceCount = false) {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const candidate = process.env.OPENPLAN_SYNTHESIS_REVIEW_CANDIDATE === "1" ? migration : "";
  const source = unscopedSourceCount ? sourceFixture.replace("count(*)=5 FROM engagement_synthesis_sources WHERE campaign_id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'", "count(*)=5 FROM engagement_synthesis_sources") : sourceFixture;
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
    input: `BEGIN; SET LOCAL statement_timeout='35s'; SET LOCAL lock_timeout='2s';\n${candidate}\n${fault}\n${source}\n${fixture}\nROLLBACK;`,
  }).trim().split("\n").at(-1);
}
function refuses(fault: string, expected: string, unscoped = false) {
  let failure: unknown;
  try { run(fault, unscoped); } catch (error) { failure = error; }
  expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
}
describe.skipIf(!LIVE_RLS)("native synthesis review custody", () => {
  it.each(["", "-- Harmless review custody control.", tiedRoots])("retains original and corrected bytes with scoped retries and history %s", control => {
    expect(run(control)).toBe("synthesis-review-custody-verified");
  });
  it("ignores another campaign in source-fixture counts and detects the old global count", () => {
    refuses("", "Source request count differs after refusals/retries", true);
  });
  it.each([
    ["direct review read", "GRANT SELECT ON engagement_synthesis_reviews TO authenticated; CREATE POLICY synthetic_allow_review ON engagement_synthesis_reviews FOR SELECT TO authenticated USING(true);", "Direct private review read was allowed"],
    ["direct revision read", "GRANT SELECT ON engagement_synthesis_review_revisions TO authenticated; CREATE POLICY synthetic_allow_revision ON engagement_synthesis_review_revisions FOR SELECT TO authenticated USING(true);", "Direct private revision read was allowed"],
    ["client machine-preparation writes", `GRANT EXECUTE ON FUNCTION ${retain} TO authenticated;`, "Authenticated caller forged machine preparation"],
    ["private receipt helper", "GRANT EXECUTE ON FUNCTION public.engagement_synthesis_review_receipt(uuid,boolean) TO authenticated;", "Private receipt helper was callable"],
    ["changed retry intent", change(retain, "OR saved.intent_json IS DISTINCT FROM p_intent", ""), "Changed correction retry was accepted"],
    ["another retry actor", change(retain, "saved.actor_id IS DISTINCT FROM p_actor OR", "") + change(retain, "saved.intent_json IS DISTINCT FROM p_intent", "(saved.intent_json-'actorId') IS DISTINCT FROM (p_intent-'actorId')"), "Another actor reused review request"],
    ["stale parent", change(retain, "IF NOT FOUND OR parent.id::text IS DISTINCT FROM p_intent->>'expectedRevisionId'\n   OR parent.content_sha256 IS DISTINCT FROM p_intent->>'expectedRevisionSha256' THEN", "IF false THEN"), "Stale parent overwrote the current review"],
    ["wrong parent checksum", change(retain, "OR parent.content_sha256 IS DISTINCT FROM p_intent->>'expectedRevisionSha256'", ""), "Wrong parent checksum was accepted"],
    ["approval promotion", change(retain, "OR content->>'status' IS DISTINCT FROM 'staff_draft'", ""), "Draft retention promoted approval"],
    ["content source checksum", change(retain, "OR content->>'sourceSha256' IS DISTINCT FROM p_source_sha256", ""), "Content source checksum differed"],
    ["preparation source checksum", change(retain, "OR preparation#>>'{source,sha256}' IS DISTINCT FROM p_source_sha256", ""), "Preparation source checksum differed"],
    ["invented preparation sentiment", change(retain, "OR preparation->>'interpretation' IS DISTINCT FROM 'not_assessed'", ""), "Preparation claimed inferred sentiment"],
    ["no-op correction", change(retain, "IF parent.content_text=p_content_text THEN", "IF false THEN"), "Unchanged content created a revision"],
    ["mutable preparation", "ALTER TABLE engagement_synthesis_reviews DISABLE TRIGGER engagement_synthesis_reviews_immutable;", "Original preparation was mutable"],
    ["mutable revision", "ALTER TABLE engagement_synthesis_review_revisions DISABLE TRIGGER engagement_synthesis_review_revisions_immutable;", "Revision content was mutable"],
    ["revoked writer", change(retain, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Revoked staff replayed review creation"],
    ["viewer review bytes", change(read, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Viewer read a private review"],
    ["viewer review list", change(roots, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Viewer listed private review metadata"],
    ["viewer revision list", change(revisions, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Viewer listed revision metadata"],
    ["anonymous read", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous review read was allowed"],
    ["anonymous review list", `GRANT EXECUTE ON FUNCTION ${roots} TO anon;`, "Anonymous review listing was allowed"],
    ["anonymous revision list", `GRANT EXECUTE ON FUNCTION ${revisions} TO anon;`, "Anonymous revision listing was allowed"],
    ["missing root lookahead", change(roots, "DESC LIMIT 26", "DESC LIMIT 25"), "Review list lost its continuation"],
    ["inclusive root cursor", change(roots, "(r.created_at,r.id)<(before_time,before_id)", "(r.created_at,r.id)<=(before_time,before_id)"), "Review list lost its tail"],
    ["missing root timestamp tie breaker", tiedRoots + change(roots, "(r.created_at,r.id)<(before_time,before_id)", "r.created_at<before_time"), "Review list lost its tail"],
    ["missing revision lookahead", change(revisions, "DESC LIMIT 26", "DESC LIMIT 25"), "Revision list lost its continuation"],
    ["inclusive revision cursor", change(revisions, "revision_no<p_before", "revision_no<=p_before"), "Revision list lost its tail"],
  ])("detects %s", (_name, fault, expected) => refuses(fault, expected));
});
