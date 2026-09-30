import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadSynthesisApprovalState, retainSynthesisApproval } from "@/lib/engagement/synthesis-approval-server";
import { loadSynthesisReview, retainSynthesisReview } from "@/lib/engagement/synthesis-review-server";
import { loadSynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { loadSynthesisResponseContext } from "@/lib/engagement/synthesis-response-links-server";
import { readSynthesisResponseContext } from "@/lib/engagement/synthesis-response-context-server";
import { readSynthesisResponseLinkHistory, readSynthesisResponseLinkReceipt, synthesisResponseLinkIntentSchema } from "@/lib/engagement/synthesis-response-records-server";
import { loadSynthesisResponseLinkHistory, retainSynthesisResponseLink, retainSynthesisResponseLinkCommand } from "@/lib/engagement/synthesis-response-write-server";
import { loadSynthesisResponseLinkIndex } from "@/lib/engagement/synthesis-response-index-server";
import { writeResponse } from "@/lib/engagement/response-write";
import { readDecisionContext, readDecisionLink, type DecisionLinkIntent } from "@/lib/engagement/decision-links";
import { verifyDecisionSynthesisSources } from "@/lib/engagement/decision-synthesis-history-server";
import { loadDecisionContext, writeDecisionLink } from "@/lib/engagement/decision-links-server";
import { publicReviewStillCurrent } from "@/lib/engagement/survey-responses";
import { parseReviewSnapshot, type EngagementReviewSnapshot } from "@/lib/engagement/review-export";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";
import { withSynthesisProbeDatabase } from "./helpers/synthesis-probe-database";

// Historical candidate fault probes require an explicitly selected preactivation schema.
const CANDIDATE_RLS = LIVE_RLS && process.env.OPENPLAN_SYNTHESIS_CANDIDATE_TEST === "1";
const campaignId = "10c5cdd7-16c6-4b91-b9c0-d2f67598a54f", workspaceId = "d51d566d-28c6-49d2-95d2-3a7a2f0902e1";
const actorId = "13466ed2-dcb7-4861-a528-68cc5579eea9", sourceId = "d0000000-0000-4000-8000-000000000002";
const id = (n: number) => `e5000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reviewId = id(1), actor = { campaignId, workspaceId, actorId }, address = { campaignId, workspaceId, reviewId };
const literal = (v: unknown) => v === null ? "NULL" : "'" + String(typeof v === "object" ? JSON.stringify(v) : v).replaceAll("'", "''") + "'";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const candidate = readFileSync("../docs/reviews/2026-09-27-synthesis-response-links/synthesis-response-links.candidate.sql", "utf8");
const signatures: Record<string, string[]> = {
  read_engagement_synthesis_sources: ["p_campaign", "p_request"],
  read_engagement_synthesis_review: ["p_campaign", "p_review", "p_revision"],
  retain_engagement_synthesis_review: ["p_campaign", "p_actor", "p_workspace", "p_intent", "p_source", "p_source_sha256", "p_preparation_text", "p_content_text"],
  read_engagement_synthesis_approval: ["p_campaign", "p_request"],
  read_engagement_synthesis_approval_history: ["p_campaign", "p_review"],
  retain_engagement_synthesis_approval: ["p_campaign", "p_actor", "p_workspace", "p_intent"],
  read_engagement_response_history: ["p_campaign"],
  list_engagement_synthesis_response_links: ["p_campaign", "p_review"],
  read_engagement_synthesis_response_link: ["p_campaign", "p_request"],
  read_engagement_synthesis_response_links: ["p_campaign", "p_review", "p_response", "p_group"],
  retain_engagement_synthesis_response_link: ["p_campaign", "p_actor", "p_workspace", "p_intent", "p_context_text"],
  read_engagement_response_decision_context: ["p_campaign", "p_response", "p_decision"],
  write_engagement_response_decision_link: ["p_campaign", "p_response", "p_decision", "p_request", "p_operation", "p_predecessor", "p_expected_context_sha256", "p_reason"],
  write_engagement_response: ["p_campaign", "p_request", "p_operation", "p_response", "p_expected_updated_at", "p_reason", "p_changes"],
};
type Packet = { eventText: string; eventSha256: string };
type Receipt = { event: Packet; replayed: boolean };
type Intent = typeof actor & { requestId: string; reviewId: string; responseId: string; groupId: string;
  operation: string; reason: string; predecessorId: string | null; predecessorSha256: string | null; expectedContextSha256: string | null };
type NativeProbe = { client: Pick<SupabaseClient, "rpc">; service: Pick<SupabaseClient, "rpc">; database: ReturnType<typeof rollbackSqlConnection>; query: (statement: string, role?: string) => Promise<Result>;
  intent: Intent; contextText: string; statement: (value: unknown, text: string | null, who?: string, workspace?: string) => string };
type Result = { data: unknown; error: { code: string; message: string } | null };

/** Default fixtures roll back; committed probes must select an owned disposable schema copy. */
async function scenario(sql = candidate, probe?: (native: NativeProbe) => Promise<void>, replyFixture = false, targetDatabase = "postgres") {
  const database = rollbackSqlConnection(resolveLocalDbContainer(), targetDatabase);
  let sourceFixture = readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8");
  if (replyFixture) {
    const columns = "INSERT INTO engagement_items(id,campaign_id,body,title,status,source_type,category_id,configuration_version_id,created_at)";
    const values = "configuration_version_id,'2026-01-02T12:00:00Z' FROM engagement_campaigns WHERE id='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f'";
    expect(sourceFixture.split(columns)).toHaveLength(2); expect(sourceFixture.split(values)).toHaveLength(2);
    sourceFixture = sourceFixture.replace(columns, columns.slice(0, -1) + ",parent_item_id)")
      .replace(values, values.replace(" FROM", ",'b0000000-0000-4000-8000-000000000001' FROM"));
  }
  try {
    await database.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${sql}
      ${probe ? `CREATE TEMP TABLE original_link_lock_functions AS SELECT p.oid,pg_get_functiondef(p.oid) AS body
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
        AND (p.prosrc LIKE '%engagement-response:%' OR p.prosrc LIKE '%engagement-synthesis-review:%');
        DO $setup$ DECLARE row record; BEGIN FOR row IN SELECT body FROM original_link_lock_functions LOOP
          EXECUTE replace(replace(row.body,'engagement-response:','synthetic-setup-response:'),'engagement-synthesis-review:','synthetic-setup-review:');
        END LOOP; END $setup$;` : ""}
      ${sourceFixture}
      CREATE FUNCTION pg_temp.link_rpc(statement text) RETURNS jsonb LANGUAGE plpgsql AS $rpc$
      DECLARE value jsonb; code text; message text; BEGIN
        BEGIN EXECUTE statement INTO value;
        EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
          RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('code',code,'message',message)); END;
        RETURN jsonb_build_object('data',value,'error',NULL);
      END $rpc$;`);
    const query = async (statement: string, role = "authenticated"): Promise<Result> => {
      const command = /^(UPDATE|DELETE|INSERT)\s/i.test(statement) ? statement + " RETURNING NULL::jsonb" : statement;
      const rows = await database.query(`SET LOCAL ROLE ${role}; SELECT pg_temp.link_rpc(${literal(command)}); RESET ROLE;`);
      return JSON.parse(rows.at(-1) ?? "null") as Result;
    };
    const makeClient = (role: string) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      const keys = signatures[name]; if (!keys) throw new Error("Unexpected RPC");
      expect(Object.keys(args).sort()).toEqual([...keys].sort());
      return query(`SELECT public.${name}(${keys.map(k => literal(args[k])).join(",")})`, role);
    } }) as unknown as Pick<SupabaseClient, "rpc">;
    const client = makeClient("authenticated"), service = makeClient("service_role");
    const source = await loadSynthesisSource(client, { campaignId, workspaceId, requestId: sourceId });
    await retainSynthesisReview(client, service, campaignId, { requestId: reviewId, actorId, workspaceId, operation: "create", sourceId, sourceSha256: source.snapshotSha256 });
    const initial = (await loadSynthesisReview(client, address))!;
    const group = initial.content.groups.reduce((a, b) => a.sourceIds.length > b.sourceIds.length ? a : b);
    const all = [...source.snapshot.items.map(row => `item:${row.id}` as const), ...source.snapshot.answers.map(row => `answer:${row.id}` as const)];
    await retainSynthesisReview(client, service, campaignId, { requestId: id(2), actorId, workspaceId, operation: "correct", reviewId,
      expectedRevisionId: reviewId, expectedRevisionSha256: initial.revision.contentSha256, reason: "SYNTHETIC complete theme membership",
      change: { kind: "group_update", groupId: group.id, label: group.label, summary: "SYNTHETIC all selected input", sentiment: "not_assessed",
        addSourceIds: all.filter(key => !group.sourceIds.includes(key)), removeSourceIds: replyFixture ? ["item:b0000000-0000-4000-8000-000000000001"] : [] } });
    const state = (await loadSynthesisApprovalState(client, address))!;
    const approval = await retainSynthesisApproval(client, service, actor, { ...state.current, actorId, requestId: id(3), operation: "approve",
      reason: "SYNTHETIC reviewed source wording", predecessorId: null, predecessorSha256: null });
    const created = await writeResponse(client, campaignId, { operation: "create", body: { requestId: id(4), themeTitle: "SYNTHETIC response", weDid: "SYNTHETIC original answer 中文" } });
    expect(created.error).toBeNull();
    const responseId = created.result!.entryId, groupId = group.id, scope = { ...address, responseId, groupId };
    const context = await loadSynthesisResponseContext(client, scope);
    expect(context.group.sourceIds).toHaveLength(replyFixture ? 302 : 303);
    const intent: Intent = { ...actor, ...scope, requestId: id(10), operation: "link", reason: "SYNTHETIC private linkage",
      predecessorId: null, predecessorSha256: null, expectedContextSha256: context.packet.contextSha256 };
    const statement = (value: unknown, text: string | null, who = actorId, workspace = workspaceId) =>
      `SELECT public.retain_engagement_synthesis_response_link(${literal(campaignId)},${literal(who)},${literal(workspace)},${literal(value)},${literal(text)})`;
    const write = (value: unknown, text = context.packet.contextText, who = actorId, workspace = workspaceId) => query(statement(value, text, who, workspace), "service_role");
    if (probe) {
      // Setup commands took different advisory keys. Restore every production definition before testing real locks.
      await database.query(`DO $restore$ DECLARE row record; BEGIN FOR row IN SELECT body FROM original_link_lock_functions LOOP EXECUTE row.body; END LOOP; END $restore$;`);
      await probe({ client, service, database, query, intent, contextText: context.packet.contextText, statement });
      return;
    }
    const mustFail = async (value: unknown, text: string, code: string, label: string) => expect((await write(value, text)).error?.code, label).toBe(code);
    await mustFail({ ...intent, extra: true }, context.packet.contextText, "22023", "expanded intent accepted");
    await mustFail({ ...intent, requestId: "not-a-uuid" }, context.packet.contextText, "22023", "invalid identifier accepted");
    await mustFail({ ...intent, actorId: id(900) }, context.packet.contextText, "42501", "wrong intent actor accepted");
    await mustFail({ ...intent, reason: "\uFEFF" }, context.packet.contextText, "22023", "blank reason accepted");
    await mustFail({ ...intent, reason: "a".repeat(2001) }, context.packet.contextText, "22023", "long reason accepted");
    await mustFail({ ...intent, groupId: "invalid group" }, context.packet.contextText, "22023", "invalid group accepted");
    await mustFail({ ...intent, predecessorSha256: "0".repeat(64) }, context.packet.contextText, "22023", "unpaired predecessor accepted");
    await mustFail({ ...intent, expectedContextSha256: "0".repeat(64) }, context.packet.contextText, "PT409", "wrong context digest accepted");
    const corrupt = JSON.stringify({ ...context.context, preparationText: "{}" });
    await mustFail({ ...intent, expectedContextSha256: hash(corrupt) }, corrupt, "PT409", "forged rehashed context accepted");
    await mustFail({ ...intent, groupId: "missing" }, context.packet.contextText, "PT409", "missing group accepted");
    expect((await query(`SELECT public.engagement_synthesis_response_current('${campaignId}','${workspaceId}','${reviewId}','${responseId}','missing')`, "postgres")).error?.code, "current context accepted missing group").toBe("PT409");
    const firstResult = await write(intent);
    expect(firstResult.error, "baseline native link failure").toBeNull();
    const first = firstResult.data as Receipt;
    expect(first.replayed).toBe(false); expect(hash(first.event.eventText)).toBe(first.event.eventSha256);
    const event = JSON.parse(first.event.eventText) as { intent: Intent; eventNo: number; context: { contextText: string; contextSha256: string } };
    expect(event.intent).toEqual(intent); expect(event.eventNo).toBe(1); expect(event.context).toEqual(context.packet);
    expect((await readSynthesisResponseContext(event.context, { ...address, responseId })).group.sourceIds).toHaveLength(303);
    const members = await database.query(`SELECT source_kind||':'||source_id::text FROM engagement_synthesis_response_members WHERE event_id='${id(10)}' ORDER BY source_kind,source_id;`);
    expect(members.sort(), "normalized source membership differs").toEqual([...all].sort());
    expect((await write(intent)).data, "exact retry differs").toEqual({ ...first, replayed: true });
    await mustFail({ ...intent, reason: "changed request" }, context.packet.contextText, "PT409", "changed retry accepted");
    await mustFail(intent, context.packet.contextText + " ", "PT409", "changed retry bytes accepted");
    const refresh: Intent = { ...intent, requestId: id(11), operation: "refresh", predecessorId: id(10), predecessorSha256: first.event.eventSha256 };
    await mustFail({ ...refresh, predecessorId: id(999) }, context.packet.contextText, "PT409", "wrong predecessor id accepted");
    await mustFail({ ...refresh, predecessorSha256: "0".repeat(64) }, context.packet.contextText, "PT409", "wrong predecessor digest accepted");
    await mustFail(refresh, context.packet.contextText, "22023", "unchanged refresh accepted");
    const formatted = JSON.stringify(context.context, null, 1);
    await mustFail({ ...refresh, expectedContextSha256: hash(formatted) }, formatted, "22023", "format-only refresh accepted");
    for (const role of ["anon", "authenticated"]) {
      expect((await query(statement(intent, context.packet.contextText), role)).error?.code, "direct writer permission opened").toBe("42501");
      expect((await query(`SELECT public.engagement_synthesis_response_packet('${id(10)}')`, role)).error?.code, "private helper permission opened").toBe("42501");
      expect((await query(`SELECT count(*) FROM engagement_synthesis_response_events`, role)).error?.code, "private table permission opened").toBe("42501");
    }
    const requestRead = `SELECT public.read_engagement_synthesis_response_link('${campaignId}','${id(10)}')`;
    const historyRead = `SELECT public.read_engagement_synthesis_response_links('${campaignId}','${reviewId}','${responseId}','${groupId}')`;
    expect((await query(requestRead)).data).toEqual(first.event);
    expect((await query(historyRead)).data).toMatchObject({ eventCount: 1, headId: id(10), headSha256: first.event.eventSha256, entries: [first.event] });
    expect((await query(requestRead, "anon")).error?.code, "anonymous request read opened").toBe("42501");
    expect((await query(historyRead, "anon")).error?.code, "anonymous history read opened").toBe("42501");
    expect((await query(`UPDATE engagement_synthesis_response_events SET actor_id='${id(900)}' WHERE id='${id(10)}'`, "postgres")).error?.code, "event mutation allowed").toBe("P0001");
    expect((await query(`DELETE FROM engagement_synthesis_response_members WHERE event_id='${id(10)}'`, "postgres")).error?.code, "membership deletion allowed").toBe("P0001");
    // Check a foreign actor before role revocation so actor-filter faults have a distinct assertion.
    await database.query(`SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);`);
    expect((await query(requestRead)).error?.code, "foreign request read opened").toBe("42501");
    expect((await query(historyRead)).error?.code, "foreign history read opened").toBe("42501");
    await database.query(`SELECT set_config('request.jwt.claim.sub','${actorId}',true);`);
    await database.query(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='${actorId}';`);
    expect((await write(intent)).error?.code, "revoked writer replayed").toBe("42501");
    expect((await query(requestRead)).error?.code, "viewer request read opened").toBe("42501");
    expect((await query(historyRead)).error?.code, "viewer history read opened").toBe("42501");
    await database.query(`UPDATE workspace_members SET role='owner' WHERE workspace_id='${workspaceId}' AND user_id='${actorId}';`);
    const changed = await writeResponse(client, campaignId, { operation: "update", entryId: responseId, body: {
      requestId: id(20), expectedUpdatedAt: created.result!.entry.updated_at, reason: "SYNTHETIC correction", weDid: "SYNTHETIC corrected answer" } });
    expect(changed.error).toBeNull();
    await mustFail(refresh, context.packet.contextText, "PT409", "stale response accepted");
    const corrected = await loadSynthesisResponseContext(client, scope);
    refresh.expectedContextSha256 = corrected.packet.contextSha256;
    const secondResult = await write(refresh, corrected.packet.contextText); expect(secondResult.error).toBeNull();
    const second = secondResult.data as Receipt;
    expect((await query(requestRead)).data, "original event changed").toEqual(first.event);
    expect((await query(historyRead)).data).toMatchObject({ eventCount: 2, entries: [first.event, second.event] });
    await retainSynthesisReview(client, service, campaignId, { requestId: id(30), actorId, workspaceId, operation: "correct", reviewId,
      expectedRevisionId: state.current.revisionId, expectedRevisionSha256: state.current.revisionSha256, reason: "SYNTHETIC later review",
      change: { kind: "notes", title: "SYNTHETIC later title", notes: "SYNTHETIC new review" } });
    const later: Intent = { ...refresh, requestId: id(31), predecessorId: id(11), predecessorSha256: second.event.eventSha256 };
    const currentRead = `SELECT public.engagement_synthesis_response_current('${campaignId}','${workspaceId}','${reviewId}','${responseId}','${groupId}')`;
    expect((await query(currentRead, "postgres")).error?.code, "current context accepted stale approval").toBe("PT409");
    await mustFail(later, corrected.packet.contextText, "PT409", "stale approval accepted");
    await retainSynthesisApproval(client, service, actor, { ...approval.event.intent, requestId: id(32), operation: "withdraw", reason: "SYNTHETIC withdrawal",
      predecessorId: approval.event.intent.requestId, predecessorSha256: approval.event.eventSha256 });
    // Keep this check independent of the newer-revision guard: approve then withdraw the current revision.
    const newState = (await loadSynthesisApprovalState(client, address))!;
    const renewed = await retainSynthesisApproval(client, service, actor, { ...newState.current, actorId, requestId: id(35), operation: "approve", reason: "SYNTHETIC renewed review",
      predecessorId: newState.history.head!.intent.requestId, predecessorSha256: newState.history.head!.eventSha256 });
    await retainSynthesisApproval(client, service, actor, { ...renewed.event.intent, requestId: id(36), operation: "withdraw", reason: "SYNTHETIC withdrawn current review",
      predecessorId: renewed.event.intent.requestId, predecessorSha256: renewed.event.eventSha256 });
    expect((await query(currentRead, "postgres")).error?.code, "current context accepted withdrawn approval").toBe("PT409");
    await mustFail(later, corrected.packet.contextText, "PT409", "withdrawn approval accepted");
    const removed = await writeResponse(client, campaignId, { operation: "remove", entryId: responseId, body: {
      requestId: id(33), expectedUpdatedAt: changed.result!.entry.updated_at, reason: "SYNTHETIC response removal" } });
    expect(removed.error).toBeNull();
    expect((await write(intent)).data, "old exact retry lost after removal").toEqual({ ...first, replayed: true });
    const withdrawal = { ...later, operation: "withdraw", expectedContextSha256: null };
    const withdrawn = await query(statement(withdrawal, null), "service_role"); expect(withdrawn.error).toBeNull();
    const last = withdrawn.data as Receipt;
    expect(JSON.parse(last.event.eventText).context).toEqual(corrected.packet);
    const duplicate = { ...withdrawal, requestId: id(34), predecessorId: id(31), predecessorSha256: last.event.eventSha256 };
    expect((await query(statement(duplicate, null), "service_role")).error?.code, "duplicate withdrawal accepted").toBe("PT409");
    expect((await query(historyRead)).data, "complete final history differs").toMatchObject({ eventCount: 3, headId: id(31), headSha256: last.event.eventSha256, entries: [first.event, second.event, last.event] });
    expect((await readSynthesisResponseContext(event.context, { ...address, responseId })).response.we_did).toBe("SYNTHETIC original answer 中文");
  } finally { await database.close(); }
}

describe.skipIf(!CANDIDATE_RLS)("candidate native synthesis response links", () => {
  it("retains complete private links, refreshes, withdrawals and exact retries", () => scenario(), 60_000);
  it("accepts a harmless SQL comment control", () => scenario("-- Harmless candidate control.\n" + candidate), 60_000);
});

const faults = [
  ["context checksum", "encode(extensions.digest(p_context_text,'sha256'),'hex') IS DISTINCT FROM p_intent->>'expectedContextSha256'", "false", "wrong context digest accepted"],
  ["native context equality", "p_context_text::jsonb IS DISTINCT FROM current_context", "false", "forged rehashed context accepted"],
  ["exact retry", "saved.intent_json IS DISTINCT FROM p_intent", "false", "changed retry accepted"],
  ["retry bytes", "saved.context_text IS DISTINCT FROM p_context_text", "false", "changed retry bytes accepted"],
  ["previous id", "previous.id::text IS DISTINCT FROM p_intent->>'predecessorId'", "false", "wrong predecessor id accepted"],
  ["previous digest", "previous.event_sha256 IS DISTINCT FROM p_intent->>'predecessorSha256'", "false", "wrong predecessor digest accepted"],
  ["format-only refresh", "previous.context_text::jsonb=context_text::jsonb", "previous.context_text=context_text", "format-only refresh accepted"],
  ["no-op refresh", "previous.operation<>'withdraw' AND previous.context_text::jsonb=context_text::jsonb", "false", "unchanged refresh accepted"],
  ["blank reason", "(p_intent->>'reason') !~ U&'[^[:space:]\\FEFF]'", "false", "blank reason accepted"],
  ["reason length", "length(p_intent->>'reason')>2000", "false", "long reason accepted"],
  ["scope actor", "p_intent->>'actorId' IS DISTINCT FROM p_actor::text", "false", "wrong intent actor accepted"],
  ["approval head", "approval.revision_id IS DISTINCT FROM revision.id", "false", "current context accepted stale approval"],
  ["approval withdrawal", "approval.operation<>'approve'", "false", "current context accepted withdrawn approval"],
  ["selected group", "IF (SELECT count(*) FROM jsonb_array_elements(revision.content_text::jsonb->'groups') g WHERE g->>'id'=p_group)<>1 THEN", "IF false THEN", "current context accepted missing group"],
  ["complete members", "WHERE g->>'id'=selected_group;", "WHERE g->>'id'=selected_group LIMIT 300;", "normalized source membership differs"],
  ["duplicate withdrawal", "previous.id IS NULL OR previous.operation='withdraw'", "false", "duplicate withdrawal accepted"],
] as const;

describe.skipIf(!CANDIDATE_RLS)("candidate native synthesis response fault controls", () => {
  it.each(faults)("detects %s", async (_name, before, after, assertion) => {
    expect(candidate.split(before)).toHaveLength(2);
    await expect(scenario(candidate.replace(before, after))).rejects.toThrow(assertion);
  }, 60_000);

  it.each(["request", "review", "response", "unrelated", "harmless", "broken request", "broken review", "broken response"])("uses a real second-session lock barrier: %s", async mode => {
    let sql = candidate;
    const kind = mode.replace("broken ", "");
    const key = kind === "request" ? `engagement-synthesis-response-request:${id(10)}`
      : kind === "review" ? `engagement-synthesis-review:${reviewId}` : `engagement-response:${campaignId}`;
    if (mode.startsWith("broken")) {
      const prefix = key.slice(0, key.indexOf(":") + 1);
      sql = sql.replace(`hashtextextended('${prefix}'`, `hashtextextended('broken-${prefix}'`);
      expect(sql).not.toBe(candidate);
    }
    if (mode === "harmless") sql = "-- Harmless lock control.\n" + sql;
    const holder = rollbackSqlConnection(resolveLocalDbContainer());
    try {
      await scenario(sql, async ({ query, intent, contextText, statement }) => {
        const lockKey = mode === "unrelated" || mode === "harmless" ? "synthetic-unrelated-lock" : key;
        await holder.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(lockKey)},0));`);
        const result = await query(statement(intent, contextText), "service_role");
        if (mode.startsWith("broken") || mode === "unrelated" || mode === "harmless") {
          expect(result.error, "control or removed lock did not permit the write").toBeNull();
        } else {
          expect(result.error?.code, "held transaction lock was ignored").toBe("PT503");
        }
        await holder.query("ROLLBACK;");
        const recovered = await query(statement(intent, contextText), "service_role");
        expect(recovered.error).toBeNull();
        expect((recovered.data as Receipt).replayed).toBe(result.error === null);
      });
    } finally { await holder.close(); }
  }, 60_000);
});

