import { createHash } from "node:crypto";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import type { DocumentLibrarySourceId } from "@/lib/document-library/types";
import type { EvidenceDescriptorV1 } from "@/lib/evidence/evidence-descriptor";

export const PROJECT_EVIDENCE_MANIFEST_V1_VERSION = "project_evidence_manifest.v1" as const;
export const PROJECT_EVIDENCE_MANIFEST_VERSION = "project_evidence_manifest.v2" as const;
export const PROJECT_EVIDENCE_CANDIDATE_LIMIT = 500;
export const PROJECT_EVIDENCE_SELECTED_FILE_LIMIT = 200;
export const PROJECT_EVIDENCE_FILE_BYTE_LIMIT = 50 * 1024 * 1024;
export const PROJECT_EVIDENCE_TOTAL_BYTE_LIMIT = 100 * 1024 * 1024;

export type ProjectEvidenceCandidateSourceId = DocumentLibrarySourceId | "project_geopackage";
export type ProjectEvidenceRetrievalState =
  | "available"
  | "rendered_on_freeze"
  | "unavailable"
  | "reference_only";
export type ProjectEvidenceCustodyState =
  | "openplan_stored"
  | "rendered_on_freeze"
  | "worker_local"
  | "external_reference"
  | "unavailable";

/**
 * One planner-reviewable record. Null means the owning module did not record
 * the field. The evidence bundle never guesses missing provenance.
 */
export type ProjectEvidenceCandidate = {
  id: string;
  sourceId: ProjectEvidenceCandidateSourceId;
  sourceLabel: string;
  owningModule: string;
  recordId: string;
  parentRecordId: string | null;
  projectId: string;
  title: string;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  recordedChecksumSha256: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  sourceKind: string | null;
  sourceVintage: string | null;
  citation: string | null;
  retrievalState: ProjectEvidenceRetrievalState;
  claimTier: string | null;
  custodyState: ProjectEvidenceCustodyState;
  uncertainty: string[];
  knownLimits: string[];
  defaultSelected: boolean;
  required: boolean;
  selectable: boolean;
  exclusionReason: string | null;
  revisionToken: string;
  evidenceDescriptor?: EvidenceDescriptorV1;
};

export type ProjectEvidenceManifestEntryV1 = {
  path: string | null;
  owningModule: string;
  originalRecord: {
    sourceId: ProjectEvidenceCandidateSourceId | "project_record" | "linked_data" | "modeling_evidence";
    recordId: string;
    parentRecordId: string | null;
  };
  title: string;
  originalFilename: string | null;
  contentType: string | null;
  source: {
    kind: string | null;
    vintage: string | null;
    citation: string | null;
  };
  retrieval: {
    state: ProjectEvidenceRetrievalState;
    retrievedAt: string | null;
  };
  claimTier: string | null;
  custody: {
    state: ProjectEvidenceCustodyState;
  };
  checksumSha256: string | null;
  byteSize: number | null;
  uncertainty: string[];
  knownLimits: string[];
  inclusion: {
    status: "included" | "excluded" | "reference_only";
    reason: string | null;
  };
  revisionToken: string | null;
};

export type ProjectEvidenceManifestV1 = {
  schemaVersion: typeof PROJECT_EVIDENCE_MANIFEST_V1_VERSION;
  bundleId: string;
  workspaceId: string;
  projectId: string;
  projectRevision: string;
  generatedAt: string;
  generatedBy: string;
  purpose: "retained_evidence_snapshot";
  approvalOrPublication: false;
  limits: {
    reviewCandidateLimit: number;
    selectedFileLimit: number;
    perFileBytes: number;
    totalSelectedFileBytes: number;
  };
  inventory: {
    candidateCount: number;
    inventoryTruncated: boolean;
    selectedCount: number;
    includedCount: number;
    excludedCount: number;
  };
  knownLimits: string[];
  entries: ProjectEvidenceManifestEntryV1[];
};

export type ProjectEvidenceManifestEntryV2 = ProjectEvidenceManifestEntryV1 & {
  evidence: EvidenceDescriptorV1;
};

export type ProjectEvidenceManifestV2 = Omit<ProjectEvidenceManifestV1, "schemaVersion" | "entries"> & {
  schemaVersion: typeof PROJECT_EVIDENCE_MANIFEST_VERSION;
  entries: ProjectEvidenceManifestEntryV2[];
  selectedLinkedPlan: { id: string; revisionToken: string } | null;
  currentBoardOrReportPdf: { recordId: string; checksumSha256: string } | null;
  layerStatusTable: "openplan_layer_status";
};

export type ProjectEvidenceManifest = ProjectEvidenceManifestV1 | ProjectEvidenceManifestV2;

export type ProjectEvidencePriorBundle = {
  id: string;
  generatedAt: string;
  byteCount: number | null;
  manifestSha256: string | null;
  bundleSha256: string | null;
  selectedCount: number;
  status: "preparing" | "ready" | "failed";
  failureCode: string | null;
  downloadHref: string | null;
};

export type ProjectEvidenceCandidateInventory = {
  projectId: string;
  projectRevision: string;
  candidates: ProjectEvidenceCandidate[];
  sourceOutcomes: Record<string, { count: number; failed: boolean; pending: boolean }>;
  inventoryTruncated: boolean;
  limits: {
    reviewCandidateLimit: number;
    selectedFileLimit: number;
    perFileBytes: number;
    totalSelectedFileBytes: number;
  };
  priorBundles: ProjectEvidencePriorBundle[];
  linkedPlans: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: string;
    revisionToken: string;
  }>;
};

export function projectEvidenceRevisionToken(
  candidate: Omit<ProjectEvidenceCandidate, "revisionToken">
): string {
  return createHash("sha256").update(canonicalizeActionPayload(candidate)).digest("hex");
}
export function projectEvidenceCandidateId(
  sourceId: ProjectEvidenceCandidateSourceId,
  recordId: string
): string {
  return `${sourceId}:${recordId}`;
}

export function isSha256(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}
