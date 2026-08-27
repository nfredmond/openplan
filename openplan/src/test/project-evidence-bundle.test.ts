import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  ProjectEvidenceBundleError,
  buildProjectEvidenceBundle,
  confineEvidenceBundlePath,
  sha256,
  type BuildProjectEvidenceBundleInput,
} from "@/lib/project-evidence-bundles/archive";
import {
  PROJECT_EVIDENCE_FILE_BYTE_LIMIT,
  PROJECT_EVIDENCE_SELECTED_FILE_LIMIT,
  projectEvidenceRevisionToken,
  type ProjectEvidenceCandidate,
} from "@/lib/project-evidence-bundles/contracts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const GENERATED_AT = new Date("2026-08-26T20:00:00.000Z");

function candidate(overrides: Partial<ProjectEvidenceCandidate> = {}): ProjectEvidenceCandidate {
  const base: Omit<ProjectEvidenceCandidate, "revisionToken"> = {
    id: "knowledge_base:44444444-4444-4444-8444-444444444444",
    sourceId: "knowledge_base",
    sourceLabel: "Knowledge Base",
    owningModule: "knowledge_base",
    recordId: "44444444-4444-4444-8444-444444444444",
    parentRecordId: null,
    projectId: PROJECT_ID,
    title: "Existing conditions.pdf",
    originalFilename: "../../Existing conditions.pdf",
    contentType: "application/pdf",
    byteSize: 8,
    recordedChecksumSha256: sha256(Buffer.from("evidence")),
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    sourceKind: "uploaded_pdf",
    sourceVintage: null,
    citation: null,
    retrievalState: "available",
    claimTier: null,
    custodyState: "openplan_stored",
    uncertainty: ["Page OCR was not checked for this binary handoff."],
    knownLimits: ["Citation metadata is unavailable."],
    defaultSelected: false,
    required: false,
    selectable: true,
    exclusionReason: null,
    ...overrides,
  };
  const { revisionToken: _ignored, ...withoutToken } = overrides;
  const value = { ...base, ...withoutToken };
  return { ...value, revisionToken: projectEvidenceRevisionToken(value) };
}

function input(overrides: Partial<BuildProjectEvidenceBundleInput> = {}): BuildProjectEvidenceBundleInput {
  const source = candidate();
  return {
    bundleId: "55555555-5555-4555-8555-555555555555",
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    projectRevision: "2026-08-26T19:00:00.000Z",
    generatedAt: GENERATED_AT,
    generatedBy: USER_ID,
    candidates: [
      source,
      candidate({
        id: "invoice_pdfs:66666666-6666-4666-8666-666666666666",
        sourceId: "invoice_pdfs",
        sourceLabel: "Client invoices",
        owningModule: "invoicing",
        recordId: "66666666-6666-4666-8666-666666666666",
        title: "Invoice 12",
        originalFilename: null,
        contentType: "application/pdf",
        byteSize: null,
        recordedChecksumSha256: null,
        sourceKind: "generated_invoice_pdf",
        retrievalState: "rendered_on_freeze",
        custodyState: "rendered_on_freeze",
        uncertainty: [],
        knownLimits: ["Rendered only if selected."],
      }),
    ],
    selectedFiles: [
      {
        candidate: source,
        bytes: Buffer.from("evidence"),
        filename: "../../Existing conditions.pdf",
        contentType: "application/pdf",
      },
    ],
    generatedFiles: [
      {
        path: "project/project.json",
        recordId: PROJECT_ID,
        title: "Project record",
        sourceId: "project_record",
        owningModule: "projects",
        bytes: Buffer.from('{"name":"Project"}\n'),
        contentType: "application/json",
        retrievalState: "available",
        custodyState: "openplan_stored",
        knownLimits: [],
      },
      {
        path: "project/project.gpkg",
        recordId: PROJECT_ID,
        title: "Project GeoPackage",
        sourceId: "project_geopackage",
        owningModule: "projects",
        bytes: Buffer.from("gpkg"),
        contentType: "application/geopackage+sqlite3",
        retrievalState: "rendered_on_freeze",
        custodyState: "rendered_on_freeze",
        knownLimits: ["Crash points are not included."],
      },
    ],
    inventoryTruncated: false,
    knownLimits: ["This is not approval or publication."],
    ...overrides,
  };
}