function alterFunction(signature: string, before: string, after: string) {
  return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${signature}'::regprocedure);
    IF position(${literal(before)} IN body)=0 THEN RAISE EXCEPTION 'Missing candidate fault seam'; END IF;
    EXECUTE replace(body,${literal(before)},${literal(after)}); END $fault$;`;
}
const nativeDdlFaults = [
  ["event write grant", "GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text) TO authenticated;", "direct writer permission opened"],
  ["packet helper grant", "GRANT EXECUTE ON FUNCTION public.engagement_synthesis_response_packet(uuid) TO authenticated;", "private helper permission opened"],
  ["event table read grant", "GRANT SELECT ON engagement_synthesis_response_events TO authenticated;", "private table permission opened"],
  ["anonymous request grant", "GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_response_link(uuid,uuid) TO anon;", "anonymous request read opened"],
  ["anonymous history grant", "GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text) TO anon;", "anonymous history read opened"],
  ["event immutability", "ALTER TABLE engagement_synthesis_response_events DISABLE TRIGGER synthesis_response_events_immutable;", "event mutation allowed"],
  ["member immutability", "ALTER TABLE engagement_synthesis_response_members DISABLE TRIGGER synthesis_response_members_immutable;", "membership deletion allowed"],
  ["writer revocation", alterFunction("public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text)", "('owner','admin','member')", "('owner','admin','member','viewer')"), "revoked writer replayed"],
  ["request viewer", alterFunction("public.read_engagement_synthesis_response_link(uuid,uuid)", "('owner','admin','member')", "('owner','admin','member','viewer')"), "viewer request read opened"],
  ["history viewer", alterFunction("public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text)", "('owner','admin','member')", "('owner','admin','member','viewer')"), "viewer history read opened"],
  ["request foreign actor", alterFunction("public.read_engagement_synthesis_response_link(uuid,uuid)", "m.user_id=auth.uid()", "true"), "foreign request read opened"],
  ["history foreign actor", alterFunction("public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text)", "m.user_id=auth.uid()", "true"), "foreign history read opened"],
  ["complete history", alterFunction("public.read_engagement_synthesis_response_links(uuid,uuid,uuid,text)", "AND group_id=p_group)", "AND group_id=p_group AND event_no<3)"), "complete final history differs"],
] as const;

describe.skipIf(!CANDIDATE_RLS)("candidate synthesis response access and history fault controls", () => {
  it.each(nativeDdlFaults)("detects %s", async (_name, ddl, assertion) => {
    await expect(scenario(candidate + "\n" + ddl)).rejects.toThrow(assertion);
  }, 60_000);
});

const publicCandidate = readFileSync("../docs/reviews/2026-09-27-synthesis-response-links/synthesis-response-public.candidate.sql", "utf8");
async function publicScenario(sql = publicCandidate, withdraw = false, checkDownloads = false, installed = false) {
  await scenario((installed ? "" : candidate + "\n") + sql, async ({ database, query, intent, contextText, statement }) => {
    await database.query("SAVEPOINT legacy_response;");
    const legacy = await query(`SELECT public.write_engagement_response('${campaignId}','${id(99)}','create',NULL,NULL,NULL,'{"theme_title":"SYNTHETIC unrelated legacy response","status":"published"}')`);
    expect(legacy.error, "unlinked publication control failed").toBeNull();
    expect(legacy.data).toMatchObject({ entry: { status: "published" } });
    await database.query("ROLLBACK TO SAVEPOINT legacy_response; RELEASE SAVEPOINT legacy_response;");
    const saved = await query(statement(intent, contextText), "service_role"); expect(saved.error).toBeNull();
    const eligible = `SELECT to_jsonb(public.read_engagement_synthesis_response_public_eligibility('${campaignId}','${intent.responseId}'))`;
    const publicRead = `SELECT public.read_engagement_response_snapshot('${campaignId}',true)`;
    const privateRead = `SELECT public.read_engagement_response_snapshot('${campaignId}',false)`;
    const response = async () => (await query(`SELECT to_jsonb(e) FROM engagement_closeloop_entries e WHERE id='${intent.responseId}'`, "postgres")).data as { updated_at: string; status: string };
    let command = 100;
    const changeResponse = async (changes: Record<string, unknown>) => query(`SELECT public.write_engagement_response('${campaignId}','${id(++command)}','update','${intent.responseId}',${literal((await response()).updated_at)},'SYNTHETIC publication check',${literal(changes)})`);
    const invalidScope = await query(`SELECT to_jsonb(public.engagement_synthesis_response_public_allowed('${campaignId}','${intent.responseId}','{}'))`, "postgres");
    expect(invalidScope.error).toBeNull(); expect(invalidScope.data, "wrong response record scope accepted").toBe(false);
    const missingResponse = await query(`SELECT to_jsonb(public.read_engagement_synthesis_response_public_eligibility('${campaignId}','${id(999)}'))`);
    expect(missingResponse.error).toBeNull(); expect(missingResponse.data, "missing response treated as eligible").toBe(false);
    if (withdraw) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const denied = await query(`SELECT public.withdraw_ineligible_synthesis_responses('${campaignId}','${actorId}','forged',NULL,NULL)`, role);
        expect(denied.error?.code, "direct withdrawal helper permission opened").toBe("42501");
        const grant = await query(`SELECT to_jsonb(has_function_privilege('${role}','public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)','EXECUTE'))`, "postgres");
        expect(grant.error).toBeNull();
        expect(grant.data, "direct withdrawal helper permission opened").toBe(false);
      }
    }
    const readiness = await query(eligible);
    expect(readiness.error, "eligibility query failed").toBeNull();
    expect(readiness.data, "current complete source not eligible").toBe(true);
    expect((await changeResponse({ status: "published" })).error, "valid link publication failed").toBeNull();
    expect((await query(eligible)).data, "publication invalidated its own link").toBe(true);
    expect((await query(publicRead, "service_role")).data).toMatchObject({ count: 1 });
    expect((await changeResponse({ sort_order: 4 })).error, "display ordering invalidated review").toBeNull();
    expect((await query(eligible)).data).toBe(true);
    let lastReport: { responses: unknown[]; sessions: unknown[]; answers: unknown[] } | undefined;
    let retained: { jobId: string; text: string; checksum: string; snapshot: EngagementReviewSnapshot } | undefined;
    const nativeDownloadClient = {
      async rpc(name: string, args: { p_campaign: string; p_published_only: boolean }) {
        expect(name).toBe("read_engagement_response_snapshot");
        expect(args).toEqual({ p_campaign: campaignId, p_published_only: true });
        return query(publicRead, "service_role");
      },
      from(table: string) {
        expect(["engagement_public_items", "engagement_survey_response_sessions", "engagement_survey_answers"]).toContain(table);
        return { select(projection: string) {
          expect(projection).toMatch(/^[a-z_,]+$/);
          return { eq(column: string, value: string) {
            expect(column).toBe("campaign_id"); expect(value).toBe(campaignId);
            return { async in(idColumn: string, ids: string[]) {
              expect(idColumn).toBe("id");
              return query(`SELECT COALESCE(jsonb_agg(to_jsonb(row)),'[]'::jsonb) FROM (SELECT ${projection} FROM ${table} WHERE campaign_id='${campaignId}' AND id IN (${ids.map(literal).join(",")})) row`, "service_role");
            } };
          } };
        } };
      },
    } as unknown as SupabaseClient;
    const checkRetainedDownload = async (allowed: boolean, label: string) => {
      if (!checkDownloads) return;
      expect(retained, "retained report fixture missing").toBeDefined();
      expect(await publicReviewStillCurrent(nativeDownloadClient, retained!.snapshot), `${label} retained download eligibility differs`).toBe(allowed);
      if (label === "private survey") {
        expect(await publicReviewStillCurrent(nativeDownloadClient, { ...retained!.snapshot, responses: [] }), "private survey-only retained download was allowed").toBe(false);
      }
      const saved = await query(`SELECT jsonb_build_object('text',snapshot_text,'checksum',snapshot_sha256) FROM engagement_report_jobs WHERE id='${retained!.jobId}'`, "postgres");
      expect(saved.error).toBeNull();
      expect(saved.data, `${label} changed retained snapshot bytes`).toEqual({ text: retained!.text, checksum: retained!.checksum });
    };
    const report = async (scope: string, filters: Record<string, unknown> = {}) => {
      const queued = await query(`SELECT public.queue_engagement_report('${campaignId}','${id(++command)}',${literal(scope)},${literal(filters)})`);
      expect(queued.error, "report fixture did not queue").toBeNull();
      const job = (queued.data as { jobId: string }).jobId;
      if (checkDownloads && !retained && scope === "public" && Object.keys(filters).length === 0) {
        const row = await query(`SELECT jsonb_build_object('text',snapshot_text,'checksum',snapshot_sha256) FROM engagement_report_jobs WHERE id='${job}'`, "postgres");
        expect(row.error).toBeNull();
        const saved = row.data as { text: string; checksum: string };
        retained = { jobId: job, ...saved, snapshot: await parseReviewSnapshot(saved.text, saved.checksum, { campaignId, workspaceId, scope: "public" }) };
      }
      lastReport = (await query(`SELECT snapshot_text::jsonb FROM engagement_report_jobs WHERE id=${literal(job)}`, "postgres")).data as typeof lastReport;
      return lastReport!.responses;
    };
    expect(await report("public")).toHaveLength(1);
    expect(lastReport!.sessions, "public control lost approved survey").toHaveLength(1);
    expect(lastReport!.answers, "public control lost approved answers").toHaveLength(2);
    await checkRetainedDownload(true, "published control");
    for (const scope of ["public", "internal"]) {
      expect(await report(scope, { categoryIds: ["a0000000-0000-4000-8000-000000000002"] }), "filtered report omitted linked source dependencies").toHaveLength(0);
    }
    expect((await query(eligible, "anon")).error?.code, "anonymous eligibility read allowed").toBe("42501");
    expect((await query(`SELECT public.engagement_synthesis_response_public_allowed('${campaignId}','${intent.responseId}','{}')`)).error?.code, "private evaluator callable").toBe("42501");
    await database.query(`SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);`);
    expect((await query(eligible)).error?.code, "foreign eligibility read allowed").toBe("42501");
    await database.query(`SELECT set_config('request.jwt.claim.sub','',true);`);
    expect((await query(eligible, "service_role")).data, "service public reader requires a staff identity").toBe(true);
    await database.query(`SELECT set_config('request.jwt.claim.sub','${actorId}',true);`);
    // Each isolated change must actually alter eligibility, and rollback must recover the same published response.
    const changed = async (sqlChange: string, label: string, status = withdraw && label !== "incomplete dependency index" ? "draft" : "published") => {
      await database.query("SAVEPOINT public_change;");
      const before = await response();
      const priorHistory = await query(`SELECT public.read_engagement_response_history('${campaignId}')`);
      if (withdraw) {
        await database.query(`SELECT set_config('openplan.response_request','${id(998)}',true);`);
        // Native review/link writes retain an explicit actor and do not require a user JWT.
        if (label.startsWith("synthesis") || label === "withdrawn final link") await database.query("SELECT set_config('request.jwt.claim.sub','',true);");
      }
      expect((await query(sqlChange, "postgres")).error, `${label} fixture failed`).toBeNull();
      await database.query(`SELECT set_config('request.jwt.claim.sub','${actorId}',true);`);
      if (withdraw && label !== "incomplete dependency index" && label !== "response wording") {
        const receipts = await query(`SELECT jsonb_agg(to_jsonb(r)) FROM engagement_response_write_receipts r WHERE response_id='${intent.responseId}' AND operation='source_withdrawal'`, "postgres");
        expect(receipts.error).toBeNull();
        const entries = receipts.data as { request_id: string; actor_id: string; before_record: unknown; payload_json: { reason: string; causeKind: string }; result_json: { entry: { status: string; published_at: unknown } } }[];
        expect(entries, `${label} withdrawal receipt count differs`).toHaveLength(1);
        expect(entries[0].actor_id, `${label} withdrawal actor lost`).toBe(actorId);
        expect(entries[0].before_record, `${label} withdrawal before record differs`).toEqual(before);
        expect(entries[0].payload_json.causeKind, `${label} withdrawal cause lost`).toBeTruthy();
        expect(entries[0].result_json, `${label} withdrawal receipt not finalized`).toMatchObject({ entry: { status: "draft", published_at: null } });
        const history = await query(`SELECT to_jsonb(h) FROM engagement_response_history h WHERE response_id='${intent.responseId}' ORDER BY revision DESC LIMIT 1`, "postgres");
        expect(history.data, `${label} withdrawal history provenance lost`).toMatchObject({ actor_id: actorId, event: "unpublished", change_origin: "source_withdrawal", write_request_id: entries[0].request_id, change_reason: entries[0].payload_json.reason });
        const original = await query(`SELECT public.read_engagement_synthesis_response_link('${campaignId}','${intent.requestId}')`);
        expect(original.data, `${label} changed original link bytes`).toEqual((saved.data as Receipt).event);
        const replay = await query(statement(intent, contextText), "service_role");
        expect(replay.error).toBeNull();
        expect(replay.data, `${label} exact link retry lost`).toEqual({ ...(saved.data as Receipt), replayed: true });
        expect((await response()).status, `${label} retry restored publication`).toBe("draft");
        // Running reconciliation again cannot manufacture another withdrawal or alter old history.
        expect((await query(`SELECT to_jsonb(public.withdraw_ineligible_synthesis_responses('${campaignId}','${actorId}','synthetic_retry',NULL,NULL))`, "postgres")).error).toBeNull();
        const again = await query(`SELECT jsonb_agg(to_jsonb(r)) FROM engagement_response_write_receipts r WHERE response_id='${intent.responseId}' AND operation='source_withdrawal'`, "postgres");
        expect(again.data, `${label} duplicate reconciliation differs`).toEqual(entries);
        expect((await query("SELECT to_jsonb(current_setting('openplan.response_request',true))")).data, `${label} request context not restored`).toBe(id(998));
      }
      expect((await query(eligible)).data, `${label} remained eligible`).toBe(false);
      expect((await response()).status, `${label} changed response status unexpectedly`).toBe(status);
      expect((await query(publicRead, "service_role")).data, `${label} escaped public snapshot`).toMatchObject({ count: 0, entries: [] });
      expect((await query(privateRead)).data, `${label} lost staff response`).toMatchObject({ count: 1 });
      await checkRetainedDownload(false, label);
      expect(await report("public"), `${label} escaped public report`).toHaveLength(0);
      if (label === "private survey") {
        expect(lastReport!.sessions, "private survey escaped public report capture").toHaveLength(0);
        expect(lastReport!.answers, "private survey answers escaped public report capture").toHaveLength(0);
      }
      expect(await report("internal"), `${label} changed internal published-response selection`).toHaveLength(status === "published" ? 1 : 0);
      if (label === "private survey") {
        expect(lastReport!.sessions, "private survey lost internal report custody").toHaveLength(1);
        expect(lastReport!.answers, "private survey answers lost internal report custody").toHaveLength(2);
      }
      expect((await changeResponse({ status: "published" })).error?.code, `${label} publication was accepted`).toBe("PT409");
      await database.query("ROLLBACK TO SAVEPOINT public_change; RELEASE SAVEPOINT public_change;");
      expect((await query(eligible)).data, `${label} rollback failed to restore control`).toBe(true);
      expect((await query(`SELECT public.read_engagement_response_history('${campaignId}')`)).data, `${label} rollback changed prior history`).toEqual(priorHistory.data);
      await checkRetainedDownload(true, `${label} rollback`);
    };
    const itemId = "b0000000-0000-4000-8000-000000000002", answerId = "c0000000-0000-4000-8000-000000000002", sessionId = "c0000000-0000-4000-8000-000000000001";
    await changed(`UPDATE engagement_items SET body='SYNTHETIC changed source',review_expected_updated_at=updated_at,review_reason='SYNTHETIC source correction' WHERE id='${itemId}'`, "comment correction");
    await changed(`UPDATE engagement_items SET metadata_json=metadata_json||'{"visibility":"private"}',review_expected_updated_at=updated_at,review_reason='SYNTHETIC privacy change' WHERE id='${itemId}'`, "private comment");
    await changed(`UPDATE engagement_items SET status='rejected',review_expected_updated_at=updated_at,review_reason='SYNTHETIC status change' WHERE id='${itemId}'`, "unpublished comment");
    await changed(`UPDATE engagement_items SET body='SYNTHETIC changed reply parent',review_expected_updated_at=updated_at,review_reason='SYNTHETIC parent correction' WHERE id='b0000000-0000-4000-8000-000000000001'`, "reply parent correction");
    await changed(`UPDATE engagement_items SET metadata_json=metadata_json||'{"visibility":"private"}',review_expected_updated_at=updated_at,review_reason='SYNTHETIC parent privacy' WHERE id='b0000000-0000-4000-8000-000000000001'`, "private reply parent");
    if (withdraw) {
      const deletion = await query(`DELETE FROM engagement_items WHERE id='${itemId}'`, "postgres");
      expect(deletion.error?.code, "retained comment deletion bypassed custody").toBe("23503");
      expect((await query(eligible)).data, "failed deletion invalidated publication").toBe(true);
      expect((await response()).status, "failed deletion withdrew publication").toBe("published");
      await changed(`DELETE FROM engagement_survey_answers WHERE id='${answerId}'`, "answer deletion");
    }
    await changed(`UPDATE engagement_survey_answers SET answer_text='SYNTHETIC changed answer' WHERE id='${answerId}'`, "answer wording");
    await changed(`UPDATE engagement_survey_answers SET answer_json='{"text":"SYNTHETIC changed structured answer"}' WHERE id='${answerId}'`, "answer structured value");
    await changed(`SELECT to_jsonb(public.review_engagement_survey('${campaignId}','${sessionId}',(SELECT updated_at FROM engagement_survey_response_sessions WHERE id='${sessionId}'),'approved','SYNTHETIC actual reviewed redaction',${literal({ [answerId]: "SYNTHETIC reviewed replacement" })}))`, "reviewed survey redaction");
    await changed(`SELECT to_jsonb(public.review_engagement_survey('${campaignId}','${sessionId}',(SELECT updated_at FROM engagement_survey_response_sessions WHERE id='${sessionId}'),'rejected','SYNTHETIC actual review change','{}'))`, "survey review withdrawal");
    await changed(`UPDATE engagement_survey_response_sessions SET metadata_json=metadata_json||'{"visibility":"private"}' WHERE id='${sessionId}'`, "private survey");
    // Publication metadata and votes do not change the contribution's reviewed meaning.
    await database.query("SAVEPOINT harmless_votes;");
    expect((await query(`UPDATE engagement_items SET votes_count=votes_count+1 WHERE id='${itemId}'`, "postgres")).error).toBeNull();
    expect((await query(eligible)).data, "vote count invalidated source meaning").toBe(true);
    expect((await response()).status, "vote count withdrew publication").toBe("published");
    await database.query("ROLLBACK TO SAVEPOINT harmless_votes; RELEASE SAVEPOINT harmless_votes;");
    const originalContext = JSON.parse(contextText) as { revision: { id: string; contentText: string; contentSha256: string }; sourceId: string; sourceSha256: string; approval: Packet };
    const approvedIntent = (JSON.parse(originalContext.approval.eventText) as { intent: Record<string, unknown> }).intent;
    await changed(`SELECT public.retain_engagement_synthesis_approval('${campaignId}','${actorId}','${workspaceId}',${literal({ ...approvedIntent, requestId: id(800), operation: "withdraw", reason: "SYNTHETIC withdrawn publication basis", predecessorId: approvedIntent.requestId, predecessorSha256: originalContext.approval.eventSha256 })})`, "synthesis approval withdrawal");
    const correction = { requestId: id(801), actorId, workspaceId, operation: "correct", reviewId,
      expectedRevisionId: originalContext.revision.id, expectedRevisionSha256: originalContext.revision.contentSha256,
      reason: "SYNTHETIC updated review", change: { kind: "notes", title: "SYNTHETIC corrected public basis", notes: "SYNTHETIC corrected interpretation" } };
    const content = JSON.stringify({ ...JSON.parse(originalContext.revision.contentText), title: correction.change.title, notes: correction.change.notes });
    await changed(`SELECT public.retain_engagement_synthesis_review('${campaignId}','${actorId}','${workspaceId}',${literal(correction)},'${originalContext.sourceId}','${originalContext.sourceSha256}',NULL,${literal(content)})`, "synthesis review correction");
    await database.query("ALTER TABLE engagement_synthesis_response_members DISABLE TRIGGER synthesis_response_members_immutable;");
    await changed(`DELETE FROM engagement_synthesis_response_members WHERE event_id='${intent.requestId}' AND source_id='${itemId}'`, "incomplete dependency index");
    await database.query("ALTER TABLE engagement_synthesis_response_members ENABLE TRIGGER synthesis_response_members_immutable;");
    const latest = await response();
    await changed(`SELECT public.write_engagement_response('${campaignId}','${id(700)}','update','${intent.responseId}',${literal(latest.updated_at)},'SYNTHETIC corrected answer','{"status":"draft","we_did":"SYNTHETIC new response meaning"}')`, "response wording", "draft");
    const withdrawal = { ...intent, requestId: id(701), operation: "withdraw", expectedContextSha256: null,
      predecessorId: intent.requestId, predecessorSha256: (saved.data as Receipt).event.eventSha256 };
    await changed(statement(withdrawal, null), "withdrawn final link");
  }, true);
}

describe.skipIf(!CANDIDATE_RLS)("candidate synthesis response public eligibility", () => {
  it("checks complete survey and comment dependencies across publication, public reads and reports", () => publicScenario(), 60_000);
  it("accepts a harmless public evaluator comment", () => publicScenario("-- Harmless public evaluator control.\n" + publicCandidate), 60_000);
});

const publicFaults = [
  ["report survey privacy", "public.engagement_item_public_copy_allowed(s.status,s.metadata_json)", "s.status=''approved''", "private survey escaped public report capture"],
  ["comment privacy", "NOT public.engagement_item_public_copy_allowed(item.status,item.metadata_json)", "false", "private comment remained eligible"],
  ["comment meaning", "retained IS NULL OR public.engagement_synthesis_item_meaning(retained) IS DISTINCT FROM public.engagement_synthesis_item_meaning(to_jsonb(item))", "false", "comment correction remained eligible"],
  ["reply parent privacy", "NOT public.engagement_item_public_copy_allowed(parent.status,parent.metadata_json)", "false", "private reply parent remained eligible"],
  ["reply parent meaning", "retained_parent IS NULL OR public.engagement_synthesis_item_meaning(retained_parent) IS DISTINCT FROM public.engagement_synthesis_item_meaning(to_jsonb(parent))", "false", "reply parent correction remained eligible"],
  ["answer content", "retained IS DISTINCT FROM to_jsonb(answer)", "false", "answer wording remained eligible"],
  ["survey privacy", "NOT public.engagement_item_public_copy_allowed(session.status,session.metadata_json)", "false", "private survey remained eligible"],
  ["public snapshot", "AND public.read_engagement_synthesis_response_public_eligibility(p_campaign,id)", "", "comment correction escaped public snapshot"],
  ["public write", "IF NEW.status='published' AND NOT public.engagement_synthesis_response_public_allowed(NEW.campaign_id,NEW.id,to_jsonb(NEW)) THEN", "IF false THEN", "comment correction publication was accepted"],
  ["public report", " AND (p_scope=''internal'' OR public.engagement_synthesis_response_public_allowed(p_campaign,e.id,to_jsonb(e)))", "", "comment correction escaped public report"],
  ["report selection", "||selection);", ");", "filtered report omitted linked source dependencies"],
  ["withdrawn final link", "RETURN seen;", "RETURN true;", "withdrawn final link remained eligible"],
  ["response meaning", "IF ((context#>>'{responseHistory,recordText}')::jsonb-ARRAY['status','published_at','updated_at','sort_order'])\n   IS DISTINCT FROM (p_record-ARRAY['status','published_at','updated_at','sort_order']) THEN RETURN false; END IF;", "", "response wording remained eligible"],
  ["approval and review heads", "IF revision.id::text IS DISTINCT FROM context#>>'{revision,id}' OR approval.operation IS DISTINCT FROM 'approve'\n   OR approval.revision_id IS DISTINCT FROM revision.id OR approval.event_text IS DISTINCT FROM context#>>'{approval,eventText}'\n   OR approval.event_sha256 IS DISTINCT FROM context#>>'{approval,eventSha256}' THEN RETURN false; END IF;", "", "synthesis approval withdrawal remained eligible"],
  ["complete dependencies", "IF (SELECT COALESCE(jsonb_agg(source_kind||':'||source_id::text ORDER BY source_kind||':'||source_id::text),'[]'::jsonb)\n    FROM engagement_synthesis_response_members WHERE event_id=link.id)\n   IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(selected->'sourceIds')) THEN RETURN false; END IF;", "", "incomplete dependency index remained eligible"],
] as const;

describe.skipIf(!CANDIDATE_RLS)("candidate public dependency fault controls", () => {
  it.each(publicFaults)("detects %s", async (_name, before, after, assertion) => {
    expect(publicCandidate.split(before)).toHaveLength(2);
    await expect(publicScenario(publicCandidate.replace(before, after))).rejects.toThrow(assertion);
  }, 60_000);
  it.each([
    ["anonymous eligibility", "GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_response_public_eligibility(uuid,uuid) TO anon;", "anonymous eligibility read allowed"],
    ["private evaluator", "GRANT EXECUTE ON FUNCTION public.engagement_synthesis_response_public_allowed(uuid,uuid,jsonb) TO authenticated;", "private evaluator callable"],
    ["foreign eligibility", alterFunction("public.read_engagement_synthesis_response_public_eligibility(uuid,uuid)", "m.user_id=auth.uid()", "true"), "foreign eligibility read allowed"],
  ])("detects %s", async (_name, ddl, assertion) => {
    await expect(publicScenario(publicCandidate + "\n" + ddl)).rejects.toThrow(assertion);
  }, 60_000);
});


const withdrawalCandidate = readFileSync("../docs/reviews/2026-09-27-synthesis-response-links/synthesis-response-withdrawal.candidate.sql", "utf8");
describe.skipIf(!CANDIDATE_RLS)("candidate synthesis stored withdrawal", () => {
  it("retains automatic withdrawal receipts and service actor history across all source kinds", () => publicScenario(publicCandidate + "\n" + withdrawalCandidate, true), 60_000);
  it("accepts a harmless withdrawal comment", () => publicScenario(publicCandidate + "\n-- Harmless withdrawal control.\n" + withdrawalCandidate, true), 60_000);
});


const withdrawalFaults = [
  ["comment custody", "ALTER TABLE engagement_item_history DROP CONSTRAINT engagement_item_history_item_id_fkey;", "retained comment deletion bypassed custody"],
  ["current eligibility", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "AND NOT public.engagement_synthesis_response_public_allowed(p_campaign,e.id,to_jsonb(e))", ""), "vote count withdrew publication"],
  ["draft reconciliation", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "AND e.status='published'", ""), "comment correction duplicate reconciliation differs"],
  ["receipt finalization", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "WHERE campaign_id=p_campaign AND request_id=request", "WHERE false AND campaign_id=p_campaign AND request_id=request"), "comment correction withdrawal receipt not finalized"],
  ["comment trigger", "ALTER TABLE engagement_items DISABLE TRIGGER synthesis_item_publication;", "comment correction withdrawal receipt count differs"],
  ["answer trigger", "ALTER TABLE engagement_survey_answers DISABLE TRIGGER synthesis_answer_publication;", "answer deletion withdrawal receipt count differs"],
  ["session trigger", "ALTER TABLE engagement_survey_response_sessions DISABLE TRIGGER synthesis_session_publication;", "survey review withdrawal withdrawal receipt count differs"],
  ["revision trigger", "ALTER TABLE engagement_synthesis_review_revisions DISABLE TRIGGER synthesis_revision_publication;", "synthesis review correction withdrawal receipt count differs"],
  ["approval trigger", "ALTER TABLE engagement_synthesis_approval_events DISABLE TRIGGER synthesis_approval_publication;", "synthesis approval withdrawal withdrawal receipt count differs"],
  ["link reconciliation", alterFunction("public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text)", "PERFORM public.withdraw_ineligible_synthesis_responses(p_campaign,p_actor,'synthesis_response_link',", "PERFORM public.withdraw_ineligible_synthesis_responses(NULL,p_actor,'synthesis_response_link',"), "withdrawn final link withdrawal receipt count differs"],
  ["receipt actor", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "previous.id,p_actor,'source_withdrawal'", "previous.id,auth.uid(),'source_withdrawal'"), "synthesis approval withdrawal withdrawal actor lost"],
  ["history actor", alterFunction("public.retain_engagement_response_history()", "CASE WHEN write_receipt.request_id IS NOT NULL THEN write_receipt.actor_id ELSE auth.uid() END", "auth.uid()"), "synthesis approval withdrawal withdrawal history provenance lost"],
  ["history receipt", alterFunction("public.retain_engagement_response_history()", " OR r.operation = 'source_withdrawal'", ""), "synthesis approval withdrawal withdrawal history provenance lost"],
  ["request restoration", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "COALESCE(previous_context,'')", "''"), "comment correction request context not restored"],
  ["withdrawal grant", "GRANT EXECUTE ON FUNCTION public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb) TO service_role;", "direct withdrawal helper permission opened"],
] as const;
describe.skipIf(!CANDIDATE_RLS)("candidate stored withdrawal fault controls", () => {
  it.each(withdrawalFaults)("detects %s", async (_name, sql, assertion) => {
    await expect(publicScenario(publicCandidate + "\n" + withdrawalCandidate + "\n" + sql, true)).rejects.toThrow(assertion);
  }, 60_000);
});

async function withdrawalIsolation(isolation: string, sql = withdrawalCandidate) {
  const database = rollbackSqlConnection(resolveLocalDbContainer());
  try {
    await database.query(`BEGIN ISOLATION LEVEL ${isolation}; ${candidate} ${publicCandidate} ${sql}
      CREATE FUNCTION pg_temp.withdrawal_isolation_probe() RETURNS text LANGUAGE plpgsql AS $probe$
      BEGIN PERFORM public.withdraw_ineligible_synthesis_responses('${campaignId}','${actorId}','isolation',NULL,NULL);
       RETURN 'accepted'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $probe$;`);
    const result = await database.query("SELECT pg_temp.withdrawal_isolation_probe();");
    expect(result, "fixed snapshot withdrawal was accepted").toEqual([isolation === "READ COMMITTED" ? "accepted" : "25001"]);
  } finally { await database.close(); }
}
describe.skipIf(!CANDIDATE_RLS)("candidate stored withdrawal isolation", () => {
  it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])("checks %s", isolation => withdrawalIsolation(isolation), 60_000);
  it("detects a removed fixed snapshot guard", async () => {
    const sql = withdrawalCandidate.replace("IF current_setting('transaction_isolation')<>'read committed' THEN", "IF false THEN");
    expect(sql).not.toBe(withdrawalCandidate);
    await expect(withdrawalIsolation("REPEATABLE READ", sql)).rejects.toThrow("fixed snapshot withdrawal was accepted");
  }, 60_000);
});


async function withdrawalLock(mode: "held" | "unrelated" | "harmless" | "broken") {
  let sql = withdrawalCandidate;
  if (mode === "harmless") sql = "-- Harmless withdrawal lock comment.\n" + sql;
  if (mode === "broken") {
    sql = sql.replace("hashtextextended('engagement-response:'||p_campaign", "hashtextextended('broken-withdrawal-response:'||p_campaign");
    expect(sql).not.toBe(withdrawalCandidate);
  }
  const holder = rollbackSqlConnection(resolveLocalDbContainer());
  try {
    await scenario(candidate + "\n" + publicCandidate + "\n" + sql, async ({ database, query, intent, contextText, statement }) => {
      // Build the published control on distinct keys, then restore all original lock definitions.
      await database.query(`CREATE TEMP TABLE withdrawal_lock_functions AS SELECT pg_get_functiondef(p.oid) AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
        AND p.prosrc LIKE '%engagement-response:%';
       DO $setup$ DECLARE row record; BEGIN FOR row IN SELECT body FROM withdrawal_lock_functions LOOP
        EXECUTE replace(row.body,'engagement-response:','synthetic-withdrawal-setup:'); END LOOP; END $setup$;`);
      const linked = await query(statement(intent, contextText), "service_role"); expect(linked.error).toBeNull();
      const published = await query(`SELECT public.write_engagement_response('${campaignId}','${id(950)}','update','${intent.responseId}',
       (SELECT updated_at FROM engagement_closeloop_entries WHERE id='${intent.responseId}'),'SYNTHETIC barrier control','{"status":"published"}')`);
      expect(published.error).toBeNull();
      await database.query(`DO $restore$ DECLARE row record; BEGIN FOR row IN SELECT body FROM withdrawal_lock_functions LOOP
       EXECUTE row.body; END LOOP; END $restore$;`);
      const lockKey = mode === "unrelated" || mode === "harmless" ? "synthetic-unrelated-withdrawal" : `engagement-response:${campaignId}`;
      await holder.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${literal(lockKey)},0));`);
      const change = "UPDATE engagement_survey_answers SET answer_text='SYNTHETIC source retry' WHERE id='c0000000-0000-4000-8000-000000000002'";
      const first = await query(change, "postgres");
      if (mode === "held" || mode === "broken") {
        expect(first.error?.code, "held withdrawal lock was ignored").toBe("PT503");
        expect((await query(`SELECT to_jsonb(status) FROM engagement_closeloop_entries WHERE id='${intent.responseId}'`, "postgres")).data).toBe("published");
        expect((await query("SELECT to_jsonb(answer_text) FROM engagement_survey_answers WHERE id='c0000000-0000-4000-8000-000000000002'", "postgres")).data).toBe("SYNTHETIC survey concern");
      } else expect(first.error, "unrelated lock blocked source correction").toBeNull();
      await holder.query("ROLLBACK;");
      expect((await query(change, "postgres")).error, "source retry failed after lock release").toBeNull();
      expect((await query(`SELECT to_jsonb(status) FROM engagement_closeloop_entries WHERE id='${intent.responseId}'`, "postgres")).data, "source retry did not withdraw publication").toBe("draft");
      expect((await query(`SELECT to_jsonb(count(*)) FROM engagement_response_write_receipts WHERE response_id='${intent.responseId}' AND operation='source_withdrawal'`, "postgres")).data, "source retry duplicated withdrawal").toBe(1);
    });
  } finally { await holder.close(); }
}
describe.skipIf(!CANDIDATE_RLS)("candidate stored withdrawal lock", () => {
  it.each(["held", "unrelated", "harmless"] as const)("uses a real source-change barrier: %s", mode => withdrawalLock(mode), 60_000);
  it("detects a removed withdrawal campaign lock", async () => {
    await expect(withdrawalLock("broken")).rejects.toThrow("held withdrawal lock was ignored");
  }, 60_000);
});


