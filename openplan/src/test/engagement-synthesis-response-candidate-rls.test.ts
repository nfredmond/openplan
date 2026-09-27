import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadSynthesisApprovalState, retainSynthesisApproval } from "@/lib/engagement/synthesis-approval-server";
import { loadSynthesisReview, retainSynthesisReview } from "@/lib/engagement/synthesis-review-server";
import { loadSynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { loadSynthesisResponseContext } from "@/lib/engagement/synthesis-response-links-server";
import { readSynthesisResponseContext } from "@/lib/engagement/synthesis-response-context-server";
import { writeResponse } from "@/lib/engagement/response-write";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";

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
  write_engagement_response: ["p_campaign", "p_request", "p_operation", "p_response", "p_expected_updated_at", "p_reason", "p_changes"],
};
type Packet = { eventText: string; eventSha256: string };
type Receipt = { event: Packet; replayed: boolean };
type Intent = typeof actor & { requestId: string; reviewId: string; responseId: string; groupId: string;
  operation: string; reason: string; predecessorId: string | null; predecessorSha256: string | null; expectedContextSha256: string | null };
type NativeProbe = { database: ReturnType<typeof rollbackSqlConnection>; query: (statement: string, role?: string) => Promise<Result>;
  intent: Intent; contextText: string; statement: (value: unknown, text: string | null, who?: string, workspace?: string) => string };
type Result = { data: unknown; error: { code: string; message: string } | null };

/** Candidate DDL and synthetic fixtures remain in one rollback transaction on the named isolated stack. */
async function scenario(sql = candidate, probe?: (native: NativeProbe) => Promise<void>) {
  const database = rollbackSqlConnection(resolveLocalDbContainer());
  try {
    await database.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';
      ${sql}
      ${probe ? `CREATE TEMP TABLE original_link_lock_functions AS SELECT p.oid,pg_get_functiondef(p.oid) AS body
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
        AND (p.prosrc LIKE '%engagement-response:%' OR p.prosrc LIKE '%engagement-synthesis-review:%');
        DO $setup$ DECLARE row record; BEGIN FOR row IN SELECT body FROM original_link_lock_functions LOOP
          EXECUTE replace(replace(row.body,'engagement-response:','synthetic-setup-response:'),'engagement-synthesis-review:','synthetic-setup-review:');
        END LOOP; END $setup$;` : ""}
      ${readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8")}
      CREATE FUNCTION pg_temp.link_rpc(statement text) RETURNS jsonb LANGUAGE plpgsql AS $rpc$
      DECLARE value jsonb; code text; message text; BEGIN
        BEGIN EXECUTE statement INTO value;
        EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
          RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('code',code,'message',message)); END;
        RETURN jsonb_build_object('data',value,'error',NULL);
      END $rpc$;`);
    const query = async (statement: string, role = "authenticated"): Promise<Result> => {
      const rows = await database.query(`SET LOCAL ROLE ${role}; SELECT pg_temp.link_rpc(${literal(statement)}); RESET ROLE;`);
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
        addSourceIds: all.filter(key => !group.sourceIds.includes(key)), removeSourceIds: [] } });
    const state = (await loadSynthesisApprovalState(client, address))!;
    const approval = await retainSynthesisApproval(client, service, actor, { ...state.current, actorId, requestId: id(3), operation: "approve",
      reason: "SYNTHETIC reviewed source wording", predecessorId: null, predecessorSha256: null });
    const created = await writeResponse(client, campaignId, { operation: "create", body: { requestId: id(4), themeTitle: "SYNTHETIC response", weDid: "SYNTHETIC original answer 中文" } });
    expect(created.error).toBeNull();
    const responseId = created.result!.entryId, groupId = group.id, scope = { ...address, responseId, groupId };
    const context = await loadSynthesisResponseContext(client, scope);
    expect(context.group.sourceIds).toHaveLength(303);
    const intent: Intent = { ...actor, ...scope, requestId: id(10), operation: "link", reason: "SYNTHETIC private linkage",
      predecessorId: null, predecessorSha256: null, expectedContextSha256: context.packet.contextSha256 };
    const statement = (value: unknown, text: string | null, who = actorId, workspace = workspaceId) =>
      `SELECT public.retain_engagement_synthesis_response_link(${literal(campaignId)},${literal(who)},${literal(workspace)},${literal(value)},${literal(text)})`;
    const write = (value: unknown, text = context.packet.contextText, who = actorId, workspace = workspaceId) => query(statement(value, text, who, workspace), "service_role");
    if (probe) {
      // Setup commands took different advisory keys. Restore every production definition before testing real locks.
      await database.query(`DO $restore$ DECLARE row record; BEGIN FOR row IN SELECT body FROM original_link_lock_functions LOOP EXECUTE row.body; END LOOP; END $restore$;`);
      await probe({ database, query, intent, contextText: context.packet.contextText, statement });
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

describe.skipIf(!LIVE_RLS)("candidate native synthesis response links", () => {
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

describe.skipIf(!LIVE_RLS)("candidate native synthesis response fault controls", () => {
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

describe.skipIf(!LIVE_RLS)("candidate synthesis response access and history fault controls", () => {
  it.each(nativeDdlFaults)("detects %s", async (_name, ddl, assertion) => {
    await expect(scenario(candidate + "\n" + ddl)).rejects.toThrow(assertion);
  }, 60_000);
});
