import { describe, expect, it } from "vitest";
import {
  buildCountyOnrampWorkerPayload,
  countyOnrampWorkerPayloadSchema,
  sanitizeCountyOnrampWorkerPayload,
} from "@/lib/api/county-onramp-worker";

describe("county onramp worker payload", () => {
  it("builds a valid payload from a create request", () => {
    const payload = buildCountyOnrampWorkerPayload({
      origin: "https://openplan.example.com",
      jobId: "123e4567-e89b-12d3-a456-426614174001",
      countyRunId: "123e4567-e89b-12d3-a456-426614174002",
      input: {
        workspaceId: "123e4567-e89b-12d3-a456-426614174000",
        geographyType: "county_fips",
        geographyId: "06057",
        geographyLabel: "Nevada County, CA",
        runName: "nevada-county-runtime-connectorbias2-20260324",
        runtimeOptions: {
          keepProject: true,
          overallDemandScalar: 0.369,
        },
      },
    });

    expect(countyOnrampWorkerPayloadSchema.parse(payload)).toBeTruthy();
    expect(payload.countyPrefix).toBe("NEVADA");
    expect(payload.runtimeOptions.keepProject).toBe(true);
    expect(payload.runtimeOptions.force).toBe(true);
    expect(payload.runtimeOptions.overallDemandScalar).toBe(0.369);
    expect(payload.runtimeOptions.activitysimContainerImage).toBeNull();
    expect(payload.runtimeOptions.containerEngineCli).toBeNull();
    expect(payload.runtimeOptions.activitysimContainerCliTemplate).toBeNull();
    expect(payload.runtimeOptions.containerNetworkMode).toBeNull();
    expect(payload.callback.manifestIngestUrl).toBe(
      "https://openplan.example.com/api/county-runs/123e4567-e89b-12d3-a456-426614174002/manifest"
    );
    expect(payload.artifactTargets.manifestPath).toContain(
      "tmp/county-onramp/nevada-county-06057/nevada-county-runtime-connectorbias2-20260324.manifest.json"
    );
  });

  it("uses explicit county prefixes when provided", () => {
    const payload = buildCountyOnrampWorkerPayload({
      origin: "https://openplan.example.com/",
      jobId: "123e4567-e89b-12d3-a456-426614174011",
      countyRunId: "123e4567-e89b-12d3-a456-426614174012",
      input: {
        workspaceId: "123e4567-e89b-12d3-a456-426614174010",
        geographyType: "county_fips",
        geographyId: "06061",
        geographyLabel: "Placer County, CA",
        runName: "placer-county-runtime-connectorbias2-20260324",
        countyPrefix: "PLACER",
        runtimeOptions: {},
      },
    });

    expect(payload.countyPrefix).toBe("PLACER");
    expect(payload.artifactTargets.scaffoldCsvPath).toContain(
      "data/county-runs/placer-county-06061/validation/placer-county-06061-priority-count-scaffold-auto.csv"
    );
  });

  it("threads optional ActivitySim container runtime settings into the worker payload", () => {
    const payload = buildCountyOnrampWorkerPayload({
      origin: "https://openplan.example.com",
      jobId: "123e4567-e89b-12d3-a456-426614174031",
      countyRunId: "123e4567-e89b-12d3-a456-426614174032",
      input: {
        workspaceId: "123e4567-e89b-12d3-a456-426614174030",
        geographyType: "county_fips",
        geographyId: "06057",
        geographyLabel: "Nevada County, CA",
        runName: "nevada-county-container-runtime-20260327",
        runtimeOptions: {
          activitysimContainerImage: "python:3.11-slim",
          containerEngineCli: "docker",
          activitysimContainerCliTemplate: "python -m pip install activitysim && activitysim run",
          containerNetworkMode: "bridge",
        },
      },
    });

    expect(payload.runtimeOptions.activitysimContainerImage).toBe("python:3.11-slim");
    expect(payload.runtimeOptions.containerEngineCli).toBe("docker");
    expect(payload.runtimeOptions.activitysimContainerCliTemplate).toBe(
      "python -m pip install activitysim && activitysim run"
    );
    expect(payload.runtimeOptions.containerNetworkMode).toBe("bridge");
  });

  it("includes callback bearer tokens when configured and can sanitize them for browser responses", () => {
    process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN = "callback-secret";

    const payload = buildCountyOnrampWorkerPayload({
      origin: "https://openplan.example.com",
      jobId: "123e4567-e89b-12d3-a456-426614174021",
      countyRunId: "123e4567-e89b-12d3-a456-426614174022",
      input: {
        workspaceId: "123e4567-e89b-12d3-a456-426614174020",
        geographyType: "county_fips",
        geographyId: "06057",
        geographyLabel: "Nevada County, CA",
        runName: "nevada-county-runtime-connectorbias2-20260324",
        runtimeOptions: {},
      },
    });

    expect(payload.callback.bearerToken).toBe("callback-secret");
    expect(sanitizeCountyOnrampWorkerPayload(payload).callback).toEqual({
      manifestIngestUrl: "https://openplan.example.com/api/county-runs/123e4567-e89b-12d3-a456-426614174022/manifest",
    });

    delete process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN;
  });
});