describe.skipIf(!CANDIDATE_RLS)("candidate retained download eligibility", () => {
  it("checks real retained reports against changed approval and source dependencies", () => publicScenario(publicCandidate, false, true), 60_000);
  it("keeps original report bytes while stored withdrawals deny downloads", () => publicScenario(publicCandidate + "\n" + withdrawalCandidate, true, true), 60_000);
});


describe.skipIf(!CANDIDATE_RLS)("candidate committed synthesis database", () => {
  it("commits a linked fixture in a disposable schema copy visible to another session", async () => {
    const container = resolveLocalDbContainer();
    await withSynthesisProbeDatabase(container, async target => {
      const reader = rollbackSqlConnection(container, target);
      try {
        await scenario(candidate + "\n" + publicCandidate + "\n" + withdrawalCandidate, async ({ database, query, intent, contextText, statement }) => {
          expect((await query(statement(intent, contextText), "service_role")).error).toBeNull();
          await database.query("COMMIT;");
          expect(await reader.query("SELECT current_database();"), "probe connected to wrong database").toEqual([target]);
          expect(await reader.query(`SELECT count(*) FROM engagement_synthesis_response_events WHERE id='${intent.requestId}';`), "other session cannot see committed link").toEqual(["1"]);
          expect(await reader.query("SELECT count(*) FROM auth.users;"), "schema copy contains unrelated source users").toEqual(["3"]);
        }, true, target);
      } finally { await reader.close(); }
    });
  }, 120_000);
});


