import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { authorizeRtpCycleWrite } from "@/lib/rtp/cycle-write-authorization";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { readRetainedSourcePage } from "@/lib/rtp/extraction/source-pages";
import { manualProposalSchema, manualFieldRefusal } from "@/lib/rtp/extraction/manual";
import { verifyExtractionCandidates, RTP_EXTRACTION_DISCARD_SENTENCES } from "@/lib/rtp/extraction/verify";

/** Manual staging has no registered agent action. No provider or usage-event path exists here. */
export async function POST(request: NextRequest, context: { params: Promise<{ rtpCycleId: string }> }) {
  const audit = createApiAuditLogger("rtp.manual_source_proposal", request);
  try {
    if (readAssistantExecutionSource(request) !== "manual") {
      audit.warn("agent_write_refused");
      return NextResponse.json({ error: "RTP source intake is not a registered agent write.", reason: "agent_action_not_registered" }, { status: 403 });
    }
    const { rtpCycleId } = await context.params;
    if (!z.string().uuid().safeParse(rtpCycleId).success) return NextResponse.json({ error: "Invalid RTP cycle" }, { status: 400 });
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    const parsed = manualProposalSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Provide one source quote and the fields for its record. Unknown fields are refused." }, { status: 400 });
    const input = parsed.data;
    const client = await createClient();
    const access = await authorizeRtpCycleWrite(client as unknown as Parameters<typeof authorizeRtpCycleWrite>[0], audit, rtpCycleId);
    if (!access.ok) return access.response;
    const read = await readRetainedSourcePage(client, { cycleId: rtpCycleId, documentId: input.kbDocumentId, extractionId: input.documentExtractionId, page: input.sourcePage });
    if (!read.ok) return NextResponse.json({ error: read.error, reason: read.reason }, { status: read.status });
    const source = read.page;
    if (source.checksum !== input.documentChecksum || source.contentSha256 !== input.contentSha256) return NextResponse.json({ error: "The original or retained version changed. Open the page again; your entered values remain available.", reason: "source_drift" }, { status: 409 });
    const fieldRefusal = manualFieldRefusal(input.targetKind, input.fields);
    if (fieldRefusal) return NextResponse.json({ error: fieldRefusal, reason: "invalid_source_fields" }, { status: 400 });
    // No band lookup is needed here. Existing review resolves any period choice.
    const verification = verifyExtractionCandidates({ targetKind: input.targetKind,
      passages: [{ chunkId: source.extractionId, page: source.page, content: source.text }],
      candidates: [{ target_kind: input.targetKind, source_chunk_id: source.extractionId,
        page: source.page, quote: input.quote, fields: input.fields }],
    });
    const candidate = verification.accepted[0];
    if (!candidate) return NextResponse.json({ error: "The proposal did not match this source page.", reason: "verification_refused",
      details: verification.discarded.map((item) => ({ field: item.field, reason: item.reason, message: RTP_EXTRACTION_DISCARD_SENTENCES[item.reason] })) }, { status: 422 });
    // The transaction rechecks access and the exact source text after the deterministic verifier.
    const result = await createServiceRoleClient().rpc("stage_rtp_manual_source_proposal", {
      p_cycle_id: rtpCycleId, p_workspace_id: access.workspaceId, p_actor_id: access.userId,
      p_request: input, p_page_text: source.text, p_source: source.source,
      p_proposed: candidate.proposedJson, p_quote: candidate.quote,
    });
    if (result.error || !result.data) {
      const code = result.error?.code;
      audit.warn("manual_proposal_not_confirmed", { cycleId: rtpCycleId, code });
      return NextResponse.json({ error: code === "PT409" ? "The source or retry payload changed. Keep the draft and reopen the selected page, or start a new proposal." : code === "42501" ? "Your permission changed. Nothing was stored." : "The proposal could not be confirmed. Keep the draft and retry with the same request.", reason: code === "PT409" ? "source_or_payload_changed" : "write_unavailable" }, { status: code === "PT409" ? 409 : code === "42501" ? 403 : 503 });
    }
    audit.info("manual_proposal_staged", { cycleId: rtpCycleId, requestId: input.requestId, userId: access.userId, sourceMethod: "manual_retained_page" });
    return NextResponse.json(result.data, { status: 201 });
  } catch {
    audit.error("manual_proposal_unavailable");
    return NextResponse.json({ error: "The proposal could not be confirmed. Keep your draft and retry with the same request.", reason: "write_unavailable" }, { status: 503 });
  }
}
