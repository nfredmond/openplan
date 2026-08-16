import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCountyOnrampWorkerPayload,
  countyOnrampWorkerPayloadSchema,
  COUNTY_ONRAMP_CALLBACK_ORIGIN_ENV,
  resolveCountyOnrampCallbackOrigin,
  sanitizeCountyOnrampWorkerPayload,
} from "@/lib/api/county-onramp-worker";

describe("county onramp worker payload", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

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
    expect(payload.callback.manifestIngestUrl).toBe(
      "https://openplan.example.com/api/county-runs/123e4567-e89b-12d3-a456-426614174002/manifest"
    );
    expect(payload.artifactTargets.manifestPath).toContain("nevada-county-runtime-connectorbias2-20260324.manifest.json");
  });

  it("keeps callback bearer credentials out of sanitized payloads", () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN", "callback-secret");

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
      hasBearerToken: true,
    });
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
    expect(payload.artifactTargets.scaffoldCsvPath).toContain("pilot-placer-county/validation/placer_priority_count_scaffold_auto.csv");
  });

  it("derives the artifact path from the county prefix, for every county alike", () => {
    // There was a branch here that matched one FIPS code and returned a fixed
    // path, ignoring the operator's prefix for that county only. Two counties,
    // same explicit prefix, must differ in nothing but the prefix.
    const forCounty = (geographyId: string, geographyLabel: string) =>
      buildCountyOnrampWorkerPayload({
        origin: "https://openplan.example.com",
        jobId: "123e4567-e89b-12d3-a456-426614174031",
        countyRunId: "123e4567-e89b-12d3-a456-426614174032",
        input: {
          workspaceId: "123e4567-e89b-12d3-a456-426614174030",
          geographyType: "county_fips",
          geographyId,
          geographyLabel,
          runName: "run",
          countyPrefix: "OPERATOR_CHOICE",
          runtimeOptions: {},
        },
      }).artifactTargets.scaffoldCsvPath;

    expect(forCounty("06061", "Placer County, CA")).toBe(forCounty("48201", "Harris County, TX"));
    expect(forCounty("06061", "Placer County, CA")).toContain("pilot-operator_choice-county");
  });

  describe("where the worker is told to post a finished run back", () => {
    it("uses the origin of the request that launched it, by default", () => {
      expect(resolveCountyOnrampCallbackOrigin("http://localhost:3000", {})).toBe("http://localhost:3000");
    });

    it("prefers the configured origin, so a containerised worker can reach the app", () => {
      // Inside a bridge-networked container `localhost` is the container, where
      // nothing is listening: the model runs for minutes and the result goes
      // nowhere, silently, because nothing ever arrives to fail.
      expect(
        resolveCountyOnrampCallbackOrigin("http://localhost:3000", {
          [COUNTY_ONRAMP_CALLBACK_ORIGIN_ENV]: "http://host.docker.internal:3000",
        })
      ).toBe("http://host.docker.internal:3000");
    });

    it("ignores a blank setting rather than building a URL with no host", () => {
      expect(
        resolveCountyOnrampCallbackOrigin("http://localhost:3000", {
          [COUNTY_ONRAMP_CALLBACK_ORIGIN_ENV]: "   ",
        })
      ).toBe("http://localhost:3000");
    });

    it("reaches the payload the worker is actually handed", () => {
      // Resolving in the builder rather than at one call site is what keeps the
      // callback URL shown on the run page identical to the one dispatched.
      vi.stubEnv(COUNTY_ONRAMP_CALLBACK_ORIGIN_ENV, "http://host.docker.internal:3000/");

      const payload = buildCountyOnrampWorkerPayload({
        origin: "http://localhost:3000",
        jobId: "123e4567-e89b-12d3-a456-426614174041",
        countyRunId: "123e4567-e89b-12d3-a456-426614174042",
        input: {
          workspaceId: "123e4567-e89b-12d3-a456-426614174040",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "run",
          runtimeOptions: {},
        },
      });

      expect(payload.callback.manifestIngestUrl).toBe(
        "http://host.docker.internal:3000/api/county-runs/123e4567-e89b-12d3-a456-426614174042/manifest"
      );
    });
  });
});