type RaceSource = "comment" | "parent" | "answer" | "survey_review" | "survey_privacy" | "approval" | "review" | "link" | "vote";
const changeActor = "7a50d4fb-35b7-41f4-9bce-8a4e7d157569";
const rpcAdapter = `CREATE FUNCTION pg_temp.link_rpc(statement text) RETURNS jsonb LANGUAGE plpgsql AS $rpc$
 DECLARE value jsonb; code text; message text; BEGIN
  BEGIN EXECUTE statement INTO value;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
   RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('code',code,'message',message)); END;
  RETURN jsonb_build_object('data',value,'error',NULL);
 END $rpc$;`;
function raceQuery(database: ReturnType<typeof rollbackSqlConnection>) {
  return async (statement: string, role = "authenticated"): Promise<Result> => {
    const command = /^(UPDATE|DELETE|INSERT)\s/i.test(statement) ? statement + " RETURNING NULL::jsonb" : statement;
    const rows = await database.query(`SET LOCAL ROLE ${role}; SELECT pg_temp.link_rpc(${literal(command)}); RESET ROLE;`);
    return JSON.parse(rows.at(-1) ?? "null") as Result;
  };
}
async function beginRace(database: ReturnType<typeof rollbackSqlConnection>, user: string, isolation = "READ COMMITTED") {
  await database.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='15s'; SELECT set_config('request.jwt.claim.sub','${user}',true);`);
}
async function observedBlock(observer: ReturnType<typeof rollbackSqlConnection>, waiting: string, holder: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query(`SELECT ${holder}=ANY(pg_blocking_pids(${waiting}));`);
    if (result.at(-1) === "t") return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Concurrent writer did not wait on the expected transaction");
}

async function committedRace(kind: RaceSource, order: "publication_first" | "source_first", sql = candidate + "\n" + publicCandidate + "\n" + withdrawalCandidate, publicationIsolation = "READ COMMITTED") {
  const container = resolveLocalDbContainer();
  await withSynthesisProbeDatabase(container, async target => {
    const changer = rollbackSqlConnection(container, target);
    try {
      await changer.query(rpcAdapter);
      await scenario(sql, async ({ database, query, intent, contextText, statement }) => {
        await database.query(`UPDATE workspace_members SET role='member' WHERE workspace_id='${workspaceId}' AND user_id='${changeActor}';`);
        const saved = await query(statement(intent, contextText), "service_role"); expect(saved.error).toBeNull();
        const version = (await query(`SELECT to_jsonb(updated_at) FROM engagement_closeloop_entries WHERE id='${intent.responseId}'`, "postgres")).data as string;
        const sessionVersion = (await query("SELECT to_jsonb(updated_at) FROM engagement_survey_response_sessions WHERE id='c0000000-0000-4000-8000-000000000001'", "postgres")).data as string;
        await database.query("COMMIT;");
        const publisherPid = (await database.query("SELECT pg_backend_pid();")).at(-1)!;
        const changerPid = (await changer.query("SELECT pg_backend_pid();")).at(-1)!;
        const changeQuery = raceQuery(changer);
        const publish = `SELECT public.write_engagement_response('${campaignId}','${id(1000)}','update','${intent.responseId}',${literal(version)},'SYNTHETIC concurrent publication','{"status":"published"}')`;
        const item = kind === "parent" ? "b0000000-0000-4000-8000-000000000001" : "b0000000-0000-4000-8000-000000000002";
        const answer = "c0000000-0000-4000-8000-000000000002", session = "c0000000-0000-4000-8000-000000000001";
        const context = JSON.parse(contextText) as { sourceId: string; sourceSha256: string; revision: { id: string; contentText: string; contentSha256: string }; approval: Packet };
        const approved = (JSON.parse(context.approval.eventText) as { intent: Record<string, unknown> }).intent;
        const correction = { requestId: id(1001), actorId: changeActor, workspaceId, operation: "correct", reviewId,
          expectedRevisionId: context.revision.id, expectedRevisionSha256: context.revision.contentSha256,
          reason: "SYNTHETIC concurrent review", change: { kind: "notes", title: "SYNTHETIC revised basis", notes: "SYNTHETIC new interpretation" } };
        const content = JSON.stringify({ ...JSON.parse(context.revision.contentText), title: correction.change.title, notes: correction.change.notes });
        const change = kind === "comment" || kind === "parent" ? `UPDATE engagement_items SET body='SYNTHETIC concurrent source correction',review_expected_updated_at=updated_at,review_reason='SYNTHETIC concurrent change' WHERE id='${item}'`
          : kind === "vote" ? `UPDATE engagement_items SET votes_count=votes_count+1 WHERE id='${item}'`
          : kind === "answer" ? `UPDATE engagement_survey_answers SET answer_text='SYNTHETIC concurrent answer' WHERE id='${answer}'`
          : kind === "survey_review" ? `SELECT to_jsonb(public.review_engagement_survey('${campaignId}','${session}',${literal(sessionVersion)},'rejected','SYNTHETIC concurrent survey review','{}'))`
          : kind === "survey_privacy" ? `UPDATE engagement_survey_response_sessions SET metadata_json=metadata_json||'{"visibility":"private"}' WHERE id='${session}'`
          : kind === "approval" ? `SELECT public.retain_engagement_synthesis_approval('${campaignId}','${changeActor}','${workspaceId}',${literal({ ...approved, actorId: changeActor, requestId: id(1001), operation: "withdraw", reason: "SYNTHETIC concurrent approval withdrawal", predecessorId: approved.requestId, predecessorSha256: context.approval.eventSha256 })})`
          : kind === "review" ? `SELECT public.retain_engagement_synthesis_review('${campaignId}','${changeActor}','${workspaceId}',${literal(correction)},'${context.sourceId}','${context.sourceSha256}',NULL,${literal(content)})`
          : statement({ ...intent, actorId: changeActor, requestId: id(1001), operation: "withdraw", expectedContextSha256: null, predecessorId: intent.requestId, predecessorSha256: (saved.data as Receipt).event.eventSha256 }, null, changeActor);
        const changeRole = kind === "survey_review" || kind === "comment" || kind === "parent" || kind === "vote" ? "authenticated" : "service_role";
        let publication: Result;
        if (order === "publication_first") {
          await beginRace(database, actorId);
          publication = await query(publish); expect(publication.error, "publication control failed").toBeNull();
          await beginRace(changer, changeActor);
          if (kind === "comment" || kind === "parent") {
            const pending = changeQuery(change, changeRole);
            try { await observedBlock(database, changerPid, publisherPid); }
            finally { await database.query("COMMIT;"); }
            expect((await pending).error, "source change failed after publication commit").toBeNull();
          } else {
            const busy = await changeQuery(change, changeRole);
            await changer.query("ROLLBACK;");
            await database.query("COMMIT;");
            expect(busy.error?.code, "source change ignored pending publication").toBe("PT503");
            await beginRace(changer, changeActor);
            expect((await changeQuery(change, changeRole)).error, "source retry failed after publication commit").toBeNull();
          }
          await changer.query("COMMIT;");
        } else {
          if (publicationIsolation !== "READ COMMITTED") {
            await beginRace(database, actorId, publicationIsolation);
            await database.query("SELECT count(*) FROM engagement_survey_answers;");
          }
          await beginRace(changer, changeActor);
          expect((await changeQuery(change, changeRole)).error, "source control failed").toBeNull();
          if (publicationIsolation === "READ COMMITTED") await beginRace(database, actorId);
          const pending = query(publish);
          try { await observedBlock(changer, publisherPid, changerPid); }
          finally { await changer.query("COMMIT;"); }
          publication = await pending;
          await database.query("COMMIT;");
          if (publicationIsolation !== "READ COMMITTED") {
            const status = (await database.query(`SELECT status FROM engagement_closeloop_entries WHERE id='${intent.responseId}';`)).at(-1);
            expect({ error: publication.error?.code ?? null, status }, "fixed snapshot committed stale publication").toEqual({ error: "25001", status: "draft" });
          } else expect(publication.error?.code ?? null, "source-first invalid publication accepted").toBe(kind === "vote" ? null : "PT409");
        }
        const expected = kind === "vote" ? "published" : "draft";
        expect(await database.query(`SELECT status FROM engagement_closeloop_entries WHERE id='${intent.responseId}';`), `${order} source change left response published`).toEqual([expected]);
        const withdrawals = order === "publication_first" && kind !== "vote" ? 1 : 0;
        expect(await database.query(`SELECT count(*) FROM engagement_response_write_receipts WHERE response_id='${intent.responseId}' AND operation='source_withdrawal';`), "concurrent withdrawal receipt count differs").toEqual([String(withdrawals)]);
        if (withdrawals) {
          expect(await database.query(`SELECT actor_id::text||':'||change_origin FROM engagement_response_history WHERE response_id='${intent.responseId}' ORDER BY revision DESC LIMIT 1;`), "concurrent withdrawal actor differs").toEqual([`${changeActor}:source_withdrawal`]);
        }
        await beginRace(database, actorId);
        expect((await query(`SELECT public.read_engagement_synthesis_response_link('${campaignId}','${intent.requestId}')`)).data, "concurrent change rewrote original link bytes").toEqual((saved.data as Receipt).event);
        expect((await query(`SELECT public.read_engagement_response_snapshot('${campaignId}',true)`)).data).toMatchObject({ count: kind === "vote" ? 1 : 0 });
        if (order === "publication_first") {
          const replay = await query(publish); expect(replay.error).toBeNull();
          expect(replay.data, "exact publication recovery differs after source change").toEqual({ ...(publication.data as Record<string, unknown>), replayed: true });
          expect((await query(`SELECT to_jsonb(status) FROM engagement_closeloop_entries WHERE id='${intent.responseId}'`, "postgres")).data, "exact publication retry changed current status").toBe(expected);
        }
        await database.query("COMMIT;");
      }, true, target);
    } finally { await changer.close(); }
  });
}

describe.skipIf(!CANDIDATE_RLS)("candidate synthesis concurrent commits", () => {
  it.each(["comment", "parent", "answer", "survey_review", "survey_privacy", "approval", "review", "link", "vote"] as const)("handles publication first: %s", kind => committedRace(kind, "publication_first"), 120_000);
  it.each(["comment", "parent", "answer", "survey_review", "survey_privacy", "approval", "review", "link", "vote"] as const)("handles source first: %s", kind => committedRace(kind, "source_first"), 120_000);
});


describe.skipIf(!CANDIDATE_RLS)("candidate synthesis fixed snapshot publication", () => {
  it("refuses an older repeatable-read snapshot after a concurrent answer commit", () => committedRace("answer", "source_first", undefined, "REPEATABLE READ"), 120_000);
});

const raceCandidate = candidate + "\n" + publicCandidate + "\n" + withdrawalCandidate;
describe.skipIf(!CANDIDATE_RLS)("candidate concurrency fault controls", () => {
  it("accepts a harmless publication comment", () => committedRace("answer", "source_first", raceCandidate + "\n-- Harmless concurrency control.\n", "REPEATABLE READ"), 120_000);
  it.each([
    ["fixed publication snapshot", alterFunction("public.guard_engagement_response_publication()", "NEW.status='published' AND current_setting('transaction_isolation')<>'read committed'", "false"), "source_first", "REPEATABLE READ", "fixed snapshot committed stale publication"],
    ["withdrawal campaign lock", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "hashtextextended('engagement-response:'||p_campaign", "hashtextextended('broken-concurrent-response:'||p_campaign"), "source_first", "READ COMMITTED", "Concurrent writer did not wait on the expected transaction"],
    ["publication campaign lock", alterFunction("public.write_engagement_response(uuid,uuid,text,uuid,timestamp with time zone,text,jsonb)", "PERFORM pg_advisory_xact_lock(hashtextextended('engagement-response:' || p_campaign::text, 0));", ""), "source_first", "READ COMMITTED", "Concurrent writer did not wait on the expected transaction"],
    ["answer reconciliation", "ALTER TABLE engagement_survey_answers DISABLE TRIGGER synthesis_answer_publication;", "publication_first", "READ COMMITTED", "source change ignored pending publication"],
    ["stored withdrawal", alterFunction("public.withdraw_ineligible_synthesis_responses(uuid,uuid,text,jsonb,jsonb)", "AND NOT public.engagement_synthesis_response_public_allowed(p_campaign,e.id,to_jsonb(e))", "AND false"), "publication_first", "READ COMMITTED", "publication_first source change left response published"],
    ["current publication basis", alterFunction("public.guard_engagement_response_publication()", "NEW.status='published' AND NOT public.engagement_synthesis_response_public_allowed(NEW.campaign_id,NEW.id,to_jsonb(NEW))", "false"), "source_first", "READ COMMITTED", "source-first invalid publication accepted"],
  ] as const)("detects %s", async (_name, ddl, order, isolation, assertion) => {
    await expect(committedRace("answer", order, raceCandidate + "\n" + ddl, isolation)).rejects.toThrow(assertion);
  }, 120_000);
});

async function publicationIsolationControl(isolation: string, status: "draft" | "published", linked = true, sql = raceCandidate) {
  const container = resolveLocalDbContainer();
  await withSynthesisProbeDatabase(container, async target => {
    await scenario(sql, async ({ database, query, intent, contextText, statement }) => {
      if (linked) expect((await query(statement(intent, contextText), "service_role")).error).toBeNull();
      const version = (await query(`SELECT to_jsonb(updated_at) FROM engagement_closeloop_entries WHERE id='${intent.responseId}'`, "postgres")).data;
      await database.query("COMMIT;");
      await beginRace(database, actorId, isolation);
      const result = await query(`SELECT public.write_engagement_response('${campaignId}','${id(1010)}','update','${intent.responseId}',${literal(version)},'SYNTHETIC isolation control','{"status":"${status}"}')`);
      expect(result.error?.code ?? null, "publication isolation policy differs").toBe(status === "published" && isolation !== "READ COMMITTED" ? "25001" : null);
      await database.query("COMMIT;");
      expect(await database.query(`SELECT status FROM engagement_closeloop_entries WHERE id='${intent.responseId}';`)).toEqual([status === "published" && isolation === "READ COMMITTED" ? "published" : "draft"]);
    }, true, target);
  });
}
describe.skipIf(!CANDIDATE_RLS)("candidate publication isolation controls", () => {
  it.each(["READ COMMITTED", "REPEATABLE READ"])("checks publication with no visible links under %s", isolation => publicationIsolationControl(isolation, "published", false), 120_000);
  it("detects a guard limited to visible synthesis links", async () => {
    const fault = alterFunction("public.guard_engagement_response_publication()", "NEW.status='published' AND current_setting('transaction_isolation')<>'read committed'", "NEW.status='published' AND current_setting('transaction_isolation')<>'read committed' AND EXISTS(SELECT 1 FROM engagement_synthesis_response_events WHERE response_id=NEW.id)");
    await expect(publicationIsolationControl("REPEATABLE READ", "published", false, raceCandidate + "\n" + fault)).rejects.toThrow("publication isolation policy differs");
  }, 120_000);
  it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])("allows draft edits under %s", isolation => publicationIsolationControl(isolation, "draft"), 120_000);
  it.each(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])("checks publication under %s", isolation => publicationIsolationControl(isolation, "published"), 120_000);
});


describe.skipIf(!LIVE_RLS)("native application link record readers", () => {
  it("verifies native retained link, withdrawal and renewed link receipts and history", async () => {
    await scenario(CANDIDATE_RLS ? raceCandidate : "", async ({ query, intent, contextText, statement }) => {
      const scope = { campaignId, workspaceId, reviewId, responseId: intent.responseId, groupId: intent.groupId };
      const original = await query(statement(intent, contextText), "service_role"); expect(original.error).toBeNull();
      const first = await readSynthesisResponseLinkReceipt(original.data, synthesisResponseLinkIntentSchema.parse(intent));
      expect(first.replayed).toBe(false); expect(first.event.context.contextText).toBe(contextText);
      expect(first.event.eventText, "native event bytes were reserialized").toBe((original.data as Receipt).event.eventText);
      const withdrawal = { ...intent, requestId: id(1100), operation: "withdraw", predecessorId: intent.requestId,
        predecessorSha256: first.event.eventSha256, expectedContextSha256: null };
      const withdrawn = await query(statement(withdrawal, null), "service_role"); expect(withdrawn.error).toBeNull();
      const second = await readSynthesisResponseLinkReceipt(withdrawn.data, synthesisResponseLinkIntentSchema.parse(withdrawal));
      const refresh = { ...intent, requestId: id(1101), operation: "refresh", predecessorId: withdrawal.requestId,
        predecessorSha256: second.event.eventSha256 };
      const renewed = await query(statement(refresh, contextText), "service_role"); expect(renewed.error).toBeNull();
      const third = await readSynthesisResponseLinkReceipt(renewed.data, synthesisResponseLinkIntentSchema.parse(refresh));
      const history = await query(`SELECT public.read_engagement_synthesis_response_links('${campaignId}','${reviewId}','${intent.responseId}',${literal(intent.groupId)})`);
      expect(history.error).toBeNull();
      const verified = await readSynthesisResponseLinkHistory(history.data, scope);
      expect(verified.entries.map(row => row.intent.operation)).toEqual(["link", "withdraw", "refresh"]);
      expect(verified.entries[0].eventText).toBe(first.event.eventText);
      expect(verified.entries[1].context).toEqual(first.event.context);
      expect(verified.head?.eventSha256).toBe(third.event.eventSha256);
      expect(verified.head?.evidence.group.sourceIds).toHaveLength(302);
      const replay = await query(statement(intent, contextText), "service_role"); expect(replay.error).toBeNull();
      const retained = await readSynthesisResponseLinkReceipt(replay.data, synthesisResponseLinkIntentSchema.parse(intent));
      expect(retained.replayed).toBe(true); expect(retained.event.eventText).toBe(first.event.eventText);
    }, true);
  }, 60_000);
});


describe.skipIf(!LIVE_RLS)("native application link write recovery", () => {
  it("retains exact native context, refreshes, withdraws after removal and denies departed staff recovery", async () => {
    await scenario(CANDIDATE_RLS ? raceCandidate : "", async ({ database, client, service, query, intent, contextText }) => {
      const scope = { campaignId, workspaceId, reviewId, responseId: intent.responseId, groupId: intent.groupId };
      const text = "\n" + contextText, command = { intent: { ...intent, expectedContextSha256: hash(text) }, contextText: text };
      const first = await retainSynthesisResponseLink(client, service, actor, command);
      expect(first.event.context.contextText).toBe(text); expect(first.replayed).toBe(false);
      const before = JSON.parse(first.event.evidence.context.responseHistory.recordText) as { updated_at: string };
      expect((await query(`SELECT public.write_engagement_response('${campaignId}','${id(1200)}','update','${intent.responseId}',${literal(before.updated_at)},'SYNTHETIC corrected response','{"we_did":"SYNTHETIC changed response"}')`)).error).toBeNull();
      expect((await retainSynthesisResponseLink(client, service, actor, command)).replayed).toBe(true);
      const current = await loadSynthesisResponseContext(client, scope);
      const refresh = { ...intent, requestId: id(1201), operation: "refresh", predecessorId: intent.requestId,
        predecessorSha256: first.event.eventSha256, expectedContextSha256: current.packet.contextSha256 };
      const second = await retainSynthesisResponseLink(client, service, actor, { intent: refresh, contextText: current.packet.contextText });
      expect(second.event.eventNo).toBe(2);
      expect((await query(`SELECT public.write_engagement_response('${campaignId}','${id(1202)}','remove','${intent.responseId}',${literal(current.response.updated_at)},'SYNTHETIC removed response','{}')`)).error).toBeNull();
      const withdrawal = { ...intent, requestId: id(1203), operation: "withdraw", predecessorId: refresh.requestId,
        predecessorSha256: second.event.eventSha256, expectedContextSha256: null };
      const third = await retainSynthesisResponseLink(client, service, actor, { intent: withdrawal, contextText: null });
      expect(third.event.context).toEqual(second.event.context);
      const retained = await loadSynthesisResponseLinkHistory(client, scope);
      expect(retained.entries.map(row => row.intent.operation)).toEqual(["link", "refresh", "withdraw"]);
      expect(retained.entries[0].eventText).toBe(first.event.eventText);
      expect((await retainSynthesisResponseLink(client, service, actor, command)).event.eventText).toBe(first.event.eventText);
      await database.query(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='${actorId}';`);
      await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "forbidden" });
    }, true);
  }, 60_000);
  it("recovers the exact saved native request after a simulated lost acknowledgement", async () => {
    const container = resolveLocalDbContainer();
    await withSynthesisProbeDatabase(container, async target => {
      await scenario(CANDIDATE_RLS ? raceCandidate : "", async ({ database, query, intent, contextText }) => {
        await database.query("COMMIT;");
        const makeClient = (role: string) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
          const keys = signatures[name]; if (!keys) throw new Error("Unexpected committed application RPC");
          expect(Object.keys(args).sort()).toEqual([...keys].sort());
          await beginRace(database, actorId);
          const result = await query(`SELECT public.${name}(${keys.map(key => literal(args[key])).join(",")})`, role);
          await database.query("COMMIT;");
          return result;
        } }) as unknown as Pick<SupabaseClient, "rpc">;
        const client = makeClient("authenticated"), service = makeClient("service_role");
        let writes = 0;
      const interrupted = { rpc: async (...args: Parameters<typeof service.rpc>) => {
        writes++; const result = await service.rpc(...args); expect(result.error).toBeNull();
        throw new Error("SYNTHETIC lost native acknowledgement");
      } } as unknown as Pick<SupabaseClient, "rpc">;
      const receipt = await retainSynthesisResponseLink(client, interrupted, actor, { intent, contextText });
      expect(receipt.replayed).toBe(true); expect(writes).toBe(1);
      const reader = rollbackSqlConnection(container, target);
      try {
        expect(await reader.query(`SELECT count(*) FROM engagement_synthesis_response_events WHERE id='${intent.requestId}';`), "committed acknowledgement recovery duplicated or lost the event").toEqual(["1"]);
      } finally { await reader.close(); }
      expect(receipt.event.context.contextText).toBe(contextText);
      }, true, target);
    });
  }, 120_000);
});


