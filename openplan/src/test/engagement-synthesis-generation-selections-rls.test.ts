import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const migration = readFileSync("supabase/migrations/20261014000035_engagement_synthesis_generation_execution.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const plans = readFileSync("src/test/fixtures/engagement/synthesis-generation-plans.sql", "utf8").split("-- Clear the staff JWT claim.")[0];
const execution = readFileSync("src/test/fixtures/engagement/synthesis-generation-execution.sql", "utf8").split("SELECT pg_temp.gen_cancel();")[0];
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-generation-selections.sql", "utf8");
const status = "public.read_engagement_synthesis_generation_execution_status(uuid,uuid)";
const choose = "public.select_engagement_synthesis_generation_attempt(uuid,bigint,uuid,uuid,uuid,text)";
const read = "public.read_engagement_synthesis_generation_selections(uuid,bigint,bigint,integer)";
function change(target: string, old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing selection mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}

// Native records and independent guards are exercised inside a rollback. This
// does not prove a polling worker stops a network call or that a selected result
// is semantically valid. The downstream verifier retains those responsibilities.
function nativeSelections(mutation = "", keyed = false) {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const setup = keyed ? requests.replace('"authMode":"none"', '"authMode":"api_key"')
    .replace('"timeoutSeconds":10}\',NULL);', '"timeoutSeconds":10}\',\'v2:SYNTHETIC original key\');') : requests;
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_EXECUTION_CANDIDATE === "1" ? migration : ""}
      ${source}\n${setup}\n${plans}\n${execution}\nRESET ROLE;\n${mutation}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["status worker", change(status, "OR attempt.worker_id IS DISTINCT FROM p_worker", ""), "Status ignored worker identity"],
  ["returned status", change(status, "AND output_hash IS NULL", ""), "Returned dispatch continued"],
  ["dispatch presence", change(status, "dispatch.attempt_id IS NOT NULL AND", ""), "Undispatched claim continued"],
  ["dispatch expiry", change(status, "dispatch.expires_at>clock_timestamp()", "true"), "Expired dispatch continued"],
  ["grant expiry", change(status, "(grant_row.intent_text::jsonb->>'expiresAt')::timestamptz>clock_timestamp()", "true"), "Expired grant continued"],
  ["current execution authority", change(status, "credential_hash:=assert_synthesis_generation_execution_current(attempt.request_id);", "credential_hash:=NULL;"), "Changed credential continued"],
  ["selection actor", change(choose, "auth.uid() IS DISTINCT FROM request.actor_id", "false"), "Another actor changed result selection"],
  ["selection exact reason", change(choose, "OR saved.receipt_text::jsonb->>'reason' IS DISTINCT FROM p_reason", ""), "Changed selection replayed"],
  ["selection expected predecessor", change(choose, "head.id IS DISTINCT FROM p_expected_previous", "false"), "Stale selection replaced current choice"],
  ["selection task binding", change(choose, "AND a.task_index=p_task_index", ""), "Another task output selected"],
  ["selection reason content", change(choose, "OR p_reason !~ '[^[:space:]]'", ""), "Blank selection reason accepted"],
  ["selection reason length", change(choose, "length(p_reason) NOT BETWEEN 1 AND 4000", "false"), "Oversized selection reason accepted"],
  ["selection page size", change(read, "p_limit NOT BETWEEN 1 AND 128", "false"), "Oversized selection page accepted"],
  ["selection revision bound", change(read, "through_sequence NOT BETWEEN 0 AND sequence", "false"), "Future selection cursor accepted"],
  ["selection task cursor bound", change(read, "p_after_task_index NOT BETWEEN -1 AND 9007199254740991", "false"), "Invalid selection task cursor accepted"],
  ["selection request scope", change(read, "WHERE s.request_id=p_request AND", "WHERE true AND"), "Other request choice or pre-claim clear was lost"],
  ["selection sequence scope", change(read, "FROM engagement_synthesis_generation_selections WHERE request_id=p_request;", "FROM engagement_synthesis_generation_selections;"), "Another request changed selection sequence"],
  ["selection page cursor", change(read, "AND s.task_index>p_after_task_index", ""), "Anchored second page lost its original choice"],
  ["selection has-more control", change(read, "LIMIT p_limit+1", "LIMIT p_limit"), "First selection page differs"],
  ["selection historical candidates", change(read, "AND s.sequence_no<=through_sequence", ""), "Later selections rewrote an anchored snapshot"],
  ["selection historical successors", change(read, "AND n.sequence_no<=through_sequence", ""), "Later selections rewrote an anchored snapshot"],
  ["selection history immutability", "ALTER TABLE engagement_synthesis_generation_selections DISABLE TRIGGER synthesis_generation_selection_immutable;", "Selection history deletion allowed"],
  ["worker staff-choice privilege", `GRANT EXECUTE ON FUNCTION ${choose} TO service_role;`, "Worker changed staff choice"],
  ["authenticated selection read", `GRANT EXECUTE ON FUNCTION ${read} TO authenticated;`, "Authenticated selection inventory exposed"],
  ["authenticated status read", `GRANT EXECUTE ON FUNCTION ${status} TO authenticated;`, "Authenticated execution status exposed"],
  ["private selection table", "GRANT SELECT ON engagement_synthesis_generation_selections TO authenticated; CREATE POLICY synthetic_selection_read ON engagement_synthesis_generation_selections FOR SELECT TO authenticated USING(true);", "Private selection history exposed"],
];
describe.skipIf(!LIVE_RLS)("native synthesis status and result selections", () => {
  it("retains explicit choices, stable pagination and current execution status", () => {
    expect(nativeSelections()).toContain("synthesis-generation-selection-custody-verified");
  });
  it("survives a harmless function variable rename", () => {
    expect(nativeSelections(change(status, "output_hash", "output_hash_control"))).toContain("synthesis-generation-selection-custody-verified");
  });
  it("preserves status observation for the original keyed revision", () => {
    expect(nativeSelections("", true)).toContain("synthesis-generation-selection-custody-verified");
  });
  it("detects status continuing after a credential replacement", () => {
    let failure: unknown;
    try { nativeSelections(change(status, "credential_hash IS DISTINCT FROM grant_row.credential_sha256", "false"), true); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain("Changed credential continued");
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown;
    try { nativeSelections(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
