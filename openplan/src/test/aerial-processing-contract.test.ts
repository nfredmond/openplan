import { describe, expect, it } from "vitest";
import {
  buildProcessingRequest,
  CONTRACT_SCHEMA_VERSION,
  CONTRACT_SCHEMA_VERSION_V1_1,
  processingCallbackSchema,
  processingRequestSchema,
} from "@/lib/aerial/processing-contract";

const validRequest = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  requestId: "11111111-1111-4111-8111-111111111111",
  callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
  externalRef: {
    system: "openplan",
    missionId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "33333333-3333-4333-8333-333333333333",
    projectId: "44444444-4444-4444-8444-444444444444",
  },
  missionTitle: "Hwy 49 corridor survey",
  imagery: {
    type: "zip_url",
    url: "https://storage.example.com/imagery.zip?signature=abc",
    imageCount: 240,
    sizeBytes: 1024 * 1024 * 512,
  },
  presetId: "balanced",
  notes: "Rush processing for the corridor study.",
};

const validManifestRequest = {
  schemaVersion: CONTRACT_SCHEMA_VERSION_V1_1,
  requestId: "11111111-1111-4111-8111-111111111111",
  callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
  externalRef: {
    system: "openplan",
    missionId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "33333333-3333-4333-8333-333333333333",
  },
  missionTitle: "Hwy 49 corridor survey",
  imagery: {
    type: "photo_manifest",
    photos: [
      {
        url: "https://storage.example.com/photos/DJI_0001.JPG?signature=a",
        filename: "DJI_0001.JPG",
        sizeBytes: 8_400_000,
        checksumSha256: "a".repeat(64),
      },
      {
        url: "https://storage.example.com/photos/DJI_0002.JPG?signature=b",
        filename: "DJI_0002.JPG",
      },
    ],
    imageCount: 2,
    totalSizeBytes: 16_800_000,
  },
  presetId: "balanced",
};

const validRunningCallback = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  requestId: "11111111-1111-4111-8111-111111111111",
  callbackId: "cb-0000000001",
  jobReference: "55555555-5555-4555-8555-555555555555",
  status: "running",
  occurredAt: "2026-07-21T12:00:00Z",
  progress: 42.5,
  message: "Feature extraction underway",
};

const validSucceededCallback = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  requestId: "11111111-1111-4111-8111-111111111111",
  callbackId: "cb-0000000002",
  jobReference: "55555555-5555-4555-8555-555555555555",
  status: "succeeded",
  occurredAt: "2026-07-21T14:30:00Z",
  progress: 100,
  artifacts: [
    {
      kind: "orthomosaic",
      downloadUrl: "https://storage.example.com/ortho.tif?signature=def",
      expiresAt: "2026-07-22T14:30:00Z",
      sizeBytes: 123456789,
      contentType: "image/tiff",
    },
    {
      kind: "dsm",
      downloadUrl: "https://storage.example.com/dsm.tif?signature=ghi",
      expiresAt: "2026-07-22T14:30:00Z",
    },
  ],
  benchmarkSummary: { wallClockSeconds: 812, preset: "balanced" },
};