const indexCandidate = readFileSync("../docs/reviews/2026-09-27-synthesis-response-links/synthesis-response-index.candidate.sql", "utf8");
describe.skipIf(!LIVE_RLS)("native retained link navigation and compact commands", () => {
  it("discovers retained links after response and review group removal, including withdrawal and old retry", async () => {
    await scenario(CANDIDATE_RLS ? raceCandidate + indexCandidate : "", async ({ database, client, service, query, intent }) => {
      expect(await loadSynthesisResponseLinkIndex(client, address)).toEqual({ ...address, entryCount: 0, entries: [] });
      expect(await loadSynthesisResponseLinkIndex(client, { ...address, reviewId: id(990) })).toBeNull();
      const first = await retainSynthesisResponseLinkCommand(client, service, actor, intent);
      const source = await loadSynthesisSource(client, { campaignId, workspaceId, requestId: sourceId });
      await retainSynthesisReview(client, service, campaignId, { requestId: id(1303), actorId, workspaceId, operation: "create", sourceId, sourceSha256: source.snapshotSha256 });
      const otherReview = { ...address, reviewId: id(1303) };
      expect(await loadSynthesisResponseLinkIndex(client, otherReview), "another retained review inherited these links").toEqual({ ...otherReview, entryCount: 0, entries: [] });
      const secondResponse = await writeResponse(client, campaignId, { operation: "create", body: { requestId: id(1304), themeTitle: "SYNTHETIC second linked response", weDid: "SYNTHETIC second answer" } });
      expect(secondResponse.error).toBeNull();
      const secondScope = { ...address, responseId: secondResponse.result!.entryId, groupId: intent.groupId };
      const secondContext = await loadSynthesisResponseContext(client, secondScope);
      await retainSynthesisResponseLinkCommand(client, service, actor, { ...intent, ...secondScope, requestId: id(1305), expectedContextSha256: secondContext.packet.contextSha256 });
      const entries = [intent.responseId, secondScope.responseId].sort().map(responseId => ({ responseId, groupId: intent.groupId }));
      const expected = { ...address, entryCount: 2, entries };
      expect(await loadSynthesisResponseLinkIndex(client, address)).toEqual(expected);
      const context = first.event.evidence.context, row = JSON.parse(context.responseHistory.recordText) as { updated_at: string };
      expect((await query(`SELECT public.write_engagement_response('${campaignId}','${id(1300)}','remove','${intent.responseId}',${literal(row.updated_at)},'SYNTHETIC removed linked response','{}')`)).error).toBeNull();
      const current = (await loadSynthesisReview(client, address))!;
      await retainSynthesisReview(client, service, campaignId, { requestId: id(1301), actorId, workspaceId, operation: "correct", reviewId,
        expectedRevisionId: current.revision.requestId, expectedRevisionSha256: current.revision.contentSha256, reason: "SYNTHETIC remove retained group",
        change: { kind: "group_remove", groupId: intent.groupId } });
      expect(await loadSynthesisResponseLinkIndex(client, address), "retained address disappeared with live response or group").toEqual(expected);
      expect((await retainSynthesisResponseLinkCommand(client, service, actor, intent)).event.eventText).toBe(first.event.eventText);
      const withdrawal = { ...intent, requestId: id(1302), operation: "withdraw", expectedContextSha256: null,
        predecessorId: intent.requestId, predecessorSha256: first.event.eventSha256 };
      const removed = await retainSynthesisResponseLinkCommand(client, service, actor, withdrawal);
      expect(removed.event.context).toEqual(first.event.context);
      expect(await loadSynthesisResponseLinkIndex(client, address), "withdrawal duplicated or removed navigation address").toEqual(expected);
      for (const role of ["anon", "service_role"]) {
        expect((await query(`SELECT public.list_engagement_synthesis_response_links('${campaignId}','${reviewId}')`, role)).error?.code, `index exposed to ${role}`).toBe("42501");
      }
      await database.query(`SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);`);
      await expect(loadSynthesisResponseLinkIndex(client, address)).rejects.toMatchObject({ kind: "forbidden" });
      // The source-custody fixture promotes this second account to owner. Restore the role under test.
      await database.query(`UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';`);
      await database.query(`SELECT set_config('request.jwt.claim.sub','7a50d4fb-35b7-41f4-9bce-8a4e7d157569',true);`);
      await expect(loadSynthesisResponseLinkIndex(client, address)).rejects.toMatchObject({ kind: "forbidden" });
    }, true);
  }, 60_000);
});


