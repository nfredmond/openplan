import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.object({
  versionId: z.string().uuid(),
  processKey: z.string().trim().min(1).max(120),
  status: z.enum(["not_started", "in_progress", "complete", "not_applicable"]),
  dueOn: z.string().date().nullable(),
  completedOn: z.string().date().nullable(),
  evidenceDocumentId: z.string().uuid().nullable(),
  notes: z.string().trim().max(10_000).nullable(),
}).strict();

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.process", request);
  audit.info("land_use_plan_process_record_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid process record", issues: parsed.error.issues }, { status: 400 });
  if (parsed.data.status === "complete" && !parsed.data.completedOn) {
    return NextResponse.json({ error: "A completed process step needs its actual completion date" }, { status: 400 });
  }

  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  const descriptor = getJurisdictionPlanDescriptor(access.plan.descriptor_id);
  const processStep = descriptor?.processSteps.find((step) => step.key === parsed.data.processKey);
  if (!descriptor || !processStep) {
    return NextResponse.json({ error: "The process key is not part of this plan descriptor" }, { status: 400 });
  }
  const { data: version, error: versionError } = await access.supabase
    .from("land_use_plan_versions")
    .select("id")
    .eq("id", parsed.data.versionId)
    .eq("plan_id", access.plan.id)
    .maybeSingle();
  if (versionError) return NextResponse.json({ error: "Failed to verify the plan version" }, { status: 500 });
  if (!version) return NextResponse.json({ error: "Plan version not found" }, { status: 404 });

  if (parsed.data.evidenceDocumentId) {
    const { data: document, error } = await access.supabase.from("kb_documents")
      .select("id").eq("id", parsed.data.evidenceDocumentId)
      .eq("workspace_id", access.plan.workspace_id).eq("status", "ready").maybeSingle();
    if (error) return NextResponse.json({ error: "Failed to verify process evidence" }, { status: 500 });
    if (!document) return NextResponse.json({ error: "Select a ready document from this workspace" }, { status: 400 });
  }

  const { data: record, error } = await access.supabase.from("land_use_plan_process_records").upsert({
    workspace_id: access.plan.workspace_id,
    plan_id: access.plan.id,
    version_id: parsed.data.versionId,
    descriptor_id: descriptor.id,
    process_key: processStep.key,
    status: parsed.data.status,
    due_on: parsed.data.dueOn,
    completed_on: parsed.data.status === "complete" ? parsed.data.completedOn : null,
    evidence_document_id: parsed.data.evidenceDocumentId,
    notes: parsed.data.notes,
    created_by: access.userId,
  }, { onConflict: "version_id,process_key" }).select("id").single();
  if (error || !record) return NextResponse.json({ error: "Failed to save the process record" }, { status: 500 });
  return NextResponse.json({ processRecordId: record.id });
}
