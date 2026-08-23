import { describe, expect, it } from "vitest";

import {
  buildAerialOrthoCatalog,
  verifyAerialOrthoCatalogRow,
  type AerialOrthoCatalogRow,
} from "@/lib/aerial/ortho-map-layers";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const MISSION_ID = "33333333-3333-4333-8333-333333333333";
const CUSTODY_ID = "44444444-4444-4444-8444-444444444444";

function row(overrides: Partial<AerialOrthoCatalogRow> = {}): AerialOrthoCatalogRow {
  return {
    id: CUSTODY_ID,
    workspace_id: WORKSPACE_ID,
    mission_id: MISSION_ID,
    kind: "ortho_preview",
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: `${WORKSPACE_ID}/${MISSION_ID}/job/ortho_preview.png`,
    byte_size: 4096,
    checksum_sha256: "a".repeat(64),
    content_type: "image/png",
    held_at: "2026-08-23T12:00:00Z",
    created_at: "2026-08-23T11:59:00Z",
    bounds_west: 7.1,
    bounds_south: 45.1,
    bounds_east: 7.2,
    bounds_north: 45.2,
    crs: "EPSG:32632",
    pixel_size_m: 0.04,
    aerial_missions: {
      id: MISSION_ID,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      title: "River crossing survey",
      collected_at: "2026-08-22T10:00:00Z",
      projects: null,
    },
    ...overrides,
  };
}

describe("verifyAerialOrthoCatalogRow", () => {
  it("admits one held PNG with custody proof, matching ownership and worker-reported placement", () => {
    const result = verifyAerialOrthoCatalogRow(row(), WORKSPACE_ID);
    expect(result.state).toBe("verified");
    if (result.state !== "verified") throw new Error("unreachable");
    expect(result.layer).toMatchObject({
      custodyId: CUSTODY_ID,
      missionId: MISSION_ID,
      checksumSha256: "a".repeat(64),
      bounds: [7.1, 45.1, 7.2, 45.2],
      nativeCrs: "EPSG:32632",
    });
  });

  it.each([
    ["cross-workspace custody", { workspace_id: OTHER_WORKSPACE_ID }],
    ["cross-workspace mission", { aerial_missions: { ...row().aerial_missions as object, workspace_id: OTHER_WORKSPACE_ID } }],
    ["mismatched mission", { aerial_missions: { ...row().aerial_missions as object, id: "55555555-5555-4555-8555-555555555555" } }],
    ["failed state", { state: "failed" }],
    ["wrong artifact kind", { kind: "orthomosaic" }],
    ["wrong bucket", { storage_bucket: "other" }],
    ["path traversal", { storage_path: "workspace/../other/preview.png" }],
    [
      "another mission's object path",
      { storage_path: `${OTHER_WORKSPACE_ID}/${MISSION_ID}/job/ortho_preview.png` },
    ],
    ["missing checksum", { checksum_sha256: null }],
    ["empty bytes", { byte_size: 0 }],
    ["wrong content type", { content_type: "image/tiff" }],
    ["missing placement", { bounds_west: null }],
    ["implausible placement", { bounds_west: -20, bounds_east: 20 }],
  ])("refuses %s", (_label, overrides) => {
    expect(verifyAerialOrthoCatalogRow(row(overrides), WORKSPACE_ID).state).toBe("unavailable");
  });
});

describe("buildAerialOrthoCatalog", () => {
  it("keeps the newest verified preview per mission and counts exclusions", () => {
    const older = row({
      id: "66666666-6666-4666-8666-666666666666",
      held_at: "2026-08-20T12:00:00Z",
    });
    const invalidOtherMission = row({
      id: "77777777-7777-4777-8777-777777777777",
      mission_id: "88888888-8888-4888-8888-888888888888",
      aerial_missions: {
        id: "88888888-8888-4888-8888-888888888888",
        workspace_id: WORKSPACE_ID,
        title: "Second survey",
      },
      checksum_sha256: null,
    });

    const catalog = buildAerialOrthoCatalog([older, invalidOtherMission, row()], WORKSPACE_ID);

    expect(catalog.state).toBe("verified");
    expect(catalog.layers).toHaveLength(1);
    expect(catalog.layers[0].custodyId).toBe(CUSTODY_ID);
    expect(catalog.notes.join(" ")).toMatch(/orientation/);
    expect(catalog.notes.join(" ")).toMatch(/1 preview record is not offered/);
  });

  it("keeps absent separate from records that exist but are unavailable", () => {
    expect(buildAerialOrthoCatalog([], WORKSPACE_ID).state).toBe("absent");
    expect(buildAerialOrthoCatalog([row({ state: "failed" })], WORKSPACE_ID).state).toBe("unavailable");
  });
});
