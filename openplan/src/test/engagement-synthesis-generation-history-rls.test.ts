import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const migration = readFileSync("supabase/migrations/20261014000036_engagement_synthesis_generation_history.sql", "utf8");
const source = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const requests = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const plans = readFileSync("src/test/fixtures/engagement/synthesis-generation-plans.sql", "utf8").split("-- Clear the staff JWT claim.")[0];
const execution = readFileSync("src/test/fixtures/engagement/synthesis-generation-execution.sql", "utf8").split("SELECT pg_temp.gen_cancel();")[0];
const selections = readFileSync("src/test/fixtures/engagement/synthesis-generation-selections.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-generation-history.sql", "utf8");
const reader = "public.read_engagement_synthesis_generation_selection_history(uuid,uuid,bigint,bigint,integer)";
function change(old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${reader}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing history mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
// Permissions and anchored history run inside an isolated rollback. These checks
// do not prove browser access, source interpretation or provider response truth.
function nativeHistory(mutation = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${process.env.OPENPLAN_SYNTHESIS_HISTORY_CANDIDATE === "1" ? migration : ""}
      ${source}\n${requests}\n${plans}\n${execution}\n${selections}\nRESET ROLE;\n${mutation}\n${fixture}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
const faults = [
  ["current staff authority", change("workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);", "SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;"), "Revoked original requester read history"],
  ["request campaign", change("AND campaign_id=p_campaign", ""), "History ignored campaign scope"],
  ["request scope", change("AND campaign_id=p_campaign AND workspace_id=workspace", ""), "History ignored campaign scope"],
  ["absent request", change("IF saved.id IS NULL THEN", "IF false THEN"), "Absent history request exposed"],
  ["future sequence", change("through_sequence NOT BETWEEN 0 AND sequence", "false"), "Future history sequence accepted"],
  ["task cursor", change("p_after_task_index NOT BETWEEN -1 AND 9007199254740991", "false"), "Invalid history task cursor accepted"],
  ["page bound", change("p_limit NOT BETWEEN 1 AND 128", "false"), "Oversized history page accepted"],
  ["null cursor", change("p_after_task_index IS NULL", "false"), "Null history task cursor accepted"],
  ["null page", change("p_limit IS NULL", "false"), "Null history page accepted"],
  ["selection request", change("WHERE s.request_id=p_request AND", "WHERE true AND"), "Current staff history differs"],
  ["selection sequence scope", change("FROM engagement_synthesis_generation_selections WHERE request_id=p_request;", "FROM engagement_synthesis_generation_selections;"), "Current history sequence differs"],
  ["historical candidates", change("AND s.sequence_no<=through_sequence", ""), "Historical choices changed"],
  ["historical successors", change("AND n.sequence_no<=through_sequence", ""), "Historical choices changed"],
  ["page cursor", change("AND s.task_index>p_after_task_index", ""), "History task cursor changed"],
  ["has more", change("LIMIT p_limit+1", "LIMIT p_limit"), "History pagination lost has-more"],
  ["service privilege", `GRANT EXECUTE ON FUNCTION ${reader} TO service_role;`, "Service impersonated authenticated history reader"],
];
describe.skipIf(!LIVE_RLS)("current staff synthesis generation history", () => {
  it("preserves original choices after cancellation and requester departure", () => {
    expect(nativeHistory()).toContain("synthesis-generation-history-verified");
  });
  it("survives a harmless local variable rename", () => {
    expect(nativeHistory(change("saved", "retained_request_control"))).toContain("synthesis-generation-history-verified");
  });
  it.each(faults)("detects %s", (_name, mutation, expected) => {
    let failure: unknown; try { nativeHistory(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