describe("processingRequestSchema", () => {
  /**
   * THE COMPATIBILITY CONTRACT OF REVISION v1.1. The external Aerial Intel
   * Platform validates v1 strictly and was NOT upgraded in lockstep with this
   * repo — so the exact payload shape it has always received must keep
   * validating, byte for byte, with no v1.1 marker anywhere in it. If this
   * test fails, v1.1 stopped being additive and the external worker lane is
   * broken.
   */
  it("still accepts the external-worker-shaped v1 payload unchanged", () => {
    expect(processingRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("accepts a v1.1 photo_manifest request", () => {
    expect(processingRequestSchema.safeParse(validManifestRequest).success).toBe(true);
  });

  it("rejects a zip_url request that declares v1.1 — zip dispatch must stay byte-identical v1", () => {
    const result = processingRequestSchema.safeParse({
      ...validRequest,
      schemaVersion: CONTRACT_SCHEMA_VERSION_V1_1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a photo_manifest request that declares v1 — a v1-only worker must refuse it loudly", () => {
    const result = processingRequestSchema.safeParse({
      ...validManifestRequest,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a manifest whose imageCount disagrees with photos.length", () => {
    const result = processingRequestSchema.safeParse({
      ...validManifestRequest,
      imagery: { ...validManifestRequest.imagery, imageCount: 3 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a manifest photo with an uppercase-hex checksum", () => {
    const result = processingRequestSchema.safeParse({
      ...validManifestRequest,
      imagery: {
        ...validManifestRequest.imagery,
        photos: [
          {
            url: "https://storage.example.com/photos/DJI_0001.JPG",
            filename: "DJI_0001.JPG",
            checksumSha256: "A".repeat(64),
          },
          validManifestRequest.imagery.photos[1],
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty photo manifest", () => {
    const result = processingRequestSchema.safeParse({
      ...validManifestRequest,
      imagery: { type: "photo_manifest", photos: [], imageCount: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    const result = processingRequestSchema.safeParse({
      ...validRequest,
      schemaVersion: "natford-aerial-processing.v2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra properties", () => {
    const result = processingRequestSchema.safeParse({
      ...validRequest,
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a short requestId", () => {
    const result = processingRequestSchema.safeParse({
      ...validRequest,
      requestId: "short",
    });
    expect(result.success).toBe(false);
  });
});

describe("processingCallbackSchema", () => {
  it("still accepts the external-worker-shaped v1 callbacks unchanged", () => {
    expect(processingCallbackSchema.safeParse(validRunningCallback).success).toBe(true);
    expect(processingCallbackSchema.safeParse(validSucceededCallback).success).toBe(true);
  });

  it("accepts a v1.1 callback", () => {
    const result = processingCallbackSchema.safeParse({
      ...validRunningCallback,
      schemaVersion: CONTRACT_SCHEMA_VERSION_V1_1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an ortho_preview artifact carrying v1.1 georeferencing", () => {
    const result = processingCallbackSchema.safeParse({
      ...validSucceededCallback,
      artifacts: [
        ...validSucceededCallback.artifacts,
        {
          kind: "ortho_preview",
          downloadUrl: "https://storage.example.com/ortho.png?signature=jkl",
          expiresAt: "2026-07-22T14:30:00Z",
          contentType: "image/png",
          boundsWgs84: [-121.07, 39.2, -121.05, 39.22],
          crs: "EPSG:32610",
          pixelSizeM: 0.043,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts georeferencing fields on a v1-versioned callback (our worker's zip jobs echo v1)", () => {
    const result = processingCallbackSchema.safeParse({
      ...validSucceededCallback,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      artifacts: [
        {
          kind: "orthomosaic",
          downloadUrl: "https://storage.example.com/ortho.tif?signature=def",
          expiresAt: "2026-07-22T14:30:00Z",
          boundsWgs84: [-121.07, 39.2, -121.05, 39.22],
          crs: "EPSG:32610",
          pixelSizeM: 0.043,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects bounds that do not open west<east, south<north", () => {
    const result = processingCallbackSchema.safeParse({
      ...validSucceededCallback,
      artifacts: [
        {
          kind: "orthomosaic",
          downloadUrl: "https://storage.example.com/ortho.tif",
          expiresAt: "2026-07-22T14:30:00Z",
          boundsWgs84: [-121.05, 39.22, -121.07, 39.2],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects bounds outside WGS84 ranges or with the wrong arity", () => {
    const outOfRange = processingCallbackSchema.safeParse({
      ...validSucceededCallback,
      artifacts: [
        {
          kind: "orthomosaic",
          downloadUrl: "https://storage.example.com/ortho.tif",
          expiresAt: "2026-07-22T14:30:00Z",
          boundsWgs84: [-181, 39.2, -121.05, 39.22],
        },
      ],
    });
    expect(outOfRange.success).toBe(false);

    const threeCorners = processingCallbackSchema.safeParse({
      ...validSucceededCallback,
      artifacts: [
        {
          kind: "orthomosaic",
          downloadUrl: "https://storage.example.com/ortho.tif",
          expiresAt: "2026-07-22T14:30:00Z",
          boundsWgs84: [-121.07, 39.2, -121.05],
        },
      ],
    });
    expect(threeCorners.success).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    const result = processingCallbackSchema.safeParse({
      ...validRunningCallback,
      schemaVersion: "some-other-contract.v1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a callbackId shorter than 8 characters", () => {
    const result = processingCallbackSchema.safeParse({
      ...validRunningCallback,
      callbackId: "cb-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra properties", () => {
    const result = processingCallbackSchema.safeParse({
      ...validRunningCallback,
      missionId: "not-in-the-contract",
    });
    expect(result.success).toBe(false);
  });

  it("rejects succeeded callbacks without artifacts", () => {
    const { artifacts: _artifacts, ...withoutArtifacts } = validSucceededCallback;
    const result = processingCallbackSchema.safeParse(withoutArtifacts);
    expect(result.success).toBe(false);
  });

  it("rejects progress above 100", () => {
    const result = processingCallbackSchema.safeParse({
      ...validRunningCallback,
      progress: 100.01,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown artifact kind", () => {
    const result = processingCallbackSchema.safeParse({
      ...validSucceededCallback,
      artifacts: [
        {
          kind: "contour_lines",
          downloadUrl: "https://storage.example.com/contours.geojson",
          expiresAt: "2026-07-22T14:30:00Z",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("buildProcessingRequest", () => {
  it("assembles a contract-conformant zip request that declares v1", () => {
    const request = buildProcessingRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
      missionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      projectId: null,
      missionTitle: "  Hwy 49 corridor survey  ",
      imagery: {
        type: "zip_url",
        url: "https://storage.example.com/imagery.zip",
        imageCount: 12,
        sizeBytes: 1024,
      },
      notes: "  quick pass  ",
    });

    expect(request.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION);
    expect(request.missionTitle).toBe("Hwy 49 corridor survey");
    expect(request.presetId).toBe("balanced");
    expect(request.externalRef).toEqual({
      system: "openplan",
      missionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
    });
    expect(request.imagery).toEqual({
      type: "zip_url",
      url: "https://storage.example.com/imagery.zip",
      imageCount: 12,
      sizeBytes: 1024,
    });
    expect(request.notes).toBe("quick pass");
    expect(processingRequestSchema.safeParse(request).success).toBe(true);
  });

  it("assembles a manifest request that declares v1.1 and computes imageCount from the photos", () => {
    const request = buildProcessingRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
      missionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      missionTitle: "Hwy 49 corridor survey",
      imagery: {
        type: "photo_manifest",
        photos: [
          {
            url: "https://storage.example.com/photos/DJI_0001.JPG?sig=a",
            filename: "DJI_0001.JPG",
            sizeBytes: 8_400_000,
            checksumSha256: "b".repeat(64),
          },
          {
            url: "https://storage.example.com/photos/DJI_0002.JPG?sig=b",
            filename: "DJI_0002.JPG",
            sizeBytes: null,
            checksumSha256: null,
          },
        ],
        totalSizeBytes: 8_400_000,
      },
    });

    expect(request.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION_V1_1);
    expect(request.imagery).toEqual({
      type: "photo_manifest",
      photos: [
        {
          url: "https://storage.example.com/photos/DJI_0001.JPG?sig=a",
          filename: "DJI_0001.JPG",
          sizeBytes: 8_400_000,
          checksumSha256: "b".repeat(64),
        },
        {
          url: "https://storage.example.com/photos/DJI_0002.JPG?sig=b",
          filename: "DJI_0002.JPG",
        },
      ],
      imageCount: 2,
      totalSizeBytes: 8_400_000,
    });
    expect(processingRequestSchema.safeParse(request).success).toBe(true);
  });

  it("truncates overlong mission titles to the contract maximum", () => {
    const request = buildProcessingRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
      missionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      missionTitle: "x".repeat(300),
      imagery: { type: "zip_url", url: "https://storage.example.com/imagery.zip" },
    });

    expect(request.missionTitle).toHaveLength(256);
  });
});
