import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadProjectAccess } from "@/lib/programs/api";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { AWARD_HANDOFF_BODY_LIMIT, serializeHandoffApply, HANDOFF_AWARD_SELECT, handoffRequestSchema, awardTermsSchema } from "@/lib/grants/award-handoff";
import { handoffFailure, verifyHandoffBytes } from "@/lib/grants/award-handoff-server";

type Context = { params: Promise<{ awardId: string }> };
async function access(awardId: string, write: boolean) {
  const client = await createClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const award = await client.from("funding_awards").select(HANDOFF_AWARD_SELECT).eq("id", awardId).maybeSingle();
  if (award.error) return { response: handoffFailure(award.error) };
  if (!award.data) return { response: NextResponse.json({ error: "Award not found" }, { status: 404 }) };
  const permission = await loadProjectAccess(client, award.data.project_id, user.id, write ? "programs.write" : "programs.read");
  if (permission.error) return { response: NextResponse.json({ error: "Award access unavailable" }, { status: 503 }) };
  if (!permission.allowed || !permission.membership || permission.project?.workspace_id !== award.data.workspace_id) return { response: NextResponse.json({ error: "Award access denied" }, { status: 403 }) };
  return { client, user, award: award.data };
}

export async function GET(request: NextRequest, context: Context) {
  const { awardId } = await context.params;
  if (!z.string().uuid().safeParse(awardId).success) return NextResponse.json({ error: "Invalid award" }, { status: 400 });
  const scoped = await access(awardId, false); if (scoped.response) return scoped.response;
  const { client, award } = scoped;
  const opportunityId=award!.funding_opportunity_id ?? request.nextUrl.searchParams.get("opportunityId");
  let application:unknown=null;
  if(opportunityId){
    if(!z.string().uuid().safeParse(opportunityId).success)return NextResponse.json({error:"Invalid grant opportunity"},{status:422});
    const opportunity=await client!.from("funding_opportunities").select("id, workspace_id, project_id, pursuit_kind").eq("id",opportunityId).maybeSingle();
    if(opportunity.error)return handoffFailure(opportunity.error);
    if(!opportunity.data || opportunity.data.workspace_id!==award!.workspace_id || opportunity.data.project_id!==award!.project_id || opportunity.data.pursuit_kind!=="grant")return NextResponse.json({error:"Grant opportunity unavailable for this award"},{status:404});
    const sections=await client!.from("funding_opportunity_application_sections").select("id, section_key, title, status, final_markdown, finalized_from_draft_id, finalized_by, finalized_at, updated_by, updated_at",{count:"exact"}).eq("workspace_id",award!.workspace_id).eq("opportunity_id",opportunityId).order("id");
    if(sections.error)return handoffFailure(sections.error);
    if(sections.count!==sections.data?.length)return NextResponse.json({error:"Complete application snapshot unavailable"},{status:503});
    application={label:"Current reviewed application, not proof of submission",sections:sections.data};
  }
  // Exact count detects Data API truncation. Refuse instead of presenting partial history.
  const history = await client!.from("funding_award_handoff_revisions").select("id, sequence, predecessor_id, proposal, proposal_hash, terms, receipt, actor_id, created_at", { count: "exact" }).eq("award_id", awardId).order("sequence");
  if (history.error) return handoffFailure(history.error);
  if (history.count !== history.data?.length) return NextResponse.json({ error: "Complete award history unavailable" }, { status: 503 });
  const links = await client!.from("funding_award_handoff_fulfillment").select("id, condition_key, occurrence_key, requirement, submittal_id, milestone_id, submittal_status, submitted_at, fulfillment_evidence, milestone_status, actual_date", { count: "exact" }).eq("award_id", awardId).order("id");
  if (links.error) return handoffFailure(links.error);
  if (links.count !== links.data?.length) return NextResponse.json({ error: "Complete current occurrence set unavailable" }, { status: 503 });
  const invoices=await client!.from("billing_invoice_records").select("id, invoice_number, award_handoff_revision_id, currency_code, handoff_applicable_revision_id, status",{count:"exact"}).eq("funding_award_id",awardId).order("id");
  if(invoices.error)return handoffFailure(invoices.error);
  if(invoices.count!==invoices.data?.length)return NextResponse.json({error:"Complete invoice applicability set unavailable"},{status:503});
  const issuance=opportunityId ? await client!.from("funding_opportunity_issuance").select("opportunity_id, source_backed_award_count, award_ids").eq("opportunity_id",opportunityId).maybeSingle() : {data:null,error:null};
  if(issuance.error)return handoffFailure(issuance.error);
  const legacy = await client!.from("project_milestones").select("id, title, status, target_date, actual_date, assignee_user_id, owner_label, notes, funding_award_id, handoff_origin_revision_id", {count:"exact"}).eq("project_id",award!.project_id).eq("funding_award_id",awardId).eq("milestone_type","obligation").is("handoff_origin_revision_id",null).order("id");
  if(legacy.error)return handoffFailure(legacy.error);
  if(legacy.count!==legacy.data?.length)return NextResponse.json({error:"Complete legacy obligation set unavailable"},{status:503});
  return NextResponse.json({ legacyObligations:legacy.data, award, application, history: history.data, occurrences: links.data, invoices:invoices.data, issuance:issuance.data, sourceLimits: "Ordinary uploaded workspace PDF notices are supported. Application export PDFs lack upload checksums and refuse. Current application text is retained separately and does not prove submission." });
}

