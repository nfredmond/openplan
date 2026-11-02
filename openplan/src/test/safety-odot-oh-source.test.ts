/**
 * Ohio DOT's per-year crash layers as a crash source: what is asked, what is
 * mapped, and what an outage looks like.
 *
 * The network is replaced by responses recorded once from ODOT's TIMS Safety
 * catalog and its 2024 layer on 2026-11-01
 * (`fixtures/odot-oh-crash-layer-2026-11-01.json`: 18 crashes in a small box
 * in Zanesville). The fake answers by query shape, so it checks what the
 * adapter ASKS (service, fields, filter, envelope) as well as how it reads it.
 *
 * Blind category: the live services' drift. A replaced or renamed service is
 * caught in production by the catalog and error-body refusals below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/odot-oh-crash-layer-2026-11-01.json";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import {
  ODOT_OH_REQUESTED_COLUMNS,
  ODOT_OH_SERVICES_URL,
  ODOT_OH_SOURCE_ID,
  fetchOhioCrashes,
  odotOhAdapter,
  odotOhLayerUrl,
} from "@/lib/safety/sources/odot-oh";
import { ODOT_OH_VOCABULARY } from "@/lib/safety/sources/odot-oh-vocabulary";
import { OBSERVED_CRASH_SOURCE_IDS, crashSourcesForStudyArea } from "@/lib/safety/sources/registry";
import { CrashSourceUnavailableError } from "@/lib/safety/sources/types";
import { findDescriptorVocabularyViolations, mapCrashDimension } from "@/lib/safety/vocabulary";
import { farsAdapter } from "@/lib/safety/sources/fars";

const OHIO = ["39"];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Override = Partial<Record<"catalog" | "count" | "features", unknown>>;

function installServices(override: Override = {}) {
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url);
    if (!url.pathname.endsWith("/query")) return jsonResponse(override.catalog ?? fixture.responses.catalog);
    if (url.searchParams.get("returnCountOnly") === "true") return jsonResponse(override.count ?? fixture.responses.count);
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

describe("the Ohio descriptor", () => {
  it("maps only into the neutral vocabulary", () => {
    expect(findDescriptorVocabularyViolations(ODOT_OH_VOCABULARY)).toEqual([]);
  });

  it("takes severity from ODOT's five-level severity text, with suspected serious injury kept apart", () => {
    const severity = (raw: string) => mapCrashDimension(ODOT_OH_VOCABULARY, "severity", raw)?.value;
    expect(
      ["Fatal", "Serious Injury Suspected", "Minor Injury Suspected", "Injury Possible", "PDO/No Injury"].map(severity)
    ).toEqual(["fatal", "severe_injury", "injury", "injury", "pdo"]);
    expect(mapCrashDimension(ODOT_OH_VOCABULARY, "severity", "Serious")).toEqual({
      value: "unknown",
      raw: "Serious",
      unmapped: true,
    });
  });

  it("does not guess a manner for a turning crash", () => {
    expect(mapCrashDimension(ODOT_OH_VOCABULARY, "collision_type", "Right Turn")).toEqual({
      value: "other",
      raw: "Right Turn",
      unmapped: true,
    });
  });
});

describe("fetching Ohio crashes", () => {
  const bbox = fixture.bbox;

  it("maps the recorded crashes with ODOT's severity", async () => {
    installServices();
    const result = await fetchOhioCrashes({ bbox, years: [fixture.year] });

    expect(result.records).toHaveLength(18);
    expect(result.matchedTotal).toBe(18);
    const bySeverity = result.records.reduce<Record<string, number>>((tally, record) => {
      tally[record.severity] = (tally[record.severity] ?? 0) + 1;
      return tally;
    }, {});
    expect(bySeverity).toEqual({ fatal: 1, severe_injury: 1, injury: 3, pdo: 13 });

    const fatal = result.records.find((record) => record.severity === "fatal");
    expect(fatal).toMatchObject({
      collisionDate: null,
      collisionYear: 2024,
      // The layer carries no casualty counts; unknown, never zero.
      killedCount: null,
      injuredCount: null,
      pedestrianInvolved: true,
      collisionType: "vehicle_pedestrian",
      lighting: null,
      weather: null,
      stateFips: "39",
      sourceId: ODOT_OH_SOURCE_ID,
    });
    // Animal (6) and Right Turn (1) are kept and counted, not guessed.
    expect(result.unmappedByDimension?.collision_type).toBe(7);
    expect(result.yearsQueried).toEqual([2024]);
  });

  it("asks the year's own service for named fields and the study area's envelope", async () => {
    const { urls } = installServices();
    await fetchOhioCrashes({ bbox, years: [fixture.year] });

    expect(urls[0].toString()).toBe(`${ODOT_OH_SERVICES_URL}?f=json`);
    const queries = urls.filter((url) => url.pathname.endsWith("/query"));
    expect(queries.length).toBeGreaterThan(0);
    for (const url of queries) {
      expect(url.origin + url.pathname).toBe(`${odotOhLayerUrl(2024)}/query`);
      expect(url.searchParams.get("where")).toBe("CRASH_YR = 2024");
      expect(url.searchParams.get("geometry")).toBe("-82.2,39.945,-82.17,39.965");
      expect(url.searchParams.get("inSR")).toBe("4326");
    }
    const featureQuery = queries.find((url) => url.searchParams.has("outFields"));
    expect(featureQuery!.searchParams.get("outFields")!.split(",")).toEqual([...ODOT_OH_REQUESTED_COLUMNS]);
  });

  it("asks the catalog which years have a service and does not query the others", async () => {
    const { urls } = installServices();
    const result = await fetchOhioCrashes({ bbox, years: [2026, 2024, 2020] });
    const services = new Set(urls.filter((url) => url.pathname.endsWith("/query")).map((url) => url.pathname));
    expect([...services]).toEqual([new URL(`${odotOhLayerUrl(2024)}/query`).pathname]);
    expect(result.yearsQueried).toEqual([2024]);
  });

  it("treats an ArcGIS error body as unavailable, never as zero crashes, and names the error", async () => {
    installServices({ count: { error: { code: 500, message: "Service not started" } } });
    const failure = fetchOhioCrashes({ bbox, years: [fixture.year] });
    await expect(failure).rejects.toBeInstanceOf(CrashSourceUnavailableError);
    await expect(failure).rejects.toThrow(/ArcGIS error: Service not started/);
  });

  it("treats a catalog with no crash-year service as unavailable", async () => {
    installServices({ catalog: { currentVersion: 11.5, folders: [], services: [] } });
    await expect(fetchOhioCrashes({ bbox, years: [fixture.year] })).rejects.toBeInstanceOf(CrashSourceUnavailableError);
  });
});

describe("Ohio in the registry", () => {
  const bbox = fixture.bbox;

  it("answers an Ohio live read ahead of FARS, with full severity", () => {
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: OHIO }, "read_only");
    expect(candidates.map((adapter) => adapter.id)).toEqual([ODOT_OH_SOURCE_ID, farsAdapter.id]);
    expect(odotOhAdapter.severityCompleteness).toBe("kabco_full");
  });

  it("is not stored until the database admits it, so an Ohio acquisition stores FARS", () => {
    expect(odotOhAdapter.persistable).toBe(false);
    expect(OBSERVED_CRASH_SOURCE_IDS).not.toContain(ODOT_OH_SOURCE_ID);
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: OHIO }, "ingest");
    expect(candidates.map((adapter) => adapter.id)).toEqual([farsAdapter.id]);
  });

  it("never answers for an unknown state or another state", () => {
    const unknown = crashSourcesForStudyArea({ bbox, stateFips: null }, "read_only");
    expect(unknown.candidates.map((adapter) => adapter.id)).not.toContain(ODOT_OH_SOURCE_ID);
    const pennsylvania = crashSourcesForStudyArea({ bbox, stateFips: ["42"] }, "read_only");
    expect(pennsylvania.candidates.map((adapter) => adapter.id)).not.toContain(ODOT_OH_SOURCE_ID);
  });

  it("gives an Ohio corridor a serious-injury count, which FARS cannot", async () => {
    installServices();
    const summary = await fetchCrashesForStudyArea({ bbox, stateFips: OHIO }, { now: new Date("2025-06-01T00:00:00Z") });
    expect(summary.source).toBe(ODOT_OH_SOURCE_ID);
    expect(summary.severeInjuryCrashes).toBeGreaterThan(0);
    // No casualty counts: at least one death per fatal crash, a floor.
    expect(summary.totalFatalities).toBe(summary.totalFatalCrashes);
  });
});
