/**
 * Oregon's crash layer as a crash source: what is asked, what is mapped, and
 * what an outage looks like.
 *
 * The network is replaced by responses recorded once from ODOT's layer on
 * 2026-11-01 (`fixtures/odot-or-crash-layer-2026-11-01.json`: 17 crashes in a
 * small box in Madras, 2023). The fake answers by query shape, so it checks
 * what the adapter ASKS (fields, filters, envelope) as well as how it reads
 * the answer.
 *
 * Blind category: the live layer's drift. A renamed field or a replaced layer
 * is caught in production by the error-body and missing-features refusals
 * below, not by this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/odot-or-crash-layer-2026-11-01.json";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import {
  ODOT_OR_LAYER_URL,
  ODOT_OR_REQUESTED_COLUMNS,
  ODOT_OR_SOURCE_ID,
  fetchOdotCrashes,
  odotInjuredCount,
  odotOrAdapter,
  toOdotCollisionDate,
} from "@/lib/safety/sources/odot-or";
import { ODOT_OR_VOCABULARY } from "@/lib/safety/sources/odot-or-vocabulary";
import { OBSERVED_CRASH_SOURCE_IDS, crashSourcesForStudyArea } from "@/lib/safety/sources/registry";
import { CrashSourceUnavailableError } from "@/lib/safety/sources/types";
import { findDescriptorVocabularyViolations, mapCrashDimension } from "@/lib/safety/vocabulary";
import { farsAdapter } from "@/lib/safety/sources/fars";

const OREGON = ["41"];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Override = Partial<Record<"years" | "count" | "features", unknown>>;

/** Answer each query by its shape, from the recorded responses unless overridden. */
function installLayer(override: Override = {}) {
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url);
    const params = url.searchParams;
    if (params.get("groupByFieldsForStatistics")) return jsonResponse(override.years ?? fixture.responses.years);
    if (params.get("returnCountOnly") === "true") return jsonResponse(override.count ?? fixture.responses.count);
    return jsonResponse(override.features ?? fixture.responses.features);
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return { urls, fetchMock };
}

beforeEach(() => __clearFetchJsonResponseCacheForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __clearFetchJsonResponseCacheForTests();
});

describe("the Oregon descriptor", () => {
  it("maps only into the neutral vocabulary", () => {
    expect(findDescriptorVocabularyViolations(ODOT_OR_VOCABULARY)).toEqual([]);
  });

  it("takes severity from the source's own KABCO letter, with serious injury kept apart", () => {
    const severity = (raw: string) => mapCrashDimension(ODOT_OR_VOCABULARY, "severity", raw)?.value;
    expect(["K", "A", "B", "C", "O"].map(severity)).toEqual(["fatal", "severe_injury", "injury", "injury", "pdo"]);
    // A letter the manual does not define is not classified, and is counted.
    expect(mapCrashDimension(ODOT_OR_VOCABULARY, "severity", "U")).toEqual({ value: "unknown", raw: "U", unmapped: true });
    expect(mapCrashDimension(ODOT_OR_VOCABULARY, "severity", null)?.value).toBe("unknown");
  });

  it("does not guess a manner for ODOT's turning-movement class", () => {
    expect(mapCrashDimension(ODOT_OR_VOCABULARY, "collision_type", "Turning Movement")).toEqual({
      value: "other",
      raw: "Turning Movement",
      unmapped: true,
    });
  });
});

describe("Oregon parsing helpers", () => {
  it("builds the date from the coded year, month and day, and refuses impossible ones", () => {
    expect(toOdotCollisionDate("2023", "02", "06")).toBe("2023-02-06");
    expect(toOdotCollisionDate("2023", "2", "6")).toBe("2023-02-06");
    expect(toOdotCollisionDate("2023", "02", "30")).toBeNull();
    expect(toOdotCollisionDate("2023", "", "06")).toBeNull();
  });

  it("keeps an unreadable injury count unknown instead of zero", () => {
    expect(odotInjuredCount(1, 0, 2)).toBe(3);
    expect(odotInjuredCount(null, null, null)).toBeNull();
    expect(odotInjuredCount(null, 2, null)).toBe(2);
  });
});

