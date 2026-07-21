import { describe, expect, it } from "vitest";
import {
  buildProcessingRequest,
  CONTRACT_SCHEMA_VERSION,
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
  it("accepts a valid processing request", () => {
    expect(processingRequestSchema.safeParse(validRequest).success).toBe(true);
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
  it("accepts a valid running callback", () => {
    expect(processingCallbackSchema.safeParse(validRunningCallback).success).toBe(true);
  });

  it("accepts a valid succeeded callback with artifacts", () => {
    expect(processingCallbackSchema.safeParse(validSucceededCallback).success).toBe(true);
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
  it("assembles a contract-conformant request", () => {
    const request = buildProcessingRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
      missionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      projectId: null,
      missionTitle: "  Hwy 49 corridor survey  ",
      imageryZipUrl: "https://storage.example.com/imagery.zip",
      imageCount: 12,
      sizeBytes: 1024,
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

  it("truncates overlong mission titles to the contract maximum", () => {
    const request = buildProcessingRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackUrl: "https://openplan.example.com/api/aerial/processing-callback",
      missionId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      missionTitle: "x".repeat(300),
      imageryZipUrl: "https://storage.example.com/imagery.zip",
    });

    expect(request.missionTitle).toHaveLength(256);
  });
});
