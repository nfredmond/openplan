import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const fixture = (name: string) => readFileSync(`src/test/fixtures/engagement/${name}.sql`, "utf8");
const setup = [fixture("synthesis-source-custody"),
  fixture("synthesis-generation-requests").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0],
  fixture("synthesis-context-requests").split("SELECT pg_temp.assert_true((SELECT value#>>'{request,actorId}'")[0],
  fixture("synthesis-context-plans").split("-- Current staff commands")[0],
  fixture("synthesis-context-execution").replace("'SYNTHETIC new staff choice'", "repeat('😀',4000)")].join("\n");
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const reader = "public.read_engagement_synthesis_generation_selection_history(uuid,uuid,bigint,bigint,integer)";
function change(old: string, replacement: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${reader}'::regprocedure);
    IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing context history mutation seam'; END IF;
    EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}

// All records and function mutations roll back on the explicitly isolated stack.
// This covers native access and historical choices, not application replay or UI.
function probe(mutation = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${setup}\nRESET ROLE;\n${mutation}\n${fixture("synthesis-context-history")}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
}
describe.skipIf(!LIVE_RLS)("native historical context access", () => {
  it("retains anchored context choices after cancellation and requester departure", () => {
    expect(probe()).toContain("synthesis-context-history-verified");
  });
  it("survives a harmless local variable rename", () => {
    expect(probe(change("saved", "retained_context_control"))).toContain("synthesis-context-history-verified");
  });
  it.each([
    ["current staff", change("workspace:=lock_synthesis_generation_request_scope(p_campaign,p_request);", "SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;"), "Revoked context reader kept history access"],
    ["anchored successors", change("AND n.sequence_no<=through_sequence", ""), "Context historical selection changed"],
    ["task cursor", change("AND s.task_index>p_after_task_index", ""), "Context history task cursor changed"],
    ["page continuation", change("LIMIT p_limit+1", "LIMIT p_limit"), "Context history page lost continuation"],
    ["original Unicode reason", change("s.receipt_text", "(s.receipt_text::jsonb || jsonb_build_object('reason','SYNTHETIC trimmed'))::text"), "Context history changed Unicode reason"],
  ])("detects broken %s", (_name, mutation, message) => {
    let failure: unknown; try { probe(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(String((failure as { stderr?: unknown }).stderr)).toContain(message);
  });
});
