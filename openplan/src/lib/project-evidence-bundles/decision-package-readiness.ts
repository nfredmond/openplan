import { parseEvidenceDescriptor } from "@/lib/evidence/evidence-descriptor";
import { isSha256 } from "./contracts";
import type { ProjectEvidenceCandidateInventory } from "./contracts";

type ManifestV2 = {
  schemaVersion?: string;
  projectRevision?: string;
  selectedLinkedPlan?: { id?: string; revisionToken?: string } | null;
  currentBoardOrReportPdf?: { recordId?: string; checksumSha256?: string } | null;
  entries?: Array<{
    path?: string | null;
    originalRecord?: { sourceId?: string; recordId?: string };
    checksumSha256?: string | null;
    revisionToken?: string | null;
    inclusion?: { status?: string };
    evidence?: unknown;
    retrieval?: { state?: string; retrievedAt?: string | null };
    byteSize?: number | null;
  }>;
};

type CurrentInventory = Pick<
  ProjectEvidenceCandidateInventory,
  "projectRevision" | "candidates" | "linkedPlans" | "inventoryTruncated"
> & { readFailed?: boolean };

const CANDIDATE_SOURCE_IDS = new Set([
  "knowledge_base",
  "report_artifacts",
  "grant_application_exports",
  "invoice_pdfs",
  "aerial_imagery",
  "aerial_artifact_custody",
  "model_run_artifacts",
]);

function readableTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function entryProblem(entry: NonNullable<ManifestV2["entries"]>[number]): string | null {
  const sourceId = entry.originalRecord?.sourceId;
  const recordId = entry.originalRecord?.recordId;
  const inclusion = entry.inclusion?.status;
  const descriptor = parseEvidenceDescriptor(entry.evidence);
  if (!sourceId || !recordId || !["included", "excluded", "reference_only"].includes(inclusion ?? "")) {
    return "Every package entry needs a complete source identity and inclusion verdict.";
  }
  if (!descriptor) return "Every package entry needs a valid point-of-use evidence descriptor.";
  if (inclusion !== "included") {
    if (entry.path !== null) return "Excluded and reference-only entries may not claim a frozen file path.";
    return null;
  }
  if (typeof entry.path !== "string" || !entry.path.trim()) {
    return "Every included package entry needs one frozen file path.";
  }
  if (!isSha256(entry.checksumSha256)) {
    return "Every included package entry needs the SHA-256 of its frozen bytes.";
  }
  if (!readableTimestamp(entry.retrieval?.retrievedAt)) {
    return "Every included package entry needs its exact retrieval timestamp.";
  }
  if (descriptor.checksumSha256 !== entry.checksumSha256 || descriptor.retrievedAt !== entry.retrieval.retrievedAt) {
    return "Every included point-of-use descriptor must bind to the exact frozen bytes and retrieval time.";
  }
  if (typeof entry.revisionToken !== "string" || !entry.revisionToken.trim()) {
    return "Every included package entry needs a source revision token.";
  }
  if (descriptor.revisionToken !== entry.revisionToken) {
    return "Every included point-of-use descriptor must bind to the exact source revision.";
  }
  if (typeof entry.byteSize !== "number" || !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0) {
    return "Every included package entry needs its exact non-negative byte count.";
  }
  return null;
}

/** Explain the first condition that prevents human review of this exact bundle. */
export function decisionPackageReadiness(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object") return "The bundle has no readable manifest.";
  const value = manifest as ManifestV2;
  if (value.schemaVersion !== "project_evidence_manifest.v2") return "Freeze a current v2 evidence bundle.";
  if (!value.selectedLinkedPlan?.id || !value.selectedLinkedPlan.revisionToken) {
    return "Select one linked plan before submitting the package.";
  }
  if (!value.currentBoardOrReportPdf?.recordId || !/^[0-9a-f]{64}$/.test(value.currentBoardOrReportPdf.checksumSha256 ?? "")) {
    return "Include exactly one current board or report PDF before submitting the package.";
  }
  const entries = value.entries ?? [];
  if (entries.length === 0) return "The bundle has no evidence entries.";
  for (const entry of entries) {
    const problem = entryProblem(entry);
    if (problem) return problem;
  }
  const selectedPlanEntry = entries.find((entry) =>
    entry.path === "project/linked-plan.json"
      && entry.originalRecord?.recordId === value.selectedLinkedPlan?.id
      && entry.inclusion?.status === "included",
  );
  if (!selectedPlanEntry) return "The selected linked plan is not bound to the frozen package contents.";
  const reportEntries = entries.filter((entry) =>
    entry.originalRecord?.sourceId === "report_artifacts"
      && entry.originalRecord.recordId === value.currentBoardOrReportPdf?.recordId
      && entry.checksumSha256 === value.currentBoardOrReportPdf?.checksumSha256
      && entry.inclusion?.status === "included",
  );
  if (reportEntries.length !== 1) return "The current board or report PDF is not bound to one exact frozen file.";
  const unsupported = entries.filter((entry) => parseEvidenceDescriptor(entry.evidence)?.support.status === "unsupported");
  if (unsupported.length > 0) return "A numeric claim lacks adequate point-of-use provenance.";
  return null;
}

/**
 * Compare a frozen manifest with the complete current candidate inventory.
 * Any added, removed, or revised record makes the custody artifact historical;
 * the approved bundle itself is never rewritten.
 */
export function decisionPackageFreshness(
  manifest: unknown,
  bundleProjectRevision: string | null | undefined,
  inventory: CurrentInventory,
): string | null {
  // A complete current inventory is required before comparing immutable custody.
  if (inventory.readFailed) return "Current source revisions could not be verified; freeze a new bundle after the read succeeds.";
  if (inventory.inventoryTruncated) return "The current source inventory is truncated; this bundle cannot be approved as current.";
  if (!manifest || typeof manifest !== "object") return "The bundle has no readable manifest.";
  const value = manifest as ManifestV2;
  if (value.schemaVersion !== "project_evidence_manifest.v2") return "Freeze a current v2 evidence bundle.";
  if (!bundleProjectRevision || inventory.projectRevision !== bundleProjectRevision) {
    return "The project record changed after this bundle was frozen.";
  }

  const frozenPlan = value.selectedLinkedPlan;
  const currentPlan = inventory.linkedPlans.find((plan) => plan.id === frozenPlan?.id);
  if (!frozenPlan?.revisionToken || currentPlan?.revisionToken !== frozenPlan.revisionToken) {
    return "The selected linked plan changed or is no longer linked.";
  }

  const current = new Map(
    inventory.candidates
      .filter((candidate) => candidate.sourceId !== "project_geopackage")
      .map((candidate) => [`${candidate.sourceId}:${candidate.recordId}`, candidate.revisionToken]),
  );
  const frozen = new Map(
    (value.entries ?? [])
      .filter((entry) => CANDIDATE_SOURCE_IDS.has(entry.originalRecord?.sourceId ?? ""))
      .map((entry) => [
        `${entry.originalRecord?.sourceId}:${entry.originalRecord?.recordId}`,
        entry.revisionToken ?? null,
      ]),
  );
  if (current.size !== frozen.size) return "The project evidence inventory changed after this bundle was frozen.";
  for (const [key, revisionToken] of current) {
    if (!revisionToken || frozen.get(key) !== revisionToken) {
      return "A project evidence source changed after this bundle was frozen.";
    }
  }
  return null;
}
