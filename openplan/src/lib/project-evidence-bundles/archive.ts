import { createHash } from "node:crypto";
import JSZip from "jszip";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import {
  PROJECT_EVIDENCE_CANDIDATE_LIMIT,
  PROJECT_EVIDENCE_FILE_BYTE_LIMIT,
  PROJECT_EVIDENCE_MANIFEST_VERSION,
  PROJECT_EVIDENCE_SELECTED_FILE_LIMIT,
  PROJECT_EVIDENCE_TOTAL_BYTE_LIMIT,
  isSha256,
  type ProjectEvidenceCandidate,
  type ProjectEvidenceManifestEntryV1,
  type ProjectEvidenceManifestV1,
  type ProjectEvidenceRetrievalState,
  type ProjectEvidenceCustodyState,
} from "./contracts";

export class ProjectEvidenceBundleError extends Error {
  constructor(
    public readonly code:
      | "selected_file_limit"
      | "file_too_large"
      | "bundle_too_large"
      | "missing_evidence"
      | "checksum_mismatch"
      | "unsafe_filename"
      | "stale_review",
    message: string
  ) {
    super(message);
    this.name = "ProjectEvidenceBundleError";
  }
}

export type ResolvedProjectEvidenceFile = {
  candidate: ProjectEvidenceCandidate;
  bytes: Buffer;
  filename: string;
  contentType: string | null;
};

export type GeneratedProjectEvidenceFile = {
  path: string;
  recordId: string;
  title: string;
  sourceId: "project_record" | "linked_data" | "modeling_evidence" | "project_geopackage";
  owningModule: string;
  bytes: Buffer;
  contentType: string;
  retrievalState: ProjectEvidenceRetrievalState;
  custodyState: ProjectEvidenceCustodyState;
  knownLimits: string[];
};

export type BuildProjectEvidenceBundleInput = {
  bundleId: string;
  workspaceId: string;
  projectId: string;
  projectRevision: string;
  generatedAt: Date;
  generatedBy: string;
  candidates: ProjectEvidenceCandidate[];
  selectedFiles: ResolvedProjectEvidenceFile[];
  generatedFiles: GeneratedProjectEvidenceFile[];
  inventoryTruncated: boolean;
  knownLimits: string[];
};

export type BuiltProjectEvidenceBundle = {
  bytes: Buffer;
  manifest: ProjectEvidenceManifestV1;
  manifestSha256: string;
  checksumsSha256: string;
};

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Refuse paths that a ZIP reader could resolve outside the extraction root. */
export function confineEvidenceBundlePath(value: string): string {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
    throw new ProjectEvidenceBundleError("unsafe_filename", "Evidence filename is not confined");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ProjectEvidenceBundleError("unsafe_filename", "Evidence filename is not confined");
  }
  return parts.join("/");
}

