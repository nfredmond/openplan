import { createHash } from "node:crypto";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import type { ProjectJurisdictionRow } from "@/lib/projects/project-jurisdiction";
import type { PacketGeographyReadState } from "./geography-figure";

export type ReportProjectJurisdictionSchemaPendingPayload = ReturnType<typeof buildReportProjectJurisdictionSchemaPendingPayload>;

/** Freeze an unread jurisdiction separately from every human-declared or legacy state. */
export function buildReportProjectJurisdictionSchemaPendingPayload(
  project: Pick<ProjectJurisdictionRow, "id" | "updated_at">,
  registrySha256: string,
  studyAreaReadState: PacketGeographyReadState,
) {
  const payload = {
    schema: "openplan.report-project-jurisdiction-schema-pending.v1" as const,
    scope: "external_handoff" as const,
    projectId: project.id ?? null,
    projectRevision: project.updated_at ?? null,
    registrySha256,
    jurisdictionReadState: "schema_pending" as const,
    studyAreaReadState,
    disclosure: "SCHEMA-PENDING: Project jurisdiction could not be read because this deployment's database is missing the jurisdiction column. Declaration status, adopting authority and legal applicability are unknown. No jurisdiction readiness or support assessment is made. Study geography has a separate read state.",
  };
  return { ...payload, payloadSha256: createHash("sha256").update(canonicalizeActionPayload(payload)).digest("hex") };
}
