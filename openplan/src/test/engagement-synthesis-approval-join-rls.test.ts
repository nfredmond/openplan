import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadSynthesisApprovalState, retainSynthesisApproval } from "@/lib/engagement/synthesis-approval-server";
import { loadSynthesisReview, retainSynthesisReview } from "@/lib/engagement/synthesis-review-server";
import { loadSynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { synthesisApprovalForRevision, type SynthesisApprovalIntent } from "@/lib/engagement/synthesis-approval";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { rollbackSqlConnection } from "./helpers/rollback-sql-connection";

const campaignId = "10c5cdd7-16c6-4b91-b9c0-d2f67598a54f", workspaceId = "d51d566d-28c6-49d2-95d2-3a7a2f0902e1";
const actorId = "13466ed2-dcb7-4861-a528-68cc5579eea9", sourceId = "d0000000-0000-4000-8000-000000000002";
const reviewId = "e4000000-0000-4000-8000-000000000001", correctedId = "e4000000-0000-4000-8000-000000000002";
const requestId = "f4000000-0000-4000-8000-000000000001", withdrawalId = "f4000000-0000-4000-8000-000000000002", renewedId = "f4000000-0000-4000-8000-000000000003";
const actor = { campaignId, workspaceId, actorId }, address = { campaignId, workspaceId, reviewId };
const literal = (value: unknown) => value === null ? "NULL" : "'" + String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''") + "'";
const signatures: Record<string, string[]> = {
  read_engagement_synthesis_sources: ["p_campaign", "p_request"],
  read_engagement_synthesis_review: ["p_campaign", "p_review", "p_revision"],
  retain_engagement_synthesis_review: ["p_campaign", "p_actor", "p_workspace", "p_intent", "p_source", "p_source_sha256", "p_preparation_text", "p_content_text"],
  read_engagement_synthesis_approval: ["p_campaign", "p_request"],
  read_engagement_synthesis_approval_history: ["p_campaign", "p_review"],
  retain_engagement_synthesis_approval: ["p_campaign", "p_actor", "p_workspace", "p_intent"],
};

describe.skipIf(!LIVE_RLS)("native synthesis approval application join", () => {
  it.each(["baseline", "harmless SQL comment", "corrupt rehashed revision reference"])("uses real source, review and approval RPCs through the production server: %s", async mode => {
    const database = rollbackSqlConnection(resolveLocalDbContainer());
    try {
      const candidate = process.env.OPENPLAN_SYNTHESIS_APPROVAL_CANDIDATE === "1" ? readFileSync("supabase/migrations/20261014000028_engagement_synthesis_approvals.sql", "utf8") : "";
      await database.query(`BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';\n${candidate}\n${readFileSync("src/test/fixtures/engagement/synthesis-source-custody.sql", "utf8")}
        -- ${mode}
        CREATE FUNCTION pg_temp.approval_join_rpc(statement text) RETURNS jsonb LANGUAGE plpgsql AS $rpc$
        DECLARE value jsonb; code text; BEGIN
          BEGIN EXECUTE statement INTO value;
          EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
            RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('code',code)); END;
          RETURN jsonb_build_object('data',value,'error',NULL);
        END $rpc$;
        SELECT set_config('request.jwt.claim.sub',${literal(actorId)},true);`);
      let loseNextApprovalAck = false;
      const makeClient = (role: "authenticated" | "service_role") => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        const keys = signatures[name]; if (!keys) throw new Error("Unexpected native approval RPC");
        expect(Object.keys(args).sort()).toEqual([...keys].sort());
        const call = `SELECT public.${name}(${keys.map(key => literal(args[key])).join(",")})`;
        const rows = await database.query(`SET LOCAL ROLE ${role}; SELECT pg_temp.approval_join_rpc(${literal(call)}); RESET ROLE;`);
        const result = JSON.parse(rows.at(-1) ?? "null") as { data: unknown; error: { code: string } | null };
        if (name === "retain_engagement_synthesis_approval" && loseNextApprovalAck && !result.error) {
          loseNextApprovalAck = false; return { data: null, error: { code: "PT503" } };
        }
        return result;
      } }) as unknown as Pick<SupabaseClient, "rpc">;
      const client = makeClient("authenticated"), service = makeClient("service_role");
      const source = await loadSynthesisSource(client, { campaignId, workspaceId, requestId: sourceId });
      expect(source.snapshot.items.length + source.snapshot.answers.length).toBe(303);
      await retainSynthesisReview(client, service, campaignId, { requestId: reviewId, actorId, workspaceId, operation: "create", sourceId, sourceSha256: source.snapshotSha256 });
      const original = await loadSynthesisReview(client, address);
      expect(original?.content.assignedSourceCount).toBe(303);
      const empty = await loadSynthesisApprovalState(client, address);
      expect(empty?.packet.eventCount).toBe(0);
      const intent: SynthesisApprovalIntent = { ...empty!.current, actorId, requestId, operation: "approve", reason: "SYNTHETIC exact native staff approval 中文 🚲",
        predecessorId: null, predecessorSha256: null };
      loseNextApprovalAck = true;
      const first = await retainSynthesisApproval(client, service, actor, intent);
      expect(first).toMatchObject({ replayed: true, event: { eventNo: 1, intent } });
      expect((await database.query(`SELECT count(*) FROM engagement_synthesis_approval_events WHERE review_id='${reviewId}';`)).at(-1)).toBe("1");
      if (mode === "corrupt rehashed revision reference") {
        const altered = "jsonb_set(event_text::jsonb,'{intent,revisionSha256}',to_jsonb(repeat('0',64)))::text";
        const oldPacket = "jsonb_build_object('eventText',event_text,'eventSha256',event_sha256)";
        const newPacket = `jsonb_build_object('eventText',${altered},'eventSha256',encode(extensions.digest(${altered},'sha256'),'hex'))`;
        await database.query(`DO $fault$ DECLARE body text; BEGIN
          body=pg_get_functiondef('public.read_engagement_synthesis_approval_history(uuid,uuid)'::regprocedure);
          IF position(${literal(oldPacket)} IN body)=0 OR position('SELECT event_sha256 FROM events' IN body)=0 THEN RAISE EXCEPTION 'Missing approval join fault seam'; END IF;
          body=replace(body,${literal(oldPacket)},${literal(newPacket)});
          body=replace(body,'SELECT event_sha256 FROM events',${literal(`SELECT encode(extensions.digest(${altered},'sha256'),'hex') FROM events`)});
          EXECUTE body; END $fault$;`);
        await expect(loadSynthesisApprovalState(client, address)).rejects.toThrow("Approval history differs from the verified review revisions");
        return;
      }
      await retainSynthesisReview(client, service, campaignId, { requestId: correctedId, actorId, workspaceId, operation: "correct", reviewId,
        expectedRevisionId: reviewId, expectedRevisionSha256: original!.revision.contentSha256, reason: "SYNTHETIC correction after approval",
        change: { kind: "notes", title: "SYNTHETIC corrected native review", notes: "SYNTHETIC complete native corrected text 中文 ".repeat(50) } });
      const state = await loadSynthesisApprovalState(client, address);
      expect(synthesisApprovalForRevision(state!.history, state!.current).state).toBe("unapproved");
      expect((await retainSynthesisApproval(client, service, actor, intent)).event).toEqual(first.event);
      const withdrawal: SynthesisApprovalIntent = { ...intent, requestId: withdrawalId, operation: "withdraw", reason: "SYNTHETIC withdrawal of the older exact approval",
        predecessorId: requestId, predecessorSha256: first.event.eventSha256 };
      const second = await retainSynthesisApproval(client, service, actor, withdrawal);
      expect(second.event.eventNo).toBe(2);
      const renewed: SynthesisApprovalIntent = { ...state!.current, actorId, requestId: renewedId, operation: "approve", reason: "SYNTHETIC explicit review of corrected wording",
        predecessorId: withdrawalId, predecessorSha256: second.event.eventSha256 };
      const third = await retainSynthesisApproval(client, service, actor, renewed);
      expect(third).toMatchObject({ replayed: false, event: { eventNo: 3, intent: renewed } });
      await expect(retainSynthesisApproval(client, service, actor, { ...renewed, reason: "Changed retry" })).rejects.toMatchObject({ kind: "conflict" });
      const reopened = await loadSynthesisApprovalState(client, address);
      expect(reopened?.packet.eventCount).toBe(3);
      expect(synthesisApprovalForRevision(reopened!.history, reopened!.current).state).toBe("approved");
      expect(synthesisApprovalForRevision(reopened!.history, empty!.current).state).toBe("withdrawn");
      const old = await loadSynthesisReview(client, { ...address, revisionId: reviewId });
      expect(old?.revision.contentText).toBe(original?.revision.contentText); expect(old?.preparationText).toBe(original?.preparationText);
      expect(old?.source.snapshotText).toBe(source.snapshotText);
      await database.query(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspaceId}' AND user_id='${actorId}';`);
      await expect(retainSynthesisApproval(client, service, actor, intent)).rejects.toMatchObject({ kind: "forbidden" });
      await expect(loadSynthesisApprovalState(client, address)).rejects.toMatchObject({ kind: "forbidden" });
      expect((await database.query(`SELECT count(*) FROM engagement_synthesis_approval_events WHERE review_id='${reviewId}';`)).at(-1)).toBe("3");
    } finally { await database.close(); }
  }, 60_000);
});
