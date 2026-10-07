import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000012_engagement_synthesis_preparation_queue.sql", "utf8");
const recoveryMigration = readFileSync("supabase/migrations/20261015000014_engagement_synthesis_preparation_recovery.sql", "utf8");
const sources = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8")
  .split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const plans = readFileSync("src/test/fixtures/engagement/synthesis-generation-plans.sql", "utf8")
  .split("-- Clear the staff JWT claim.")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-preparation-queue.sql", "utf8");
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef(${literal("public." + target)}::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing preparation mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
const enqueue = "enqueue_engagement_synthesis_preparation(uuid,uuid,text,text)";
const retry = "retry_engagement_synthesis_preparation(uuid,uuid,bigint)";
const claim = "claim_engagement_synthesis_preparation(uuid,uuid)";
const renew = "renew_engagement_synthesis_preparation(uuid,uuid)";
const finish = "finish_engagement_synthesis_preparation(uuid,uuid,text,text)";
const cancelled = "EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request)";
const faults = [
  ["read scope", change("read_engagement_synthesis_preparation(uuid,uuid)", "IF NOT EXISTS", "IF false AND NOT EXISTS"), "Authorized campaign leaked another campaign request"],
  ["enqueue actor", change(enqueue, "saved.actor_id IS DISTINCT FROM auth.uid()", "false"), "Other staff enqueued original request"],
  ["enqueue stage", change(enqueue, "p_stage IS DISTINCT FROM actual_stage", "false"), "Wrong stage was queued"],
  ["enqueue intent", change(enqueue, "p_intent_sha256 IS DISTINCT FROM saved.intent_sha256", "false"), "Wrong intent hash was queued"],
  ["enqueue cancellation", change(enqueue, cancelled, "false"), "Cancelled request was newly queued"],
  ["retry actor", change(retry, "AND actor_id=auth.uid()", ""), "Other staff retried original request"],
  ["retry null attempt", change(retry, "OR p_attempt IS NULL", ""), "Null retry bound accepted"],
  ["retry future attempt", change(retry, "OR p_attempt>saved.attempts", ""), "Future retry bound accepted"],
  ["retry negative attempt", change(retry, "OR p_attempt<0", ""), "Negative retry bound accepted"],
  ["retry cancellation", change(retry, cancelled, "false"), "Cancelled failed job was retried"],
  ["retry old attempt", change(retry, "AND saved.attempts=p_attempt", ""), "Old retry requeued later failure"],
  ["worker staff role", change("lock_synthesis_preparation_worker_scope(uuid)", "AND role IN ('owner','admin','member')", ""), "Revoked requester started preparation"],
  ["revoked queue progress", change(claim, "SET status='failed',failure_code='access_unavailable',lease_until=NULL,updated_at=clock_timestamp()", "SET updated_at=clock_timestamp()"), "Inaccessible request still blocks queue"],
  ["claim token binding", change(claim, "attempt.request_id IS DISTINCT FROM p_request", "false"), "Token rebound to another request"],
  ["claim expiry replay", change(claim, "AND job.lease_until>clock_timestamp()", ""), "Expired claim replay reopened authority"],
  ["claim current token", change(claim, "AND job.lease_token=p_token", ""), "Old token replaced current lease"],
  ["claim cancellation replay", change(claim, "AND NOT " + cancelled, ""), "Cancelled claim stayed active"],
  ["claim cancellation pickup", change(claim, "IF " + cancelled + " THEN", "IF false THEN"), "Cancelled work was reclaimed"],
  ["renew expiry", change(renew, "AND lease_until>clock_timestamp()", ""), "Expired lease renewed"],
  ["renew token", change(renew, "AND lease_token=p_token", ""), "Foreign token renewed attempt"],
  ["renew cancellation", change(renew, cancelled, "false"), "Cancelled lease renewed"],
  ["finish token", change(finish, "OR job.lease_token IS DISTINCT FROM p_token", ""), "Foreign token finished attempt"],
  ["finish exclusive outcome", change(finish, "(p_seal_sha256 IS NULL)=(p_failure_code IS NULL)", "false"), "Conflicting outcome was accepted"],
  ["finish private failure", change(finish, "(p_failure_code IS NOT NULL AND p_failure_code NOT IN ('input_unavailable','preparation_failed'))", "false"), "Arbitrary failure text was saved"],
  ["finish replay failure", change(finish, "OR job.failure_code IS DISTINCT FROM p_failure_code", ""), "Changed outcome replayed"],
  ["finish replay seal", change(finish, "job.seal_sha256 IS DISTINCT FROM p_seal_sha256", "false"), "Different completed seal replayed"],
  ["retained failure after expiry", change(finish, "IF job.status<>'running' THEN", "IF job.status<>'running' OR (p_failure_code IS NOT NULL AND job.lease_until<=clock_timestamp()) THEN"), "Preparation lease is not active"],
  ["retained seal after expiry", change(finish, "IF job.status<>'running' THEN", "IF job.status<>'running' OR (p_seal_sha256 IS NOT NULL AND job.lease_until<=clock_timestamp()) THEN"), "Preparation lease is not active"],
  ["finish running state", change(finish, "job.status<>'running'", "false"), "Queued job accepted an old completion"],
  ["finish cancellation", change(finish, cancelled, "false"), "Cancelled worker finished"],
  ["finish seal", change(finish, "p_seal_sha256 IS NOT NULL AND NOT EXISTS", "false AND NOT EXISTS"), "Missing seal was accepted"],
  ["finish source seal", change(finish, "WHERE request_id=p_request AND receipt_sha256=p_seal_sha256", "WHERE receipt_sha256=p_seal_sha256"), "Other request seal was accepted"],
  ["claim history immutability", "ALTER TABLE engagement_synthesis_preparation_attempts DISABLE TRIGGER synthesis_preparation_attempt_immutable;", "Claim history was mutable"],
] as const;

/** Native fixtures and faults roll back. SQL custody does not prove queue pickup,
 * HTTP recovery, browser status, heartbeat timing or interpretation quality.
 */
function exercise(before = "") {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_PREPARATION_CANDIDATE === "1" ? migration + recoveryMigration : ""}
      ${sources}\n${requests}\n${plans}\n${before}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
  });
}

describe.skipIf(!LIVE_RLS)("native synthesis preparation queue", () => {
  it.each(["", "-- Harmless preparation queue control"])("retains explicit preparation, attempts and recovery %s", before => {
    expect(exercise(before)).toContain("synthesis-preparation-queue-verified");
  }, 60_000);
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown;
    try { exercise(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    const stderr = (failure as { stderr?: string }).stderr ?? String(failure);
    expect(stderr).toContain(expected);
    expect(stderr).not.toContain("Missing preparation mutation seam");
  }, 60_000);
});
