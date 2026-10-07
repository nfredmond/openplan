import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";
import { readFrozenPlanIdentity } from "./frozen-identity";

type Report = { id: string; workspace_id: string; land_use_plan_id?: string | null; report_type: string };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema = z.object({
  planId: z.string().uuid(),
  adoptedVersionId: z.string().uuid(),
  adoptedVersionContentHash: hash,
  reportingPeriodStart: z.string().date(),
  reportingPeriodEnd: z.string().date(),
  actions: z.array(z.object({
    id: z.string().uuid(), title: z.string().trim().min(1),
    description: z.string().nullable(), responsible_party: z.string().nullable(),
    due_on: z.string().date().nullable(),
    status: z.enum(["not_started", "in_progress", "completed", "deferred"]),
    project_id: z.string().uuid().nullable(), program_id: z.string().uuid().nullable(),
    evidence_document_id: z.string().uuid().nullable(), updated_at: z.string().datetime({ offset: true }),
  }).strict()),
}).strict().refine(value => value.reportingPeriodEnd >= value.reportingPeriodStart);

/** Bind saved statuses to the append-only register and the original adopted identity. */
export async function loadImplementationReportSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  report: Report,
  metadata: Record<string, unknown>,
) {
  if (report.report_type !== "land_use_plan_implementation_report" || !report.land_use_plan_id
    || metadata.kind !== "land_use_plan_implementation_report" || metadata.landUsePlanId !== report.land_use_plan_id
    || !hash.safeParse(metadata.contentHash).success || !snapshotSchema.safeParse(metadata.snapshot).success) return null;

  const result = await supabase.from("land_use_plan_implementation_reports")
    .select("id, workspace_id, plan_id, adopted_version_id, reporting_period_start, reporting_period_end, summary, action_status_snapshot, content_hash, report_id")
    .eq("report_id", report.id).eq("plan_id", report.land_use_plan_id).eq("workspace_id", report.workspace_id).maybeSingle();
  const native = result.data;
  if (result.error || !native || native.report_id !== report.id || native.plan_id !== report.land_use_plan_id
    || native.workspace_id !== report.workspace_id || native.content_hash !== metadata.contentHash
    || native.summary !== metadata.summary) return null;

  const versionResult = await supabase.from("land_use_plan_versions")
    .select("id, workspace_id, plan_id, version_number, state, content_hash, frozen_snapshot")
    .eq("id", native.adopted_version_id).eq("plan_id", report.land_use_plan_id).eq("workspace_id", report.workspace_id).maybeSingle();
  const version = versionResult.data;
  if (versionResult.error || !version || version.id !== native.adopted_version_id
    || version.plan_id !== report.land_use_plan_id || version.workspace_id !== report.workspace_id
    || !["adopted", "superseded", "repealed"].includes(version.state)) return null;
  const identity = readFrozenPlanIdentity(version.frozen_snapshot, native.plan_id, version.id, version.version_number, version.content_hash);
  if (!identity) return null;

  // The original producer hashes insertion-order JSON. jsonb does not preserve
  // that order. Compare its retained hash and complete native payload instead of
  // inventing a new hash interpretation for historical reports.
  const snapshot = {
    planId: native.plan_id, adoptedVersionId: version.id, adoptedVersionContentHash: version.content_hash,
    reportingPeriodStart: native.reporting_period_start, reportingPeriodEnd: native.reporting_period_end,
    actions: native.action_status_snapshot,
  };
  if (!isDeepStrictEqual(metadata.snapshot, snapshot)) return null;
  return { identity, frozen: version.frozen_snapshot as Record<string, unknown>, snapshot,
    summary: native.summary ?? `Implementation status for ${native.reporting_period_start} through ${native.reporting_period_end}.` };
}