export async function POST(request: NextRequest, context: Context) {
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Award handoff is manual. No approved action-registry operation covers this write." }, { status: 403 });
  const audit = createApiAuditLogger("funding-awards.handoff", request);
  try {
    const { awardId } = await context.params;
    if (!z.string().uuid().safeParse(awardId).success) return NextResponse.json({ error: "Invalid award" }, { status: 400 });
    const body = await readJsonOrNullWithLimit(request, AWARD_HANDOFF_BODY_LIMIT); if (!body.ok) return body.response;
    const parsed = handoffRequestSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Complete actual award terms are required", issues: parsed.error.issues }, { status: 422 });
    const scoped = await access(awardId, true); if (scoped.response) return scoped.response;
    const { client, user, award } = scoped; const input = parsed.data;
    if (input.operation === "apply") {
      const key = z.string().uuid().safeParse(input.reviewed.requestKey);
      if (!key.success || !awardTermsSchema.safeParse(input.reviewed.terms).success || (input.reviewed.state as { awardId?: string } | undefined)?.awardId !== awardId) return NextResponse.json({ error: "Invalid reviewed request" }, { status: 422 });
      const prior = await client!.from("funding_award_handoff_revisions").select("id, reviewed_hash, reviewed_payload, actor_id").eq("workspace_id", award!.workspace_id).eq("request_key", key.data).maybeSingle();
      if (prior.error) return handoffFailure(prior.error);
      // Exact committed replay rechecks current authorization in SQL without re-reading bytes.
      if (prior.data) {
        const replay = await createServiceRoleClient().rpc("award_handoff_command", { p_actor: user!.id, p_award: awardId, p_operation: "apply", p_payload: input.reviewed, p_hash: input.reviewHash, p_verified: [] });
        return replay.error ? handoffFailure(replay.error) : NextResponse.json({ receipt: replay.data });
      }
      // Never fetch caller-supplied storage paths. Reconstruct the actor-authorized SQL
      // snapshot, then compare the complete DB representation again inside apply.
      const refresh = await createServiceRoleClient().rpc("award_handoff_command", { p_actor: user!.id, p_award: awardId, p_operation: "preview", p_payload: { requestKey: key.data, opportunityId: input.reviewed.opportunityId, terms: input.reviewed.terms } });
      if (refresh.error) return handoffFailure(refresh.error);
      if (refresh.data.reviewHash !== input.reviewHash) return NextResponse.json({ error: "Sources/outcomes changed. Review again." }, { status: 409 });
      const verified = await verifyHandoffBytes(refresh.data.reviewed);
      const apply = await createServiceRoleClient().rpc("award_handoff_command", { p_actor: user!.id, p_award: awardId, p_operation: "apply", p_payload: input.reviewed, p_hash: input.reviewHash, p_verified: verified });
      if (apply.error) return handoffFailure(apply.error);
      audit.info("award_handoff_recorded", { awardId, userId: user!.id, revisionId: apply.data.revisionId });
      return NextResponse.json({ receipt: apply.data });
    }
    const result = await createServiceRoleClient().rpc("award_handoff_command", { p_actor: user!.id, p_award: awardId, p_operation: "preview", p_payload: input });
    if (result.error) return handoffFailure(result.error);
    serializeHandoffApply(result.data); // Refuse unusable review before byte work or ready response.
    await verifyHandoffBytes(result.data.reviewed);
    return NextResponse.json(result.data);
  } catch (error) {
    audit.warn("award_handoff_refused", { awardId: (await context.params).awardId, message: error instanceof Error ? error.message : "Unavailable" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Award handoff unavailable. No partial transfer is accepted." }, { status: 422 });
  }
}