describe("fetching Oregon crashes", () => {
  const bbox = fixture.bbox;

  it("maps the recorded crashes with the source's severity", async () => {
    installLayer();
    const result = await fetchOdotCrashes({ bbox, years: [fixture.year] });

    expect(result.records).toHaveLength(17);
    expect(result.matchedTotal).toBe(17);
    expect(result.geocodedTotal).toBe(17);
    const bySeverity = result.records.reduce<Record<string, number>>((tally, record) => {
      tally[record.severity] = (tally[record.severity] ?? 0) + 1;
      return tally;
    }, {});
    expect(bySeverity).toEqual({ fatal: 1, severe_injury: 1, injury: 5, pdo: 10 });

    const fatal = result.records.find((record) => record.externalId === "1980648");
    expect(fatal).toMatchObject({
      collisionDate: "2023-02-06",
      collisionYear: 2023,
      killedCount: 1,
      injuredCount: 1,
      // TOT_PED_CNT is 2 for this crash; the layer's "present" flag says 0.
      pedestrianInvolved: true,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionType: "vehicle_pedestrian",
      lighting: "dark_lighted",
      weather: "clear",
      stateFips: "41",
      sourceId: ODOT_OR_SOURCE_ID,
    });
    expect(fatal?.longitude).toBeCloseTo(-121.142, 3);
    expect(fatal?.latitude).toBeCloseTo(44.619, 3);

    // Undeclared spellings are kept and counted, not guessed.
    expect(result.unmappedByDimension?.collision_type).toBe(7);
    expect(result.yearsQueried).toEqual([2023]);
    expect(result.truncated).toBe(false);
  });

  it("asks only for named fields, located crashes and the study area's envelope", async () => {
    const { urls } = installLayer();
    await fetchOdotCrashes({ bbox, years: [fixture.year] });

    const featureQuery = urls.find((url) => url.searchParams.has("outFields"));
    expect(featureQuery?.origin + featureQuery!.pathname).toBe(`${ODOT_OR_LAYER_URL}/query`);
    expect(featureQuery!.searchParams.get("outFields")!.split(",")).toEqual([...ODOT_OR_REQUESTED_COLUMNS]);
    for (const url of urls.filter((u) => !u.searchParams.has("groupByFieldsForStatistics"))) {
      expect(url.searchParams.get("where")).toBe("CRASH_YR_NO = '2023' AND UNLOCT_FLG = 0");
      expect(url.searchParams.get("geometry")).toBe("-121.15,44.61,-121.13,44.625");
      expect(url.searchParams.get("inSR")).toBe("4326");
    }
    expect(featureQuery!.searchParams.get("outSR")).toBe("4326");
  });

  it("asks the layer which years it holds and does not query the others", async () => {
    const { urls } = installLayer();
    const result = await fetchOdotCrashes({ bbox, years: [2025, 2023, 2018] });

    const askedYears = urls
      .map((url) => url.searchParams.get("where"))
      .filter((where): where is string => Boolean(where) && where !== "1=1");
    expect(new Set(askedYears)).toEqual(new Set(["CRASH_YR_NO = '2023' AND UNLOCT_FLG = 0"]));
    expect(result.yearsQueried).toEqual([2023]);
  });

  it("treats an ArcGIS error body as unavailable, never as zero crashes, and names the error", async () => {
    // A stopped service answers HTTP 200 with this body; Nevada's crash layer
    // did exactly that on 2026-11-01.
    installLayer({ count: { error: { code: 500, message: "Service not started" } } });
    const failure = fetchOdotCrashes({ bbox, years: [fixture.year] });
    await expect(failure).rejects.toBeInstanceOf(CrashSourceUnavailableError);
    await expect(failure).rejects.toThrow(/ArcGIS error: Service not started/);
  });

  it("treats a feature answer without features as unavailable", async () => {
    installLayer({ features: { exceededTransferLimit: false } });
    await expect(fetchOdotCrashes({ bbox, years: [fixture.year] })).rejects.toBeInstanceOf(
      CrashSourceUnavailableError
    );
  });

  it("treats a layer that reports no years as unavailable", async () => {
    installLayer({ years: { features: [] } });
    await expect(fetchOdotCrashes({ bbox, years: [fixture.year] })).rejects.toBeInstanceOf(
      CrashSourceUnavailableError
    );
  });

  it("marks the result truncated only when the cap left crashes behind", async () => {
    installLayer();
    const capped = await fetchOdotCrashes({ bbox, years: [fixture.year], maxRecords: 17 });
    expect(capped.truncated).toBe(false);
  });
});

describe("Oregon in the registry", () => {
  const bbox = fixture.bbox;

  it("answers an Oregon live read ahead of FARS, with full severity", () => {
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: OREGON }, "read_only");
    expect(candidates.map((adapter) => adapter.id)).toEqual([ODOT_OR_SOURCE_ID, farsAdapter.id]);
    expect(odotOrAdapter.severityCompleteness).toBe("kabco_full");
  });

  it("is not stored until the database admits it, so an Oregon acquisition stores FARS", () => {
    expect(odotOrAdapter.persistable).toBe(false);
    expect(OBSERVED_CRASH_SOURCE_IDS).not.toContain(ODOT_OR_SOURCE_ID);
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: OREGON }, "ingest");
    expect(candidates.map((adapter) => adapter.id)).toEqual([farsAdapter.id]);
  });

  it("never answers for an unknown state or another state", () => {
    const unknown = crashSourcesForStudyArea({ bbox, stateFips: null }, "read_only");
    expect(unknown.candidates.map((adapter) => adapter.id)).not.toContain(ODOT_OR_SOURCE_ID);
    const idaho = crashSourcesForStudyArea({ bbox, stateFips: ["16"] }, "read_only");
    expect(idaho.candidates.map((adapter) => adapter.id)).not.toContain(ODOT_OR_SOURCE_ID);
  });

  it("gives an Oregon corridor a serious-injury count, which FARS cannot", async () => {
    installLayer();
    const summary = await fetchCrashesForStudyArea({ bbox, stateFips: OREGON }, { now: new Date("2025-06-01T00:00:00Z") });
    expect(summary.source).toBe(ODOT_OR_SOURCE_ID);
    expect(summary.severityCompleteness).toBe("kabco_full");
    expect(summary.severeInjuryCrashes).toBeGreaterThan(0);
    expect(summary.crashDensityBasis).toBe("injury_and_fatal");
  });
});