// These contracts execute against the installed schema. No candidate DDL supplies missing objects.
describe.skipIf(!LIVE_RLS || CANDIDATE_RLS)("installed synthesis response links", () => {
  it("retains complete private links, corrections, withdrawals and exact retries", () => scenario(""), 60_000);
  it("accepts an installed harmless comment control", () => scenario("-- Harmless installed control.\n"), 60_000);
  it("checks installed public reads, stored withdrawals and original report custody", () => publicScenario("", true, true, true), 60_000);
  it("accepts an installed public harmless comment", () => publicScenario("-- Harmless installed public control.\n", true, true, true), 60_000);
  it.each(nativeDdlFaults)("detects installed %s", async (_name, sql, assertion) => {
    await expect(scenario(sql)).rejects.toThrow(assertion);
  }, 60_000);
  it.each(withdrawalFaults)("detects installed %s", async (_name, sql, assertion) => {
    await expect(publicScenario(sql, true, false, true)).rejects.toThrow(assertion);
  }, 60_000);
  it.each(faults)("detects installed %s", async (_name, before, after, assertion) => {
    const signature = ["approval head", "approval withdrawal", "selected group"].includes(_name)
      ? "public.engagement_synthesis_response_current(uuid,uuid,uuid,uuid,text)"
      : "public.retain_engagement_synthesis_response_link(uuid,uuid,uuid,jsonb,text)";
    await expect(scenario(alterFunction(signature, before, after))).rejects.toThrow(assertion);
  }, 60_000);
  it.each(["publication_first", "source_first"] as const)("serializes installed answer correction: %s", order => committedRace("answer", order, ""), 120_000);
  it("refuses installed fixed snapshots after a concurrent answer commit", () => committedRace("answer", "source_first", "", "REPEATABLE READ"), 120_000);
});

