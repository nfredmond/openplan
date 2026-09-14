import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const signature = "public.queue_engagement_report(uuid,uuid,text,jsonb)";
const lifecycle = readFileSync("src/test/fixtures/engagement/decision-link-activation.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/engagement/report-history-activation.sql", "utf8");

/** Changes only the installed function inside the probe transaction; refuses a missing fault seam. */
function changeQueue(old: string, replacement: string) {
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${signature}'::regprocedure); IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing queue mutation seam'; END IF; EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}

/** Synthetic records and deliberate permission/function faults always roll back on this named test stack. */
function run(before = "") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n${before}\n${lifecycle}\n${fixture}\nROLLBACK;`, timeout: 45_000,
  }).trim().split("\n").at(-1);
}

describe.skipIf(!LIVE_RLS)("installed engagement report history", () => {
  it.each(["", "-- Harmless installed archive comment."])("retains history, old retries and private access %s", before => {
    expect(run(before)).toBe("report-history-activation-verified");
  });
  it.each([
    ["missing history", changeQueue("d.campaign_id=p_campaign AND d.workspace_id=c.workspace_id", "false"), "Installed queue lost complete private history"],
    ["public history exposure", changeQueue("CASE WHEN p_scope='internal' THEN jsonb_build_object(", "CASE WHEN true THEN jsonb_build_object("), "Installed public queue exposed private history"],
    ["lost exact payload", changeQueue("jsonb_build_object('payload_text',d.payload_json::text)", "'{}'::jsonb"), "Installed queue changed exact history bytes"],
    ["one missing exact payload", changeQueue("jsonb_build_object('payload_text',d.payload_json::text)", "jsonb_build_object('payload_text',CASE WHEN d.operation='link' THEN NULL ELSE d.payload_json::text END)"), "Installed queue changed exact history bytes"],
    ["lost format permission", "REVOKE SELECT(snapshot_format) ON public.engagement_report_jobs FROM authenticated;", "permission denied for table engagement_report_jobs"],
    ["raw snapshot exposure", "GRANT SELECT(snapshot_text) ON public.engagement_report_jobs TO authenticated;", "Staff raw archive access was not refused"],
    ["viewer private access", "ALTER POLICY engagement_export_read ON public.engagement_report_jobs USING (true);", "Viewer read private report history"],
    ["anonymous queue grant", `GRANT EXECUTE ON FUNCTION ${signature} TO anon;`, "Anonymous queue execution was not refused"],
  ])("detects %s through the installed database", (_name, fault, expected) => {
    let failure: unknown;
    try { run(fault); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
