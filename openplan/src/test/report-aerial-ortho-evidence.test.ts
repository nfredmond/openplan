import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  freezeReportAerialOrthoSnapshot,
  readReportAerialOrthoSelections,
  REPORT_AERIAL_ORTHO_CAVEAT,
  verifyFrozenReportAerialOrthoSnapshots,
  writeReportAerialOrthoSelections,
} from "@/lib/reports/aerial-ortho-evidence";
import { freezeSelectedReportAerialOrtho } from "@/lib/reports/aerial-ortho-evidence-server";
import { buildProjectGrantAerialOrthoEvidenceByProjectId } from "@/lib/grants/modeling-evidence";
import { buildOpportunityFactList, type OpportunityEvidenceBundle } from "@/lib/grants/narrative-evidence";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";

const IDS = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  reportId: "33333333-3333-4333-8333-333333333333",
  artifactId: "44444444-4444-4444-8444-444444444444",
  custodyId: "55555555-5555-4555-8555-555555555555",
  missionId: "66666666-6666-4666-8666-666666666666",
};

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const checksum = createHash("sha256").update(bytes).digest("hex");

function layer() {
  return {
    custodyId: IDS.custodyId,
    missionId: IDS.missionId,
    projectId: IDS.projectId,
    missionTitle: "River crossing flight",
    projectName: "River crossing",
    collectedAt: "2026-08-20T17:00:00.000Z",
    heldAt: "2026-08-21T17:00:00.000Z",
    checksumSha256: checksum,
    byteSize: bytes.byteLength,
    bounds: [-121.2, 39.1, -121.1, 39.2] as [number, number, number, number],
    nativeCrs: "EPSG:32610",
    pixelSizeM: 0.08,
  };
}

function snapshot() {
  return freezeReportAerialOrthoSnapshot({
    layer: layer(),
    ...IDS,
    frozenAt: "2026-08-23T17:00:00.000Z",
    frozenChecksumSha256: checksum,
  });
}

function custodyRow() {
  return {
    id: IDS.custodyId,
    workspace_id: IDS.workspaceId,
    mission_id: IDS.missionId,
    kind: "ortho_preview",
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: `${IDS.workspaceId}/${IDS.missionId}/job/ortho-preview.png`,
    byte_size: bytes.byteLength,
    checksum_sha256: checksum,
    content_type: "image/png",
    held_at: "2026-08-21T17:00:00.000Z",
    bounds_west: -121.2,
    bounds_south: 39.1,
    bounds_east: -121.1,
    bounds_north: 39.2,
    crs: "EPSG:32610",
    pixel_size_m: 0.08,
    aerial_missions: {
      id: IDS.missionId,
      workspace_id: IDS.workspaceId,
      project_id: IDS.projectId,
      title: "River crossing flight",
      collected_at: "2026-08-20T17:00:00.000Z",
      projects: { name: "River crossing" },
    },
  };
}

function queryClient(row = custodyRow()) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  return { from: vi.fn(() => query) };
}