// Preactivation probes opt in explicitly; normal live QA requires the installed migration.
const decisionSynthesisMigration = [
  "20261014000030_engagement_decision_synthesis_history.sql",
  "20261014000031_engagement_decision_resolution_guard.sql",
  "20261014000032_application_temporary_schema_order.sql",
].map(name => readFileSync(`supabase/migrations/${name}`, "utf8")).join("\n");
const DECISION_SYNTHESIS_CANDIDATE = process.env.OPENPLAN_DECISION_SYNTHESIS_CANDIDATE === "1";
const decisionSynthesisSetup = DECISION_SYNTHESIS_CANDIDATE ? decisionSynthesisMigration : "";
async function decisionSynthesisScenario(sql = decisionSynthesisSetup) {
  await scenario(sql, async ({ database, query, client, service, intent, contextText, statement }) => {
    const decisionId = id(801), decisionScope = { ...actor, responseId: intent.responseId, decisionId };
    await database.query(`INSERT INTO project_decisions(id,project_id,title,rationale,status)
      VALUES('${decisionId}','cf0b2bac-b1b0-4032-8f37-748f0c67a5b3','SYNTHETIC decision','SYNTHETIC rationale','proposed');`);
    const preview = async () => {
      const result = await loadDecisionContext(client, decisionScope);
      expect(result.error, "native decision preview failure").toBeNull();
      return (await readDecisionContext(result.packet, decisionScope));
    };
    const empty = await preview();
    expect(empty.context, "new decision capture omitted observed zero").toMatchObject({ schema: 2, synthesisHistory: { historyCount: 0, eventCount: 0, histories: [] } });
    const command: DecisionLinkIntent = { requestId: id(802), responseId: intent.responseId, decisionId, operation: "link", predecessorId: null,
      expectedContextSha256: empty.packet.contextSha256, reason: "SYNTHETIC original decision evidence" };
    // The command must honor the exact campaign lock used by synthesis-link writes.
    const competitor = rollbackSqlConnection(resolveLocalDbContainer());
    try {
      await competitor.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('engagement-response:${campaignId}',0));`);
      expect((await writeDecisionLink(client, actor, command)).error?.status, "decision ignored response serialization").toBe(503);
    } finally { await competitor.close(); }
    const original = await writeDecisionLink(client, actor, command);
    expect(original.error, "original decision save failure").toBeNull();
    expect(original.receipt!.link.context_text).toBe(empty.packet.contextText);
    const first = await query(statement(intent, contextText), "service_role"); expect(first.error).toBeNull();
    const linked = await preview();
    expect(linked.context, "synthesis link missing from decision preview").toMatchObject({ schema: 2, synthesisHistory: { historyCount: 1, eventCount: 1 } });
    if (linked.context.schema !== 2) throw new Error("New decision context lost version two");
    expect(linked.context.synthesisHistory.histories[0].entries).toEqual([(first.data as Receipt).event]);
    const refresh: DecisionLinkIntent = { ...command, requestId: id(803), operation: "refresh", predecessorId: command.requestId };
    expect((await writeDecisionLink(client, actor, refresh)).error?.status, "stale synthesis preview accepted").toBe(409);
    refresh.expectedContextSha256 = linked.packet.contextSha256;
    const refreshed = await writeDecisionLink(client, actor, refresh); expect(refreshed.error).toBeNull();
    expect((await writeDecisionLink(client, actor, command)).receipt, "old exact decision receipt lost").toEqual({ ...original.receipt, replayed: true });
    const close = { ...intent, requestId: id(810), operation: "withdraw", predecessorId: intent.requestId,
      predecessorSha256: (first.data as Receipt).event.eventSha256, expectedContextSha256: null };
    const withdrawn = await query(statement(close, null), "service_role"); expect(withdrawn.error).toBeNull();
    const afterWithdrawal = await preview();
    expect(afterWithdrawal.context, "withdrawn synthesis events disappeared").toMatchObject({ schema: 2, synthesisHistory: { historyCount: 1, eventCount: 2 } });
    if (afterWithdrawal.context.schema !== 2) throw new Error("New decision context lost version two");
    expect(afterWithdrawal.context.synthesisHistory.histories[0].entries, "retained event order differs").toEqual([(first.data as Receipt).event, (withdrawn.data as Receipt).event]);
    // A different response on the same review must never enter this response's evidence.
    const otherResponse = await writeResponse(client, campaignId, { operation: "create", body: { requestId: id(811), themeTitle: "SYNTHETIC unrelated response", weDid: "SYNTHETIC other answer" } });
    expect(otherResponse.error).toBeNull();
    const otherScope = { ...address, responseId: otherResponse.result!.entryId, groupId: intent.groupId };
    const otherContext = await loadSynthesisResponseContext(client, otherScope);
    const otherLink = { ...intent, ...otherScope, requestId: id(812), expectedContextSha256: otherContext.packet.contextSha256 };
    expect((await query(statement(otherLink, otherContext.packet.contextText), "service_role")).error).toBeNull();
    expect((await preview()).packet, "foreign response history leaked into decision").toEqual(afterWithdrawal.packet);
    // Retain an independent review address, without relying on today's group list.
    const savedContext = JSON.parse(contextText), secondReview = id(820);
    await retainSynthesisReview(client, service, campaignId, { requestId: secondReview, actorId, workspaceId, operation: "create", sourceId, sourceSha256: savedContext.sourceSha256 });
    const state = (await loadSynthesisApprovalState(client, { ...address, reviewId: secondReview }))!;
    await retainSynthesisApproval(client, service, actor, { ...state.current, actorId, requestId: id(821), operation: "approve", reason: "SYNTHETIC second review", predecessorId: null, predecessorSha256: null });
    const reviewed = (await loadSynthesisReview(client, { ...address, reviewId: secondReview }))!;
    const secondScope = { ...address, reviewId: secondReview, responseId: intent.responseId, groupId: reviewed.content.groups[0].id };
    const secondContext = await loadSynthesisResponseContext(client, secondScope);
    const secondLink = { ...intent, ...secondScope, requestId: id(822), expectedContextSha256: secondContext.packet.contextSha256 };
    expect((await query(statement(secondLink, secondContext.packet.contextText), "service_role")).error).toBeNull();
    const complete = await preview();
    expect(complete.context, "second retained review disappeared").toMatchObject({ schema: 2, synthesisHistory: { historyCount: 2, eventCount: 3 } });
    await verifyDecisionSynthesisSources(complete.context);
    const oldReview = (await loadSynthesisReview(client, address))!;
    await retainSynthesisReview(client, service, campaignId, { requestId: id(824), actorId, workspaceId, operation: "correct", reviewId,
      expectedRevisionId: oldReview.revision.requestId, expectedRevisionSha256: oldReview.revision.contentSha256, reason: "SYNTHETIC remove withdrawn review group",
      change: { kind: "group_remove", groupId: intent.groupId } });
    expect((await preview()).packet, "removed review group lost retained decision history").toEqual(complete.packet);
    // Current source correction cannot replace the words already captured in a link.
    await database.query(`UPDATE engagement_items SET body='SYNTHETIC later correction',status='rejected',review_expected_updated_at=updated_at,review_reason='SYNTHETIC later source review' WHERE id='b0000000-0000-4000-8000-000000000001';`);
    expect((await preview()).packet, "current source correction changed retained synthesis evidence").toEqual(complete.packet);
    const finalCommand = { ...refresh, requestId: id(823), predecessorId: refresh.requestId, expectedContextSha256: complete.packet.contextSha256 };
    const final = await writeDecisionLink(client, actor, finalCommand); expect(final.error).toBeNull();
    const retained = await readDecisionLink(final.receipt!.link, actor); await verifyDecisionSynthesisSources(retained.context);
    // Capture stays private even when the caller tries the original version-one helper.
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await query(`SELECT public.engagement_response_decision_context_v1('${campaignId}','${intent.responseId}','${decisionId}')`, role)).error?.code, "legacy helper grant exposed").toBe("42501");
    }
    for (const role of ["anon", "service_role"]) {
      expect((await query(`SELECT public.read_engagement_response_decision_context('${campaignId}','${intent.responseId}','${decisionId}')`, role)).error?.code, "new private preview grant exposed").toBe("42501");
    }
    await database.query(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';`);
    expect(await database.query(`SELECT role FROM workspace_members WHERE workspace_id='${workspaceId}' AND user_id='7a50d4fb-35b7-41f4-9bce-8a4e7d157569';`)).toEqual(["viewer"]);
    for (const user of ["7a50d4fb-35b7-41f4-9bce-8a4e7d157569", "14a71429-1cb2-49b5-8711-c696a2f394c3"]) {
      await database.query(`SELECT set_config('request.jwt.claim.sub','${user}',true);`);
      expect((await query(`SELECT public.read_engagement_response_decision_context('${campaignId}','${intent.responseId}','${decisionId}')`)).error?.code, "viewer or foreign actor preview exposed").toBe("42501");
    }
  });
}