export function safeEvidenceFilename(value: string | null | undefined, fallback: string): string {
  const leaf = (value ?? "").split(/[\\/]/).pop() ?? "";
  const safe = leaf
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

function manifestEntryFromCandidate(
  candidate: ProjectEvidenceCandidate,
  selected: ResolvedProjectEvidenceFile | undefined,
  generatedAt: string
): ProjectEvidenceManifestEntryV1 {
  const referenceOnly = candidate.retrievalState === "reference_only" || !candidate.selectable;
  const included = Boolean(selected);
  const reason = included
    ? null
    : candidate.exclusionReason ??
      (referenceOnly ? "The file is recorded as reference-only evidence." : "The planner did not select this file.");

  return {
    path: selected
      ? confineEvidenceBundlePath(
          `files/${candidate.sourceId}/${safeEvidenceFilename(candidate.recordId, "record")}-${safeEvidenceFilename(selected.filename, "evidence.bin")}`
        )
      : null,
    owningModule: candidate.owningModule,
    originalRecord: {
      sourceId: candidate.sourceId,
      recordId: candidate.recordId,
      parentRecordId: candidate.parentRecordId,
    },
    title: candidate.title,
    originalFilename: candidate.originalFilename,
    contentType: selected?.contentType ?? candidate.contentType,
    source: {
      kind: candidate.sourceKind,
      vintage: candidate.sourceVintage,
      citation: candidate.citation,
    },
    retrieval: {
      state: candidate.retrievalState,
      retrievedAt: included ? generatedAt : null,
    },
    claimTier: candidate.claimTier,
    custody: { state: candidate.custodyState },
    checksumSha256: selected ? sha256(selected.bytes) : candidate.recordedChecksumSha256,
    byteSize: selected ? selected.bytes.length : candidate.byteSize,
    uncertainty: [...candidate.uncertainty],
    knownLimits: [...candidate.knownLimits],
    inclusion: {
      status: included ? "included" : referenceOnly ? "reference_only" : "excluded",
      reason,
    },
    revisionToken: candidate.revisionToken,
  };
}

function manifestEntryFromGenerated(
  file: GeneratedProjectEvidenceFile,
  generatedAt: string
): ProjectEvidenceManifestEntryV1 {
  return {
    path: confineEvidenceBundlePath(file.path),
    owningModule: file.owningModule,
    originalRecord: {
      sourceId: file.sourceId,
      recordId: file.recordId,
      parentRecordId: null,
    },
    title: file.title,
    originalFilename: file.path.split("/").pop() ?? null,
    contentType: file.contentType,
    source: { kind: "openplan_record", vintage: null, citation: null },
    retrieval: { state: file.retrievalState, retrievedAt: generatedAt },
    claimTier: null,
    custody: { state: file.custodyState },
    checksumSha256: sha256(file.bytes),
    byteSize: file.bytes.length,
    uncertainty: [],
    knownLimits: [...file.knownLimits],
    inclusion: { status: "included", reason: null },
    revisionToken: null,
  };
}

function assertSelectedFiles(input: BuildProjectEvidenceBundleInput): void {
  if (input.selectedFiles.length > PROJECT_EVIDENCE_SELECTED_FILE_LIMIT) {
    throw new ProjectEvidenceBundleError(
      "selected_file_limit",
      `Select no more than ${PROJECT_EVIDENCE_SELECTED_FILE_LIMIT} files.`
    );
  }

  const candidates = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  let total = 0;
  for (const file of input.selectedFiles) {
    const current = candidates.get(file.candidate.id);
    if (!current || current.revisionToken !== file.candidate.revisionToken || !current.selectable) {
      throw new ProjectEvidenceBundleError("stale_review", "A selected evidence record changed after review.");
    }
    if (file.bytes.length > PROJECT_EVIDENCE_FILE_BYTE_LIMIT) {
      throw new ProjectEvidenceBundleError("file_too_large", `${file.candidate.title} exceeds the per-file limit.`);
    }
    total += file.bytes.length;
    if (total > PROJECT_EVIDENCE_TOTAL_BYTE_LIMIT) {
      throw new ProjectEvidenceBundleError("bundle_too_large", "The selected files exceed the bundle byte limit.");
    }
    if (isSha256(current.recordedChecksumSha256)) {
      const actual = sha256(file.bytes);
      if (actual !== current.recordedChecksumSha256.toLowerCase()) {
        throw new ProjectEvidenceBundleError(
          "checksum_mismatch",
          `${file.candidate.title} no longer matches its recorded checksum.`
        );
      }
    }
  }
}

function stableManifestJson(manifest: ProjectEvidenceManifestV1): string {
  return `${canonicalizeActionPayload(manifest)}\n`;
}

function readme(input: BuildProjectEvidenceBundleInput): string {
  return [
    "OpenPlan project evidence bundle",
    "",
    `Project ID: ${input.projectId}`,
    `Generated: ${input.generatedAt.toISOString()}`,
    "",
    "This retained snapshot is not an approval, adoption, publication, or backup.",
    "Read manifest.json before relying on a file. It records excluded evidence, missing metadata, custody, uncertainty, and known limits.",
    "Run `sha256sum -c checksums.sha256` from this directory to verify the packaged files.",
    "Open project/project.gpkg with an OGC GeoPackage reader such as ogrinfo or QGIS.",
    "",
  ].join("\n");
}

/** Build a byte-for-byte repeatable archive when all input values are unchanged. */
export async function buildProjectEvidenceBundle(
  input: BuildProjectEvidenceBundleInput
): Promise<BuiltProjectEvidenceBundle> {
  assertSelectedFiles(input);
  const generatedAt = input.generatedAt.toISOString();
  const selectedById = new Map(input.selectedFiles.map((file) => [file.candidate.id, file]));

  const entries = [
    ...input.generatedFiles.map((file) => manifestEntryFromGenerated(file, generatedAt)),
    ...input.candidates.filter((candidate) => candidate.sourceId !== "project_geopackage").map((candidate) =>
      manifestEntryFromCandidate(candidate, selectedById.get(candidate.id), generatedAt)
    ),
  ].sort((a, b) => {
    if (a.path === null && b.path !== null) return 1;
    if (a.path !== null && b.path === null) return -1;
    const pathOrder = (a.path ?? "").localeCompare(b.path ?? "");
    if (pathOrder !== 0) return pathOrder;
    return `${a.originalRecord.sourceId}:${a.originalRecord.recordId}`.localeCompare(
      `${b.originalRecord.sourceId}:${b.originalRecord.recordId}`
    );
  });

  const includedCount = entries.filter((entry) => entry.inclusion.status === "included").length;
  const manifest: ProjectEvidenceManifestV1 = {
    schemaVersion: PROJECT_EVIDENCE_MANIFEST_VERSION,
    bundleId: input.bundleId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    generatedAt,
    generatedBy: input.generatedBy,
    purpose: "retained_evidence_snapshot",
    approvalOrPublication: false,
    limits: {
      reviewCandidateLimit: PROJECT_EVIDENCE_CANDIDATE_LIMIT,
      selectedFileLimit: PROJECT_EVIDENCE_SELECTED_FILE_LIMIT,
      perFileBytes: PROJECT_EVIDENCE_FILE_BYTE_LIMIT,
      totalSelectedFileBytes: PROJECT_EVIDENCE_TOTAL_BYTE_LIMIT,
    },
    inventory: {
      candidateCount: input.candidates.length,
      inventoryTruncated: input.inventoryTruncated,
      selectedCount:
        input.selectedFiles.length + input.candidates.filter((candidate) => candidate.required).length,
      includedCount,
      excludedCount: entries.length - includedCount,
    },
    knownLimits: [...input.knownLimits],
    entries,
  };

  const manifestJson = stableManifestJson(manifest);
  const readmeText = readme(input);
  const files = new Map<string, Buffer>();
  files.set("README.txt", Buffer.from(readmeText, "utf8"));
  files.set("manifest.json", Buffer.from(manifestJson, "utf8"));
  for (const file of input.generatedFiles) files.set(confineEvidenceBundlePath(file.path), file.bytes);
  for (const file of input.selectedFiles) {
    const entry = entries.find(
      (item) =>
        item.originalRecord.sourceId === file.candidate.sourceId &&
        item.originalRecord.recordId === file.candidate.recordId &&
        item.inclusion.status === "included"
    );
    if (!entry?.path) {
      throw new ProjectEvidenceBundleError("missing_evidence", "A selected file has no manifest path.");
    }
    if (files.has(entry.path)) {
      throw new ProjectEvidenceBundleError("unsafe_filename", "Two selected files resolve to the same archive path.");
    }
    files.set(entry.path, file.bytes);
  }

  const checksumText = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => `${sha256(bytes)}  ${path}`)
    .join("\n") + "\n";
  files.set("checksums.sha256", Buffer.from(checksumText, "utf8"));

  const zip = new JSZip();
  for (const [path, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zip.file(path, bytes, { date: input.generatedAt, createFolders: true });
  }
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });

  return {
    bytes,
    manifest,
    manifestSha256: sha256(manifestJson),
    checksumsSha256: sha256(checksumText),
  };
}
