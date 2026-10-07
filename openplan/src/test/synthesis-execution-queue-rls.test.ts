// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const fixture = (name: string) => readFileSync(`src/test/fixtures/engagement/synthesis-${name}.sql`, "utf8");
const source = fixture("source-custody");
const requests = fixture("generation-requests").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const plans = fixture("generation-plans").split("-- Clear the staff JWT claim.")[0];
const execution = fixture("generation-execution").split("-- Preparation and empty selections never authorize model calls.")[0];
const contexts = fixture("context-requests").split("SELECT pg_temp.assert_true((SELECT value#>>'{request,actorId}'")[0];
const contextPlans = fixture("context-plans").split("-- Current staff commands")[0];
const contextExecution = fixture("context-execution").split("CREATE FUNCTION pg_temp.ce_id")[0];
const thematic = fixture("thematic-requests").split("-- Current staff can read")[0];
const choices = fixture("thematic-choices").split("SELECT pg_temp.gen_cancel(")[0];
const inputs = fixture("thematic-inputs").split("SELECT pg_temp.gen_cancel(")[0];
const seals = fixture("thematic-input-seals");
const sealHelpers = seals.split("DO $$ DECLARE signature")[0];
const sealComplete = seals.slice(seals.indexOf("-- Complete every actual source member"), seals.indexOf("DO $$ DECLARE page jsonb;"));
const thematicPlans = fixture("thematic-plans").split("SELECT set_config('request.jwt.claim.sub'")[0];
const thematicExecution = fixture("thematic-execution").split("CREATE FUNCTION pg_temp.te_id")[0];
type Stage = "segment" | "context" | "thematic";
const setups: Record<Stage, string> = {
  segment: `${plans}\n${execution}`,
  context: `${contexts}\n${contextPlans}\n${contextExecution}`,
  thematic: `${thematic}\n${choices}\n${inputs}\nRESET ROLE;\n${sealHelpers}\n${sealComplete}\n${thematicPlans}\n${thematicExecution}`,
};
const grants: Record<Stage, string> = { segment: "execution_grant", context: "ce_grant", thematic: "te_grant" };
const migration = readFileSync("supabase/migrations/20261016000013_synthesis_execution_queue.sql", "utf8");
const native = fixture("execution-queue");
const definition = migration.slice(migration.indexOf("CREATE FUNCTION public.enqueue_"), migration.indexOf("REVOKE ALL ON FUNCTION"))
  .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
function change(old: string, replacement: string) {
  if (!definition.includes(old)) throw new Error("Missing enqueue mutation seam");
  return definition.replace(old, replacement);
}

/** Fresh transaction fixtures prove SQL command and role boundaries. They do
 * not establish HTTP isolation, worker concurrency, network or browser recovery.
 * All stages use repository fixtures; synthetic outputs prove no semantics.
 */
function probe(mutation = "", stage: Stage = "segment") {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_EXECUTION_QUEUE_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${setups[stage]}
      RESET ROLE; SELECT set_config('request.jwt.claim.sub',(SELECT actor_id::text FROM engagement_synthesis_generation_requests WHERE id='${stage === "segment" ? "f0000000-0000-4000-8000-000000000001" : "f0000000-0000-4000-8000-000000000010"}'),true);
      SET LOCAL ROLE authenticated; SELECT pg_temp.${grants[stage]}(); RESET ROLE;
      ${mutation}\n${stage === "segment" ? native : native.replace("r.id='f0000000-0000-4000-8000-000000000001'", "r.id='f0000000-0000-4000-8000-000000000010'")}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
}
const faults = [
  ["exact bytes", change("saved.command_text IS DISTINCT FROM p_command_text", "false"), "Changed original bytes accepted"],
  ["actor", change("(command->>'actorId')::uuid IS DISTINCT FROM auth.uid()", "false"), "Changed actor accepted"],
  ["stage", change("actual_stage IS DISTINCT FROM command->>'stage'", "false"), "Changed stage accepted"],
  ["permission hash", change("permission.intent_sha256 IS DISTINCT FROM command->>'authorizationIntentSha256'", "false"), "Changed hash accepted: authorizationIntentSha256"],
  ["expiry", change("(permission.intent_text::jsonb->>'expiresAt')::timestamptz<=clock_timestamp()", "false"), "Expired new queue accepted"],
  ["anonymous execute", "GRANT EXECUTE ON FUNCTION public.enqueue_engagement_synthesis_execution(text) TO anon;", "Nonstaff execute allowed"],
  ["direct read", "GRANT SELECT ON public.engagement_synthesis_execution_queue TO authenticated;", "Authenticated direct read allowed"],
] as const;

describe.skipIf(!LIVE_RLS)("native synthesis execution queue", () => {
  it.each(["context", "thematic"] as const)("retains %s scheduling with fresh fixtures", stage => {
    expect(probe("", stage)).toContain("synthesis-execution-queue-verified");
  }, 90_000);
  it.each(["", "-- Harmless enqueue control"])("retains exact scheduling and refuses unauthorized commands %s", mutation => {
    expect(probe(mutation)).toContain("synthesis-execution-queue-verified");
  }, 90_000);
  it.each(faults)("detects missing %s boundary", (_name, mutation, message) => {
    let failure: unknown;
    try { probe(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect((failure as { stderr?: string }).stderr ?? String(failure)).toContain(message);
  }, 90_000);
});
