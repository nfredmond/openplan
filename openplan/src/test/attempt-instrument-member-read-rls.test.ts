// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const fixture = readFileSync("src/test/fixtures/modeling/attempt-instrument-member-read.sql", "utf8");
// Native role/JWT-sub probes establish database isolation, not Auth issuance,
// REST pagination, browser downloads or scientific content validity.
function probe(mutation = "") {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${fixture.replace("-- MUTATION SEAM", mutation)}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000,
  });
}
(LIVE_RLS ? describe : describe.skip)("attempt instrument member access", () => {
  it("preserves both methods for current members and denies outsiders, removed members, hidden parents and direct writes", () => {
    expect(() => probe()).not.toThrow();
  });
  it("survives a harmless policy comment", () => {
    expect(() => probe("COMMENT ON POLICY model_attempt_instrument_member_read ON public.model_attempt_instrument_custody IS 'Harmless probe';")).not.toThrow();
  });
  it.each([
    ["USING (true)", "outsider rows exposed"],
    ["USING (false)", "member records missing"],
    ["USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=model_attempt_instrument_custody.workspace_id AND m.user_id=auth.uid()))", "hidden parent rows exposed"],
  ])("detects a broken policy %s", (definition, reason) => {
    expect(() => probe(`ALTER POLICY model_attempt_instrument_member_read ON public.model_attempt_instrument_custody ${definition};`)).toThrow(reason);
  });
  it.each([
    ["GRANT INSERT ON public.model_attempt_instrument_custody TO authenticated;", "direct write exposed"],
    ["GRANT SELECT ON public.model_attempt_instrument_receipts TO authenticated;", "receipt exposed"],
  ])("detects a broken grant %s", (mutation, reason) => {
    expect(() => probe(mutation)).toThrow(reason);
  });
});
