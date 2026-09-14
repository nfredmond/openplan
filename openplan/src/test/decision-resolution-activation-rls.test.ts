import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const signature = "public.resolve_engagement_decision_request(uuid,uuid,uuid,text,text)";
const fixture = readFileSync("src/test/fixtures/engagement/decision-resolution-activation.sql", "utf8");

/** Each probe rolls back its synthetic records and deliberate privilege changes. */
function run(before = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n${before}\n${fixture}\nROLLBACK;`, timeout: 45_000,
  }).trim().split("\n").at(-1);
}

describe.skipIf(!LIVE_RLS)("installed private decision recovery", () => {
  it.each(["", "-- Harmless installed recovery comment."])("keeps original recovery copies and native outcomes %s", before => {
    expect(run(before)).toBe("decision-resolution-activation-verified");
  });
  it.each([
    ["lost original read", "ALTER POLICY engagement_decision_resolution_owner ON public.engagement_decision_request_resolutions USING (false);", "Installed original requester cannot read recovery copies"],
    ["other staff exposure", "ALTER POLICY engagement_decision_resolution_owner ON public.engagement_decision_request_resolutions USING (true);", "Other staff read private recovery copies"],
    ["anonymous command grant", `GRANT EXECUTE ON FUNCTION ${signature} TO anon;`, "anon executed recovery"],
    ["service command grant", `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`, "service_role executed recovery"],
    ["direct staff update", "GRANT UPDATE ON public.engagement_decision_request_resolutions TO authenticated;", "Staff updated immutable recovery"],
    ["lost immutability", "ALTER TABLE public.engagement_decision_request_resolutions DISABLE TRIGGER engagement_decision_resolution_immutable;", "Privileged update destroyed recovery"],
  ])("detects %s through actual native behavior", (_name, fault, expected) => {
    let failure: unknown;
    try { run(fault); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
