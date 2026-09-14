import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const signature = "public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)";
const fixture = readFileSync("src/test/fixtures/engagement/decision-link-activation.sql", "utf8");

/** Each invocation rolls back synthetic records and any deliberate privilege fault. */
function run(before = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n${before}\n${fixture}\nROLLBACK;`, timeout: 45_000,
  }).trim().split("\n").at(-1);
}

describe.skipIf(!LIVE_RLS)("installed engagement decision links", () => {
  it.each(["", "-- Harmless activation comment."])("keeps exact private lifecycle and access under installed grants %s", before => {
    expect(run(before)).toBe("decision-link-activation-verified");
  });
  it.each([
    ["lost staff read", "ALTER POLICY engagement_response_decision_link_staff_read ON public.engagement_response_decision_links USING (false);", "Installed staff history is not readable"],
    ["viewer history exposure", "ALTER POLICY engagement_response_decision_link_staff_read ON public.engagement_response_decision_links USING (true);", "Viewer read leaked history"],
    ["anonymous command grant", `GRANT EXECUTE ON FUNCTION ${signature} TO anon;`, "anon installed command was not refused"],
    ["service command grant", `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`, "service_role installed command was not refused"],
    ["direct staff update", "GRANT UPDATE ON public.engagement_response_decision_links TO authenticated;", "Direct staff update was not refused"],
  ])("detects %s through the actual fixture", (_name, fault, expected) => {
    let failure: unknown;
    try { run(fault); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
