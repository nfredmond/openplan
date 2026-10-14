// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const fixture = readFileSync("src/test/fixtures/modeling/historical-run-decisions.sql", "utf8");
const decisionSignature = "public.record_historical_model_run_decision(uuid,uuid,uuid,uuid,jsonb,text,text)";
// Native role/JWT-sub probes establish the keep-or-close command boundary, not
// browser behavior, worker shutdown or the scientific validity of saved outputs.
function probe(mutation = "") {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${fixture.replace("-- MUTATION SEAM", mutation)}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000,
  });
}
(LIVE_RLS ? describe : describe.skip)("historical model run keep-or-close decisions", () => {
  it("records owner and admin decisions with actor and reason, keeps runs and outputs unchanged and readable, and allows a fresh run", () => {
    expect(() => probe()).not.toThrow();
  });
  it("survives a harmless function comment", () => {
    expect(() => probe(`COMMENT ON FUNCTION ${decisionSignature} IS 'Harmless probe';`)).not.toThrow();
  });
  it.each([
    [`GRANT EXECUTE ON FUNCTION ${decisionSignature} TO authenticated;`, "decision executable by authenticated"],
    ["GRANT SELECT ON public.model_run_recovery_receipts TO authenticated;", "receipt exposed"],
    ["UPDATE public.workspace_members SET role='admin' WHERE workspace_id=(SELECT workspace FROM decision_probe) AND user_id=(SELECT viewer_id FROM decision_probe);", "viewer decision accepted"],
    ["UPDATE decision_probe SET owner_id=viewer_id;", "Model recovery requires an owner or administrator"],
    ["ALTER TABLE public.model_run_recovery_receipts DISABLE TRIGGER refuse_model_recovery_receipt_mutation;", "receipt mutable"],
    ["ALTER TABLE public.model_run_stages DISABLE TRIGGER guard_historical_model_execution; ALTER TABLE public.model_runs DISABLE TRIGGER guard_historical_model_execution;", "historical abandonment accepted"],
  ])("detects %s", (mutation, reason) => {
    expect(() => probe(mutation)).toThrow(reason);
  });
});