describe("project evidence archive", () => {
  it("is deterministic and carries canonical provenance, exclusions, and usable checksums", async () => {
    const first = await buildProjectEvidenceBundle(input());
    const second = await buildProjectEvidenceBundle(input());
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.manifestSha256).toBe(second.manifestSha256);

    const zip = await JSZip.loadAsync(first.bytes);
    expect(Object.keys(zip.files).sort()).toEqual([
      "README.txt",
      "checksums.sha256",
      "files/",
      "files/knowledge_base/",
      "files/knowledge_base/44444444-4444-4444-8444-444444444444-Existing-conditions.pdf",
      "manifest.json",
      "project/",
      "project/project.gpkg",
      "project/project.json",
    ]);
    const checksums = await zip.file("checksums.sha256")!.async("string");
    for (const line of checksums.trim().split("\n")) {
      const [expected, archivePath] = line.split(/\s{2}/);
      const bytes = await zip.file(archivePath)!.async("nodebuffer");
      expect(sha256(bytes), archivePath).toBe(expected);
    }
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.schemaVersion).toBe("project_evidence_manifest.v2");
    expect(manifest.approvalOrPublication).toBe(false);
    expect(manifest.generatedBy).toBe("openplan_authenticated_planner");
    expect(manifest.layerStatusTable).toBe("openplan_layer_status");
    expect(manifest.entries.every((entry: { evidence?: unknown }) => entry.evidence)).toBe(true);
    expect(manifest.entries.map((entry: { path: string | null }) => entry.path)).toEqual([
      "files/knowledge_base/44444444-4444-4444-8444-444444444444-Existing-conditions.pdf",
      "project/project.gpkg",
      "project/project.json",
      null,
    ]);
    expect(manifest.entries[0]).toMatchObject({
      claimTier: null,
      source: { vintage: null, citation: null },
      custody: { state: "openplan_stored" },
      inclusion: { status: "included", reason: null },
      checksumSha256: sha256(Buffer.from("evidence")),
      uncertainty: ["Page OCR was not checked for this binary handoff."],
      knownLimits: ["Citation metadata is unavailable."],
    });
    expect(manifest.entries[3]).toMatchObject({
      path: null,
      claimTier: null,
      checksumSha256: null,
      inclusion: { status: "excluded", reason: "The planner did not select this file." },
      retrieval: { state: "rendered_on_freeze", retrievedAt: null },
    });
  });

  it.each(["../outside", "/absolute", "a//b", "a/./b", "a/../b", "a\\b", "a\0b"])(
    "refuses the unconfined path %s",
    (value) => {
      expect(() => confineEvidenceBundlePath(value)).toThrowError(ProjectEvidenceBundleError);
    }
  );

  it("refuses a recorded-checksum mismatch without emitting a partial archive", async () => {
    const altered = input();
    altered.selectedFiles[0] = { ...altered.selectedFiles[0], bytes: Buffer.from("changed") };
    await expect(buildProjectEvidenceBundle(altered)).rejects.toMatchObject({ code: "checksum_mismatch" });
  });

  it("refuses a stale candidate revision", async () => {
    const stale = input();
    stale.selectedFiles[0] = {
      ...stale.selectedFiles[0],
      candidate: { ...stale.selectedFiles[0].candidate, revisionToken: "0".repeat(64) },
    };
    await expect(buildProjectEvidenceBundle(stale)).rejects.toMatchObject({ code: "stale_review" });
  });

  it("accepts the exact per-file boundary and refuses one byte more", async () => {
    const exact = candidate({ recordedChecksumSha256: null, byteSize: PROJECT_EVIDENCE_FILE_BYTE_LIMIT });
    const atLimit = input({
      candidates: [exact],
      selectedFiles: [{ candidate: exact, bytes: Buffer.alloc(PROJECT_EVIDENCE_FILE_BYTE_LIMIT), filename: "large.bin", contentType: null }],
    });
    await expect(buildProjectEvidenceBundle(atLimit)).resolves.toBeTruthy();

    atLimit.selectedFiles[0] = { ...atLimit.selectedFiles[0], bytes: Buffer.alloc(PROJECT_EVIDENCE_FILE_BYTE_LIMIT + 1) };
    await expect(buildProjectEvidenceBundle(atLimit)).rejects.toMatchObject({ code: "file_too_large" });
  }, 30_000);

  it("refuses more than 200 selected files", async () => {
    const candidates = Array.from({ length: PROJECT_EVIDENCE_SELECTED_FILE_LIMIT + 1 }, (_, index) =>
      candidate({
        id: `knowledge_base:${String(index).padStart(36, "0")}`,
        recordId: String(index).padStart(36, "0"),
        recordedChecksumSha256: null,
      })
    );
    const over = input({
      candidates,
      selectedFiles: candidates.map((item) => ({ candidate: item, bytes: Buffer.from("x"), filename: `${item.recordId}.txt`, contentType: "text/plain" })),
    });
    await expect(buildProjectEvidenceBundle(over)).rejects.toMatchObject({ code: "selected_file_limit" });
  });
});