/** Faults replace one installed function inside the surrounding rollback transaction. */
function decisionSynthesisFault(before: string, after: string) {
  if (before === "FROM PUBLIC, anon, authenticated, service_role;") return "GRANT EXECUTE ON FUNCTION public.engagement_response_decision_context_v1(uuid,uuid,uuid) TO authenticated;";
  const writer = before.includes("engagement-response:") || before.includes("transaction_isolation");
  const signature = writer ? "public.write_engagement_response_decision_link(uuid,uuid,uuid,uuid,text,uuid,text,text)"
    : "public.read_engagement_response_decision_context(uuid,uuid,uuid)";
  return `DO $fault$ DECLARE definition text; BEGIN SELECT pg_get_functiondef('${signature}'::regprocedure) INTO definition;
    IF position(${literal(before)} IN definition)=0 THEN RAISE EXCEPTION 'Native decision fault target missing'; END IF;
    EXECUTE replace(definition,${literal(before)},${literal(after)}); END $fault$;`;
}

describe.skipIf(!LIVE_RLS)("decision synthesis capture", () => {
  it("captures complete retained chains and keeps originals private", () => decisionSynthesisScenario(), 120_000);
  it("survives a harmless migration comment", () => decisionSynthesisScenario("-- Harmless decision history control.\n" + decisionSynthesisSetup), 120_000);
  it.each([
    ["missing synthesis events", "WHERE campaign_id = p_campaign AND workspace_id = workspace AND response_id = p_response", "WHERE false AND campaign_id = p_campaign AND workspace_id = workspace AND response_id = p_response", "synthesis link missing"],
    ["lost withdrawals", "FROM public.engagement_synthesis_response_events\n    WHERE", "FROM public.engagement_synthesis_response_events\n    WHERE operation <> 'withdraw' AND", "withdrawn synthesis events disappeared"],
    ["foreign response inventory", "AND response_id = p_response", "", "native decision preview failure"],
    ["reversed history", "'eventSha256', event_sha256) ORDER BY event_no)", "'eventSha256', event_sha256) ORDER BY event_no DESC)", "native decision preview failure"],
    ["wrong shared lock", "'engagement-response:' || p_campaign::text", "'synthetic-wrong-response:' || p_campaign::text", "decision ignored response serialization"],
    ["legacy helper exposure", "FROM PUBLIC, anon, authenticated, service_role;", "FROM PUBLIC, anon, service_role;", "legacy helper grant exposed"],
  ])("detects %s", async (_name, before, after, expected) => {
    expect(decisionSynthesisMigration.includes(before)).toBe(true);
    await expect(decisionSynthesisScenario(decisionSynthesisSetup + "\n" + decisionSynthesisFault(before, after))).rejects.toThrow(expected);
  }, 120_000);
});

async function decisionSynthesisSnapshotRace(sql = decisionSynthesisSetup, isolation = "REPEATABLE READ") {
  const container = resolveLocalDbContainer();
  await withSynthesisProbeDatabase(container, async target => {
    const reader = rollbackSqlConnection(container, target);
    try {
      await scenario(sql, async ({ database, query, intent, contextText, statement }) => {
        const decisionId = id(840), legacyRequest = id(841), reason = "SYNTHETIC retained version-one intent";
        const scope = { ...actor, responseId: intent.responseId, decisionId };
        await database.query(`INSERT INTO project_decisions(id,project_id,title,rationale,status)
          VALUES('${decisionId}','cf0b2bac-b1b0-4032-8f37-748f0c67a5b3','SYNTHETIC legacy decision','SYNTHETIC original rationale','proposed');
          WITH packet AS (SELECT public.engagement_response_decision_context_v1('${campaignId}','${intent.responseId}','${decisionId}') AS value)
          INSERT INTO engagement_response_decision_links(id,workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text)
          SELECT '${legacyRequest}','${workspaceId}','${campaignId}','${intent.responseId}','${decisionId}','cf0b2bac-b1b0-4032-8f37-748f0c67a5b3',NULL,'link','${actorId}','${reason}',
            jsonb_build_object('campaignId','${campaignId}','responseId','${intent.responseId}','decisionId','${decisionId}',
              'operation','link','predecessorId',NULL,'expectedContextSha256',value->>'contextSha256','reason','${reason}'),value->>'contextText' FROM packet;
          COMMIT;`);
        await reader.query(rpcAdapter);
        await beginRace(reader, actorId, isolation);
        const read = raceQuery(reader);
        const legacy = (await reader.query(`SELECT to_jsonb(l)||jsonb_build_object('payload_text',payload_json::text)
          FROM engagement_response_decision_links l WHERE id='${legacyRequest}';`)).map(value => JSON.parse(value))[0];
        const retained = await readDecisionLink(legacy, actor); expect(retained.context.schema).toBe(1);
        const preview = await read(`SELECT public.read_engagement_response_decision_context('${campaignId}','${intent.responseId}','${decisionId}')`);
        expect(preview.error).toBeNull();
        const observed = await readDecisionContext(preview.data, scope);
        expect(observed.context).toMatchObject({ schema: 2, synthesisHistory: { eventCount: 0 } });
        // Commit after the second session has established its transaction snapshot.
        await beginRace(database, actorId);
        expect((await query(statement(intent, contextText), "service_role")).error).toBeNull();
        await database.query("COMMIT;");
        const command = (request: string, operation: string, previous: string | null, digest: string | null) =>
          `SELECT public.write_engagement_response_decision_link('${campaignId}','${intent.responseId}','${decisionId}',
            '${request}','${operation}',${literal(previous)},${literal(digest)},'${reason}')`;
        const replay = await read(command(legacyRequest, "link", null, retained.context_sha256));
        expect(replay.error, "legacy exact retry was blocked by new capture guards").toBeNull();
        expect(replay.data, "legacy exact retry changed saved bytes").toEqual({ link: legacy, replayed: true });
        const newCapture = await read(command(id(842), "refresh", legacyRequest, observed.packet.contextSha256));
        expect(newCapture.error?.code, "stale transaction captured incomplete synthesis history").toBe("PT409");
        // Withdrawal does not consult current context and retains the exact version-one packet.
        const withdrawal = await read(command(id(843), "withdraw", legacyRequest, null));
        expect(withdrawal.error, "legacy withdrawal was blocked by new capture guards").toBeNull();
        expect((withdrawal.data as { link: { context_text: string } }).link.context_text).toBe(legacy.context_text);
      }, false, target);
    } finally { await reader.close(); }
  });
}

describe.skipIf(!LIVE_RLS)("decision synthesis transaction snapshots", () => {
  it.each(["READ COMMITTED", "REPEATABLE READ"])("refuses stale capture while preserving old retries and withdrawals under %s", isolation => decisionSynthesisSnapshotRace(decisionSynthesisSetup, isolation), 120_000);
  it("accepts a harmless transaction comment", () => decisionSynthesisSnapshotRace("-- Harmless snapshot control.\n" + decisionSynthesisSetup), 120_000);
  it("detects fixed-snapshot guard removal", async () => {
    const before = "IF current_setting('transaction_isolation') <> 'read committed' THEN";
    expect(decisionSynthesisMigration.includes(before)).toBe(true);
    await expect(decisionSynthesisSnapshotRace(decisionSynthesisSetup + "\n" + decisionSynthesisFault(before, "IF false THEN"))).rejects.toThrow("stale transaction captured incomplete synthesis history");
  }, 120_000);
});

async function decisionSynthesisUpgrade(sql = decisionSynthesisMigration) {
  await scenario("", async ({ database, client, intent }) => {
    const decisionId = id(850), scope = { ...actor, responseId: intent.responseId, decisionId };
    await database.query(`INSERT INTO project_decisions(id,project_id,title,rationale,status)
      VALUES('${decisionId}','cf0b2bac-b1b0-4032-8f37-748f0c67a5b3','SYNTHETIC upgrade decision','SYNTHETIC upgrade rationale','proposed');
      PREPARE synthetic_decision_preview AS SELECT public.read_engagement_response_decision_context('${campaignId}','${intent.responseId}','${decisionId}');`);
    const oldId = await database.query("SELECT 'public.read_engagement_response_decision_context(uuid,uuid,uuid)'::regprocedure::oid;");
    const originalPacket = JSON.parse((await database.query("EXECUTE synthetic_decision_preview;"))[0]);
    const original = await readDecisionContext(originalPacket, scope); expect(original.context.schema).toBe(1);
    const command: DecisionLinkIntent = { requestId: id(851), responseId: intent.responseId, decisionId, operation: "link", predecessorId: null,
      expectedContextSha256: original.packet.contextSha256, reason: "SYNTHETIC actual pre-upgrade write" };
    const saved = await writeDecisionLink(client, actor, command); expect(saved.error).toBeNull();
    await database.query(sql);
    const packet = JSON.parse((await database.query("EXECUTE synthetic_decision_preview;"))[0]);
    expect((await readDecisionContext(packet, scope)).context, "prepared preview stayed on the old capture format").toMatchObject({ schema: 2, synthesisHistory: { eventCount: 0 } });
    expect(await database.query("SELECT 'public.read_engagement_response_decision_context(uuid,uuid,uuid)'::regprocedure::oid;"), "upgrade replaced the authenticated entry point identity").toEqual(oldId);
    expect((await writeDecisionLink(client, actor, command)).receipt, "upgrade changed the original saved receipt").toEqual({ ...saved.receipt, replayed: true });
    const rows = await database.query(`SELECT context_text FROM engagement_response_decision_links WHERE id='${command.requestId}';`);
    expect(rows).toEqual([original.packet.contextText]);
  });
}

describe.skipIf(!LIVE_RLS || !DECISION_SYNTHESIS_CANDIDATE)("preactivation decision synthesis upgrade", () => {
  it("preserves actual old writes and prepared entry points", () => decisionSynthesisUpgrade(), 120_000);
  it("accepts a harmless upgrade comment", () => decisionSynthesisUpgrade("-- Harmless upgrade control.\n" + decisionSynthesisMigration), 120_000);
  it("detects replacement of the existing entry point", async () => {
    const before = "CREATE OR REPLACE FUNCTION public.read_engagement_response_decision_context(";
    expect(decisionSynthesisMigration.split(before)).toHaveLength(2);
    const after = "ALTER FUNCTION public.read_engagement_response_decision_context(uuid,uuid,uuid) RENAME TO synthetic_old_decision_context;\nCREATE FUNCTION public.read_engagement_response_decision_context(";
    await expect(decisionSynthesisUpgrade(decisionSynthesisMigration.replace(before, after))).rejects.toThrow(/prepared preview stayed|entry point identity/);
  }, 120_000);
});
