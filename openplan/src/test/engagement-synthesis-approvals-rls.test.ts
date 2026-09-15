import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";
import { readSynthesisApprovalHistory, readSynthesisApprovalReceipt, synthesisApprovalForRevision, type SynthesisApprovalContext, type SynthesisApprovalIntent } from "@/lib/engagement/synthesis-approval";

const sourceFixture = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
const fixture = readFileSync("src/test/fixtures/engagement/synthesis-approval-custody.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261014000028_engagement_synthesis_approvals.sql", "utf8");
const retain = "public.retain_engagement_synthesis_approval(uuid,uuid,uuid,jsonb)";
const read = "public.read_engagement_synthesis_approval(uuid,uuid)";
const history = "public.read_engagement_synthesis_approval_history(uuid,uuid)";
function change(signature: string, before: string, after: string) {
  const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${signature}'::regprocedure); IF position(${literal(before)} IN body)=0 THEN RAISE EXCEPTION 'Missing approval mutation seam'; END IF; EXECUTE replace(body,${literal(before)},${literal(after)}); END $fault$;`;
}

/** Candidate schema, fixtures and deliberate SQL faults are all rolled back on the named disposable stack. */
function run(fault = "", databaseUser: "postgres" | "supabase_admin" = "postgres") {
  const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
  const candidate = process.env.OPENPLAN_SYNTHESIS_APPROVAL_CANDIDATE === "1" ? migration : "";
  const lines = execFileSync("docker", ["exec", "-i", container, "psql", "-w", "-U", databaseUser, "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
    input: `BEGIN; SET LOCAL statement_timeout='35s'; SET LOCAL lock_timeout='2s';\n${candidate}\n${fault}\n${sourceFixture}\n${fixture}\nROLLBACK;`,
  }).trim().split("\n");
  return { marker: lines.at(-1), packet: JSON.parse(lines.at(-2) ?? "null") as {
    history: unknown; current: SynthesisApprovalContext; original: SynthesisApprovalContext; first: unknown; intent: SynthesisApprovalIntent;
  } };
}
function refuses(fault: string, expected: string, administrator = false) {
  let failure: unknown;
  try { run(fault, administrator ? "supabase_admin" : "postgres"); } catch (error) { failure = error; }
  expect(failure).toBeDefined();
  expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
}

