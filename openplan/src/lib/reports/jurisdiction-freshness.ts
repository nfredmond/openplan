import { createHash } from "node:crypto";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import type { ProjectJurisdictionRow } from "@/lib/projects/project-jurisdiction";
import type { ReportJurisdictionState } from "./catalog";

/** Compare the retained input fingerprint, without using output-sensitive project timestamps. */
export function reportJurisdictionState(
  metadata: Record<string, unknown> | null | undefined,
  project: ProjectJurisdictionRow | null | undefined,
): ReportJurisdictionState {
  const source = metadata?.sourceContext;
  if (!source || typeof source !== "object" || Array.isArray(source)) return "untracked";
  const snapshot = (source as Record<string, unknown>).jurisdictionReadiness;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "untracked";
  const stored = snapshot as Record<string, unknown>;
  // Historical formats do not carry the stable v4 input fingerprint.
  if (stored.schema !== "openplan.project-jurisdiction-readiness-export.v4") return "untracked";
  if (!project || typeof stored.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(stored.payloadSha256)) return "unavailable";
  try {
    const { payloadSha256, ...material } = stored;
    if (createHash("sha256").update(canonicalizeActionPayload(material)).digest("hex") !== payloadSha256) return "unavailable";
    const current = buildProjectJurisdictionReadinessExportPayload(project, jurisdictionReadinessRegistrySha256());
    return stored.payloadSha256 === current.payloadSha256 ? "current" : "changed";
  } catch {
    return "unavailable";
  }
}
