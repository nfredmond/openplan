import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261014000033_engagement_synthesis_generation_requests.sql", "utf8");
const sources = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-generation-requests.sql", "utf8");
const create = "public.create_engagement_synthesis_generation_request(uuid,uuid,text)";
const cancel = "public.cancel_engagement_synthesis_generation_request(uuid,uuid,uuid,text)";
const read = "public.read_engagement_synthesis_generation_request(uuid,uuid)";
const scope = "public.lock_synthesis_generation_request_scope(uuid,uuid)";
function change(target: string, old: string, replacement: string) {
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure); IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing request mutation seam'; END IF; EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}

/** Native commands, faults and synthetic data all roll back in a named isolated stack. */
function run(before = "", body = fixture) {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const candidate = process.env.OPENPLAN_SYNTHESIS_GENERATION_CANDIDATE === "1" ? migration : "";
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${candidate}\n${sources}\n${before}\n${body}\nROLLBACK;`,
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000,
  });
}

describe.skipIf(!LIVE_RLS)("native synthesis request custody", () => {
  it.each(["", change(create, "-- Lost acknowledgements", "-- Retained acknowledgement control")])("retains exact requests and cancellation receipts %s", before => {
    expect(run(before)).toContain("synthesis-generation-requests-verified");
  });
  it("preserves pre-existing request and cancellation row counts", () => {
    // Synthetic background rows test accounting, not the semantic request protocol.
    const marker = "CREATE TEMP TABLE generation_probe";
    const background = `INSERT INTO engagement_synthesis_generation_requests(id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text)
      VALUES('f0000000-0000-4000-8000-000000000777','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
        '13466ed2-dcb7-4861-a528-68cc5579eea9','d0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002','{}');
      INSERT INTO engagement_synthesis_generation_cancellations(id,request_id,campaign_id,workspace_id,actor_id,receipt_text)
      VALUES('f0000000-0000-4000-8000-000000000877','f0000000-0000-4000-8000-000000000777','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',
        'd51d566d-28c6-49d2-95d2-3a7a2f0902e1','13466ed2-dcb7-4861-a528-68cc5579eea9','{}');`;
    expect(fixture).toContain(marker);
    expect(run("", fixture.replace(marker, background + "\n" + marker))).toContain("synthesis-generation-requests-verified");
  });
  it.each([
    ["requests", `INSERT INTO engagement_synthesis_generation_requests(id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text)
      SELECT 'f0000000-0000-4000-8000-000000000006',campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text
      FROM engagement_synthesis_generation_requests WHERE id='f0000000-0000-4000-8000-000000000001';`],
    ["cancellations", `INSERT INTO engagement_synthesis_generation_cancellations(id,request_id,campaign_id,workspace_id,actor_id,receipt_text)
      SELECT 'f0000000-0000-4000-8000-000000000106','f0000000-0000-4000-8000-000000000006',campaign_id,workspace_id,actor_id,receipt_text
      FROM engagement_synthesis_generation_cancellations WHERE request_id='f0000000-0000-4000-8000-000000000001';`],
  ])("detects unexpected added %s in a populated stack", (name, injection) => {
    const seam = "SELECT pg_temp.assert_true((SELECT count(*)=";
    expect(fixture).toContain(seam);
    let failure: unknown;
    try { run("", fixture.replace(seam, injection + "\n" + seam)); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(`Refusals or retries added ${name}`);
  });
  it("retains the redundant revision scope check when the connection scope fault survives", () => {
    expect(run(change(create, "AND workspace_id=workspace FOR SHARE NOWAIT", "FOR SHARE NOWAIT"))).toContain("synthesis-generation-requests-verified");
  });
  it.each([
    ["retained source reference", change(create, "auth.uid(),source.id,revision.id,p_intent_text", "auth.uid(),'d0000000-0000-4000-8000-000000000001'::uuid,revision.id,p_intent_text"), "Request retained the wrong source reference"],
    ["retained API revision reference", change(create, "auth.uid(),source.id,revision.id,p_intent_text", "auth.uid(),source.id,'e0000000-0000-4000-8000-000000000004'::uuid,p_intent_text"), "Request retained the wrong API revision reference"],
    ["request actor", change(create, "OR saved.actor_id IS DISTINCT FROM auth.uid()", ""), "Another actor replayed original request"],
    ["intent retry", change(create, "IF saved.intent_text IS DISTINCT FROM p_intent_text THEN", "IF false THEN"), "Changed request intent replayed"],
    ["source hash", change(create, "OR source.snapshot_sha256 IS DISTINCT FROM intent->>'sourceSha256'", ""), "Wrong retained source hash accepted"],
    ["source scope", change(create, "source.campaign_id IS DISTINCT FROM p_campaign OR source.workspace_id IS DISTINCT FROM workspace", "false"), "Foreign retained source accepted"],
    ["connection and revision workspace", change(create, "AND workspace_id=workspace FOR SHARE NOWAIT", "FOR SHARE NOWAIT") + change(create, "AND workspace_id=workspace;", ";"), "Foreign API connection accepted"],
    ["configuration hash", change(create, "OR revision.configuration_hash IS DISTINCT FROM intent->>'configurationHash'", ""), "Wrong API configuration hash accepted"],
    ["model selection", change(create, "OR NOT (revision.configuration->'modelIds' ? (intent->>'modelId'))", ""), "Unconfigured model accepted"],
    ["task byte limit", change(create, "IF (intent->>'taskByteLimit')::numeric NOT BETWEEN", "IF false AND (intent->>'taskByteLimit')::numeric NOT BETWEEN"), "Malformed request intent accepted"],
    ["intent schema", change(create, "OR intent->'schemaVersion' IS DISTINCT FROM '1'::jsonb", ""), "Malformed request intent accepted"],
    ["cancelled late create", change(create, "IF cancelled.id IS NOT NULL THEN", "IF false THEN"), "Late creation bypassed cancellation"],
    ["absent cancellation actor", change(create, "OR cancelled.actor_id IS DISTINCT FROM auth.uid()", ""), "Another actor probed absent cancellation"],
    ["absent cancellation scope", change(create, "cancelled.campaign_id IS DISTINCT FROM p_campaign OR cancelled.workspace_id IS DISTINCT FROM workspace", "false"), "Original actor moved absent cancellation across scope"],
    ["cancel retry actor", change(cancel, "OR cancelled.actor_id IS DISTINCT FROM auth.uid()", ""), "Another actor replayed original cancellation"],
    ["cancel requester", change(cancel, "OR saved.actor_id IS DISTINCT FROM auth.uid()", ""), "Another actor cancelled original request"],
    ["cancel reason", change(cancel, "OR cancelled.receipt_text::jsonb->>'reason' IS DISTINCT FROM p_reason", ""), "Changed cancellation reason replayed"],
    ["cancel identity", change(cancel, "cancelled.id IS DISTINCT FROM p_cancellation OR", ""), "Second cancellation replaced original"],
    ["cancel validation", change(cancel, "OR p_reason !~ '[^[:space:]]'", ""), "Blank cancellation reason accepted"],
    ["cancel existed", change(cancel, "'requestExisted',saved.id IS NOT NULL", "'requestExisted',true"), "Absent request cancellation was not retained"],
    ["viewer", change(scope, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Revoked staff read private request"],
    ["read campaign", change(read, "AND campaign_id=p_campaign AND workspace_id=workspace", ""), "Read ignored requested campaign"],
    ["stale revision", change(create, "OR connection.current_revision_id IS DISTINCT FROM (intent->>'configurationRevisionId')::uuid", "") + change(create, "id=connection.current_revision_id", "id=(intent->>'configurationRevisionId')::uuid"), "Stale configuration accepted"],
    ["revoked connection", change(create, "OR connection.revoked_at IS NOT NULL", ""), "Revoked configuration accepted"],
    ["request table read", "GRANT SELECT ON engagement_synthesis_generation_requests TO authenticated; CREATE POLICY synthetic_read ON engagement_synthesis_generation_requests FOR SELECT TO authenticated USING(true);", "Direct private request read allowed"],
    ["cancel table read", "GRANT SELECT ON engagement_synthesis_generation_cancellations TO authenticated; CREATE POLICY synthetic_read ON engagement_synthesis_generation_cancellations FOR SELECT TO authenticated USING(true);", "Direct private cancellation read allowed"],
    ["request immutable", "ALTER TABLE engagement_synthesis_generation_requests DISABLE TRIGGER synthesis_generation_request_immutable;", "Original request mutation allowed"],
    ["cancel immutable", "ALTER TABLE engagement_synthesis_generation_cancellations DISABLE TRIGGER synthesis_generation_cancellation_immutable;", "Original cancellation mutation allowed"],
    ["anonymous read", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous private read allowed"],
    ["anonymous create", `GRANT EXECUTE ON FUNCTION ${create} TO anon;`, "Anonymous request creation allowed"],
    ["anonymous cancel", `GRANT EXECUTE ON FUNCTION ${cancel} TO anon;`, "Anonymous cancellation allowed"],
    ["service create", `GRANT EXECUTE ON FUNCTION ${create} TO service_role;`, "Service impersonated staff request"],
    ["service cancel", `GRANT EXECUTE ON FUNCTION ${cancel} TO service_role;`, "Service impersonated cancellation"],
    ["private lock helper", `GRANT EXECUTE ON FUNCTION ${scope} TO authenticated;`, "Private lock helper exposed"],
  ])("detects %s", (_label, mutation, expected) => {
    let failure: unknown;
    try { run(mutation); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});

// The independent holder has no fixture rows or changed functions. Its live
// advisory lock proves that competing callers actually take the shared fence.
async function withRequestLock(requestId: string, check: () => void) {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", error = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { error += data; });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  void done.catch(() => {});
  try {
    child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('synthesis-generation-request:${requestId}',0)); SELECT 'REQUEST_LOCK_READY';\n`);
    await vi.waitFor(() => {
      expect(child.exitCode, error).toBeNull();
      expect(output, error).toContain("REQUEST_LOCK_READY");
    }, { timeout: 8_000, interval: 25 });
    check();
    expect(child.exitCode, "Lock holder ended before competing commands returned").toBeNull();
  } finally {
    if (child.exitCode === null && !child.stdin.destroyed) child.stdin.end("ROLLBACK;\n");
    expect(await done, error).toBe(0);
  }
}
const lockFixture = fixture.split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0] + `
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.gen_create()','PT503','Concurrent creation ignored the request fence');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_cancel()','PT503','Concurrent cancellation ignored the request fence');
SELECT pg_temp.expect_error('SELECT pg_temp.gen_read()','PT503','Concurrent read ignored the request fence');
SELECT pg_temp.gen_create('f0000000-0000-4000-8000-000000000002');
SELECT 'request-fence-verified';
`;
describe.skipIf(!LIVE_RLS)("synthesis request serialization", () => {
  it("permits unrelated requests while a request lock is held", async () => {
    await withRequestLock("f0000000-0000-4000-8000-000000000999", () => {
      expect(run()).toContain("synthesis-generation-requests-verified");
    });
  });
  it("fences creation, cancellation and reads on the same request", async () => {
    await withRequestLock("f0000000-0000-4000-8000-000000000001", () => {
      expect(run("", lockFixture)).toContain("request-fence-verified");
    });
  });
  it("detects a removed request fence", async () => {
    await withRequestLock("f0000000-0000-4000-8000-000000000001", () => {
      let failure: unknown;
      try { run(change(scope, "IF NOT pg_try_advisory_xact_lock", "IF false AND NOT pg_try_advisory_xact_lock"), lockFixture); } catch (error) { failure = error; }
      expect(failure).toBeDefined();
      expect(String((failure as { stderr?: unknown }).stderr)).toContain("Concurrent creation ignored the request fence");
    });
  });
});