describe("report aerial orthophoto evidence", () => {
  it("keeps an explicit zero-or-one selection in report metadata", () => {
    expect(readReportAerialOrthoSelections({})).toEqual([]);
    const metadata = writeReportAerialOrthoSelections({ keep: true }, [{ custodyId: IDS.custodyId }]);
    expect(readReportAerialOrthoSelections(metadata)).toEqual([{ custodyId: IDS.custodyId }]);
    expect(metadata.keep).toBe(true);
  });

  it("verifies packet identity, hashes, map placement, and the mandatory caveat", () => {
    const frozen = snapshot();
    const verified = verifyFrozenReportAerialOrthoSnapshots(
      { aerialOrthoSnapshotsV1: [frozen] },
      IDS,
    );
    expect(verified.status).toBe("verified");

    for (const mutation of [
      { ...frozen, projectId: "77777777-7777-4777-8777-777777777777" },
      { ...frozen, frozenChecksumSha256: "f".repeat(64) },
      { ...frozen, bounds: [5, 5, 4, 6] },
      { ...frozen, caveat: "Survey-grade." },
      { ...frozen, storagePath: "another/report/image.png" },
    ]) {
      expect(verifyFrozenReportAerialOrthoSnapshots({ aerialOrthoSnapshotsV1: [mutation] }, IDS).status).toBe("invalid");
    }
    expect(frozen.caveat).toBe(REPORT_AERIAL_ORTHO_CAVEAT);
  });

  it("re-hashes held PNG bytes and uploads the unchanged frozen copy", async () => {
    const user = queryClient();
    const upload = vi.fn(async () => ({ error: null }));
    const service = {
      storage: {
        from: vi.fn((bucket: string) => bucket === "aerial-artifacts"
          ? { download: vi.fn(async () => ({ data: new Blob([bytes]), error: null })), upload }
          : { download: vi.fn(), upload }),
      },
    };
    const result = await freezeSelectedReportAerialOrtho({
      supabase: user,
      serviceSupabase: service,
      ...IDS,
      frozenAt: "2026-08-23T17:00:00.000Z",
    });
    expect(result.status).toBe("verified");
    expect(upload).toHaveBeenCalledWith(
      `${IDS.workspaceId}/${IDS.reportId}/${IDS.artifactId}/aerial/${IDS.custodyId}.png`,
      bytes,
      { contentType: "image/png", upsert: false },
    );
  });

  it("refuses altered bytes before they can enter a packet", async () => {
    const altered = new Uint8Array([...bytes.slice(0, -1), 4]);
    const user = queryClient();
    const upload = vi.fn();
    const service = { storage: { from: vi.fn(() => ({ download: vi.fn(async () => ({ data: new Blob([altered]), error: null })), upload })) } };
    const result = await freezeSelectedReportAerialOrtho({ supabase: user, serviceSupabase: service, ...IDS, frozenAt: "2026-08-23T17:00:00.000Z" });
    expect(result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/custody hash/i) });
    expect(upload).not.toHaveBeenCalled();
  });

  it("builds grant evidence only from the frozen report artifact and fails closed on alteration", () => {
    const reports = [{
      id: IDS.reportId,
      project_id: IDS.projectId,
      title: "Aerial evidence packet",
      updated_at: "2026-08-23T17:00:00.000Z",
      generated_at: "2026-08-23T17:00:00.000Z",
      latest_artifact_kind: "pdf",
    }];
    const good = buildProjectGrantAerialOrthoEvidenceByProjectId(reports, [{
      id: IDS.artifactId,
      report_id: IDS.reportId,
      generated_at: "2026-08-23T17:00:00.000Z",
      metadata_json: { aerialOrthoSnapshotsV1: [snapshot()] },
    }]);
    expect(good.readFailures).toEqual([]);
    const evidence = good.evidenceByProjectId.get(IDS.projectId);
    expect(evidence?.leadReport.snapshots[0].missionTitle).toBe("River crossing flight");
    if (!evidence) return;
    const bundle: OpportunityEvidenceBundle = {
      opportunity: { id: "opportunity-1", workspace_id: IDS.workspaceId, program_id: null, project_id: IDS.projectId, title: "Resilience grant", opportunity_status: "open", decision_state: "pursue" },
      projectName: "River crossing",
      fundingSummary: null,
      modelingEvidence: null,
      modelingHeadline: null,
      modelingReadinessDetail: null,
      aerialOrthoEvidence: evidence,
      bcaScreening: null,
      engagementEvidence: null,
      evidenceReadinessSummary: "Review evidence before submission.",
      kbExcerpts: [],
      linkedProjectStage: null,
      rtpProgramming: null,
      completedProjects: null,
      readFailures: [],
    };
    const facts = buildOpportunityFactList(bundle, { suggestedEvidence: ["project"] });
    const aerialFact = facts.find((fact) => fact.claim_text.includes("Planner-selected orthophoto evidence"));
    expect(aerialFact?.claim_text).toContain(checksum);
    expect(aerialFact?.claim_text).toContain("not survey-grade");
    expect(aerialFact?.claim_text).toContain("west -121.2, south 39.1, east -121.1, north 39.2");
    expect(validateGroundedNarrative(
      `The selected preview is orientation-only. [fact:${aerialFact?.fact_id}]`,
      facts.map((fact) => fact.fact_id),
      "annotated",
    ).isFullyGrounded).toBe(true);

    const altered = { ...snapshot(), caveat: "Survey-grade." };
    const bad = buildProjectGrantAerialOrthoEvidenceByProjectId(reports, [{
      id: IDS.artifactId,
      report_id: IDS.reportId,
      generated_at: "2026-08-23T17:00:00.000Z",
      metadata_json: { aerialOrthoSnapshotsV1: [altered] },
    }]);
    expect(bad.evidenceByProjectId.size).toBe(0);
    expect(bad.readFailures[0]?.reason).toMatch(/caveat/i);
  });
});