describe.skipIf(!LIVE_RLS)("native exact synthesis approval custody", () => {
  it.each(["", "-- Harmless approval transaction control.", "-- Harmless administrator constraint control."])("retains approvals, corrections and withdrawals with exact private history %s", async control => {
    const result = run(control, control.includes("administrator") ? "supabase_admin" : "postgres");
    expect(result.marker).toBe("synthesis-approval-custody-verified");
    const { current, original } = result.packet;
    const scope = { campaignId: "10c5cdd7-16c6-4b91-b9c0-d2f67598a54f", workspaceId: "d51d566d-28c6-49d2-95d2-3a7a2f0902e1",
      reviewId: "e2000000-0000-4000-8000-000000000001", sourceId: "d0000000-0000-4000-8000-000000000002",
      sourceSha256: current.sourceSha256, preparationSha256: current.preparationSha256 };
    const saved = await readSynthesisApprovalHistory(result.packet.history, scope);
    expect(saved.entries).toHaveLength(3);
    expect(synthesisApprovalForRevision(saved, current).state).toBe("approved");
    expect(synthesisApprovalForRevision(saved, original).state).toBe("withdrawn");
    expect((await readSynthesisApprovalReceipt(result.packet.first, result.packet.intent)).event.intent.actorId).toBe("13466ed2-dcb7-4861-a528-68cc5579eea9");
    await expect(readSynthesisApprovalHistory(result.packet.history, { ...scope, sourceSha256: "0".repeat(64) })).rejects.toThrow("scope differs");
  });
  it.each([
    ["direct table read", "GRANT SELECT ON engagement_synthesis_approval_events TO authenticated; CREATE POLICY synthetic_approval_read ON engagement_synthesis_approval_events FOR SELECT TO authenticated USING(true);", "Direct private approval table read was allowed"],
    ["direct authenticated write", `GRANT EXECUTE ON FUNCTION ${retain} TO authenticated;`, "Authenticated user directly wrote an approval"],
    ["private packet helper", "GRANT EXECUTE ON FUNCTION public.engagement_synthesis_approval_packet(uuid) TO authenticated;", "Private approval packet helper was callable"],
    ["changed retry", change(retain, "OR saved.intent_json IS DISTINCT FROM p_intent", ""), "Changed approval retry was accepted"],
    ["other retry actor", change(retain, "saved.actor_id IS DISTINCT FROM p_actor OR", "") + change(retain, "saved.intent_json IS DISTINCT FROM p_intent", "(saved.intent_json-'actorId') IS DISTINCT FROM (p_intent-'actorId')"), "Another actor reused approval request"],
    ["wrong source identifier", change(retain, "root.source_id::text IS DISTINCT FROM p_intent->>'sourceId'", "false"), "Wrong approval source identifier was accepted"],
    ["wrong source checksum", change(retain, "root.source_sha256 IS DISTINCT FROM p_intent->>'sourceSha256'", "false"), "Wrong approval source checksum was accepted"],
    ["wrong preparation checksum", change(retain, "root.preparation_sha256 IS DISTINCT FROM p_intent->>'preparationSha256'", "false"), "Wrong approval preparation checksum was accepted"],
    ["wrong revision checksum", change(retain, "target.content_sha256 IS DISTINCT FROM p_intent->>'revisionSha256'", "false"), "Wrong approval revision checksum was accepted"],
    ["wrong revision number", change(retain, "target.revision_no::text IS DISTINCT FROM p_intent->>'revisionNo'", "false"), "Wrong approval revision number was accepted"],
    ["wrong predecessor identifier", change(retain, "previous.id::text IS DISTINCT FROM p_intent->>'predecessorId'", "false"), "Wrong approval predecessor identifier was accepted"],
    ["wrong predecessor checksum", change(retain, "previous.event_sha256 IS DISTINCT FROM p_intent->>'predecessorSha256'", "false"), "Wrong approval predecessor checksum was accepted"],
    ["duplicate approval", change(retain, "previous.operation='approve' AND previous.revision_id=revision", "false"), "Already approved version was approved again"],
    ["approval after correction", change(retain, "current_revision IS DISTINCT FROM revision", "false"), "A corrected review accepted approval of original"],
    ["wrong withdrawal version", change(retain, "OR previous.revision_id IS DISTINCT FROM revision", ""), "Withdrawal named the wrong approved revision"],
    ["duplicate withdrawal", change(retain, "OR previous.operation<>'approve'", ""), "Already withdrawn approval was withdrawn again"],
    ["blank reason", change(retain, "(p_intent->>'reason') !~ U&'[^[:space:]\\FEFF]'", "false"), "Empty approval reason was accepted"],
    ["Unicode blank reason", change(retain, "U&'[^[:space:]\\FEFF]'", "'[^[:space:]]'"), "Unicode blank approval reason was accepted"],
    ["overlong reason", change(retain, "length(p_intent->>'reason')>2000", "false"), "Overlong approval reason was accepted"],
    ["mutable approval", "ALTER TABLE engagement_synthesis_approval_events DISABLE TRIGGER engagement_synthesis_approval_events_immutable;", "Approval event was mutable"],
    ["predecessor checksum constraint", `DO $fault$ DECLARE row record; BEGIN
      FOR row IN SELECT t.tgname FROM pg_trigger t JOIN pg_constraint c ON c.oid=t.tgconstraint
        WHERE c.conname='engagement_synthesis_approval_predecessor' AND t.tgisinternal LOOP
        EXECUTE format('ALTER TABLE public.engagement_synthesis_approval_events DISABLE TRIGGER %I',row.tgname);
      END LOOP; END $fault$;`, "Approval predecessor checksum constraint was bypassed"],
    ["revoked writer", change(retain, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Revoked staff replayed approval"],
    ["viewer event", change(read, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Viewer read private approval"],
    ["viewer history", change(history, "('owner','admin','member')", "('owner','admin','member','viewer')"), "Viewer read private approval history"],
    ["anonymous event", `GRANT EXECUTE ON FUNCTION ${read} TO anon;`, "Anonymous approval read was allowed"],
    ["anonymous history", `GRANT EXECUTE ON FUNCTION ${history} TO anon;`, "Anonymous approval history was allowed"],
    ["anonymous write", `GRANT EXECUTE ON FUNCTION ${retain} TO anon;`, "Anonymous approval write was allowed"],
    ["missing history tail", change(history, "FROM engagement_synthesis_approval_events WHERE review_id=p_review)", "FROM engagement_synthesis_approval_events WHERE review_id=p_review AND event_no<3)"), "Approval history lost exact count order or head"],
    ["reverse history", change(history, "ORDER BY event_no) FROM events", "ORDER BY event_no DESC) FROM events"), "Approval history lost exact count order or head"],
    ["public authority", change(retain, "'purpose','internal_staff_synthesis'", "'purpose','public_release'"), "First approval packet or exact intent differs"],
  ])("detects %s", (label, fault, expected) => refuses(fault, expected, label === "predecessor checksum constraint"));

  it.each(["same review", "same request", "unrelated review", "harmless comment", "broken review lock", "broken request lock"])("uses a real second-session lock barrier: %s", async mode => {
    const container = resolveLocalDbContainer();
    const writer = rollbackSqlConnection(container), holder = rollbackSqlConnection(container);
    try {
      const seedEnd = fixture.indexOf("SET LOCAL ROLE authenticated;\nSELECT pg_temp.assert_true(pg_temp.approval_history()");
      expect(seedEnd).toBeGreaterThan(0);
      const candidate = process.env.OPENPLAN_SYNTHESIS_APPROVAL_CANDIDATE === "1" ? migration : "";
      // Direct, explicitly synthetic review rows avoid taking correction's transaction
      // lock during setup. Approval itself uses the unchanged production writer.
      const seed = fixture.slice(0, seedEnd).replace(/INSERT INTO approval_probe SELECT '(review1|otherReview)',pg_temp.new_approval_review\('[^']+'\);/g, "");
      const seedPoint = "INSERT INTO approval_probe SELECT 'intent',";
      expect(seed.includes(seedPoint)).toBe(true);
      const rowsSql = `RESET ROLE;
        INSERT INTO engagement_synthesis_reviews(id,campaign_id,workspace_id,source_id,source_sha256,actor_id,preparation_text)
        SELECT 'e2000000-0000-4000-8000-000000000001','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
          'd0000000-0000-4000-8000-000000000002',(SELECT value#>>'{}' FROM approval_probe WHERE key='sourceSha'),
          '13466ed2-dcb7-4861-a528-68cc5579eea9',(SELECT value::text FROM approval_probe WHERE key='preparation');
        INSERT INTO engagement_synthesis_review_revisions(id,review_id,revision_no,actor_id,intent_json,content_text)
        SELECT 'e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',1,'13466ed2-dcb7-4861-a528-68cc5579eea9',
          '{"syntheticLockFixture":true}',(SELECT value::text FROM approval_probe WHERE key='content');`;
      await writer.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${candidate}\n${sourceFixture}\n${seed.replace(seedPoint, rowsSql + "\n" + seedPoint)}`);
      const requestLock = mode.includes("request");
      const key = requestLock ? "engagement-synthesis-approval-request:f2000000-0000-4000-8000-000000000001"
        : "engagement-synthesis-review:" + (mode === "unrelated review" ? "e2000000-0000-4000-8000-000000000999" : "e2000000-0000-4000-8000-000000000001");
      expect((await holder.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('${key}',0)); SELECT 'holder-ready';`)).at(-1)).toBe("holder-ready");
      if (mode === "harmless comment") await writer.query("-- Harmless lock proof comment.\nSELECT 1;");
      if (mode === "broken review lock") await writer.query(change(retain, "'engagement-synthesis-review:'||review::text", "'SYNTHETIC unrelated approval lock'"));
      if (mode === "broken request lock") await writer.query(change(retain, "'engagement-synthesis-approval-request:'||request::text", "'SYNTHETIC unrelated request lock'"));
      const blocked = "SET LOCAL ROLE service_role; SELECT pg_temp.expect_error('SELECT pg_temp.approval()','PT503','Approval write passed a held lock'); RESET ROLE;";
      if (mode.startsWith("broken")) {
        await expect(writer.query(blocked)).rejects.toThrow("Approval write passed a held lock");
      } else if (mode === "unrelated review") {
        expect((await writer.query("SET LOCAL ROLE service_role; SELECT pg_temp.approval()->>'replayed'; RESET ROLE;")).at(-1)).toBe("false");
      } else {
        await writer.query(blocked);
        await holder.close();
        expect((await writer.query("SET LOCAL ROLE service_role; SELECT pg_temp.approval()->>'replayed'; RESET ROLE;")).at(-1)).toBe("false");
      }
    } finally { await Promise.allSettled([holder.close(), writer.close()]); }
  }, 60_000);
});
