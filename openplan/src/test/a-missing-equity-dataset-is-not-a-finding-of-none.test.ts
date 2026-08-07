import { describe, expect, it, vi } from "vitest";

/**
 * A DATASET THAT DID NOT LOAD MUST NOT READ AS "NOBODY HERE IS DISADVANTAGED".
 *
 * `cejst-national.ts` throws `DesignationSourceUnavailableError` when its
 * bundled asset is missing or malformed, and the whole equity-designation lane
 * is built around that throw: `resolveJustice40ForTracts` catches it and returns
 * `not_determined` with cause `source_unavailable`, which the disclosure layer
 * renders as "could not be loaded" rather than as a determination.
 *
 * Mutating that throw into `return { empty sets }` on 2026-08-06 left the entire
 * 7,471-test suite green. With empty sets every GEOID misses the lookup, so the
 * lane reports zero determined and zero disadvantaged tracts — and an agency
 * reads "no tract in this corridor is a disadvantaged community" off a file that
 * failed to load. That is the single failure mode the module's own doc comment
 * says must never happen ("never returns empty-as-negative").
 *
 * The asset is mocked malformed here because it is the only way to reach the
 * branch: the real bundled file is well-formed, which is exactly why nothing was
 * testing this.
 */

vi.mock("@/lib/data-sources/equity-designation/data/cejst-v1.0-communities.json", () => ({
  // Shape a truncated download or a bad merge would leave behind: the meta block
  // survives, the arrays the lookup needs do not.
  default: {
    meta: {
      datasetLabel: "CEJST v1.0",
      version: "1.0",
      tractVintage: "2010",
      license: "Public domain",
      totalTracts: 74134,
      disadvantagedTracts: 27248,
      programStatus: "discontinued",
      source: "usds/justice40-tool",
    },
    coveredGeoids: null,
    disadvantagedGeoids: null,
  },
}));

import { cejstNationalAdapter } from "@/lib/data-sources/equity-designation/cejst-national";
import { resolveJustice40ForTracts } from "@/lib/data-sources/equity-designation/registry";
import { DesignationSourceUnavailableError } from "@/lib/data-sources/equity-designation/types";

// Alabama — inside the CONUS envelope, so coverage is not the reason for any
// refusal below.
const AL_BBOX = { minLon: -88, minLat: 30, maxLon: -87.9, maxLat: 30.1 };
const REAL_GEOIDS = ["01003010100", "01001020100"];

describe("an unloadable CEJST asset refuses instead of answering", () => {
  it("throws DesignationSourceUnavailableError rather than returning empty sets", async () => {
    await expect(cejstNationalAdapter.lookup(REAL_GEOIDS)).rejects.toBeInstanceOf(
      DesignationSourceUnavailableError
    );
  });

  it("names the source on the error so disclosure can say which one failed", async () => {
    await expect(cejstNationalAdapter.lookup(REAL_GEOIDS)).rejects.toMatchObject({
      sourceId: "cejst-national",
    });
  });

  it("resolves to not_determined/source_unavailable, never to not_disadvantaged", async () => {
    const determination = await resolveJustice40ForTracts(AL_BBOX, REAL_GEOIDS);

    expect(determination.status).toBe("not_determined");
    expect(determination.notDeterminedCause).toBe("source_unavailable");

    // The distinction that matters. Zero disadvantaged tracts is what an empty
    // set would also produce — so the load-bearing assertion is that zero tracts
    // were DETERMINED, and that every requested tract is counted undetermined.
    expect(determination.coverage.determinedTracts).toBe(0);
    expect(determination.coverage.undeterminedTracts).toBe(REAL_GEOIDS.length);
    expect(determination.coverage.totalTracts).toBe(REAL_GEOIDS.length);
    expect(determination.status).not.toBe("not_disadvantaged");
  });
});
