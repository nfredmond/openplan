/**
 * DDOT's Crashes in DC layer as a crash source: what is asked, how severity is
 * derived from DDOT's outcome counts, and what an outage looks like.
 *
 * The network is replaced by responses recorded once from DDOT's layer on
 * 2026-11-01 (`fixtures/ddot-dc-crash-layer-2026-11-01.json`: a small box in
 * Shepherd Park, reports from 2024). The layer counted 30 crashes in that box
 * and returned 29; the 30th sits 0.5 m outside it. The fixture keeps that
 * disagreement on purpose.
 *
 * Blind category: the live layer's drift and DDOT's intermittent "The service
 * is unavailable." page, which reads as no response and fails as unavailable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/ddot-dc-crash-layer-2026-11-01.json";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import {
  DDOT_DC_LAYER_URL,
  DDOT_DC_REQUESTED_COLUMNS,
  DDOT_DC_SOURCE_ID,
  ddotDcAdapter,
  ddotSeverity,
  fetchDdotCrashes,
} from "@/lib/safety/sources/ddot-dc";
import { DDOT_DC_VOCABULARY } from "@/lib/safety/sources/ddot-dc-vocabulary";
import { OBSERVED_CRASH_SOURCE_IDS, crashSourcesForStudyArea } from "@/lib/safety/sources/registry";
import { CrashSourceUnavailableError } from "@/lib/safety/sources/types";
import { findDescriptorVocabularyViolations } from "@/lib/safety/vocabulary";
import { farsAdapter } from "@/lib/safety/sources/fars";

const DC = ["11"];

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

function installLayer(override: Override = {}) {
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url);
    const params = url.searchParams;
    if (params.get("outStatistics")) return jsonResponse(override.years ?? fixture.responses.years);
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

/** Every outcome count zero, as DDOT reports a crash with nobody hurt. */
const NOBODY_HURT = Object.fromEntries(
  DDOT_DC_REQUESTED_COLUMNS.filter((column) => /FATAL|INJURIES/.test(column)).map((column) => [column, 0])
);

describe("the DC severity rule", () => {
  it("declares no coded mapping, only the counts", () => {
    expect(findDescriptorVocabularyViolations(DDOT_DC_VOCABULARY)).toEqual([]);
  });

  it("maps fatal and major to the KSI bands and minor to injury", () => {
    expect(ddotSeverity({ ...NOBODY_HURT, FATALPASSENGER: 1 })).toBe("fatal");
    expect(ddotSeverity({ ...NOBODY_HURT, MAJORINJURIES_PEDESTRIAN: 1, MINORINJURIES_DRIVER: 2 })).toBe("severe_injury");
    expect(ddotSeverity({ ...NOBODY_HURT, MINORINJURIES_BICYCLIST: 1 })).toBe("injury");
    expect(ddotSeverity(NOBODY_HURT)).toBe("pdo");
  });

  it("keeps an unknown injury and an unreadable count unknown, never property damage", () => {
    expect(ddotSeverity({ ...NOBODY_HURT, UNKNOWNINJURIES_DRIVER: 1 })).toBe("unknown");
    expect(ddotSeverity({ ...NOBODY_HURT, FATALOTHER: null, MAJORINJURIESOTHER: null })).toBe("unknown");
    // A positive observation survives an unreadable partner.
    expect(ddotSeverity({ ...NOBODY_HURT, FATALOTHER: null, MAJORINJURIES_DRIVER: 1 })).toBe("severe_injury");
  });
});

describe("fetching DC crashes", () => {
  const bbox = fixture.bbox;

  it("maps the recorded crashes and reports the crashes it returned, not the count's extra edge point", async () => {
    installLayer();
    const result = await fetchDdotCrashes({ bbox, years: [fixture.year] });

    expect(fixture.responses.count.count).toBe(30);
    expect(result.records).toHaveLength(29);
    expect(result.matchedTotal).toBe(29);
    expect(result.geocodedTotal).toBe(29);
    const bySeverity = result.records.reduce<Record<string, number>>((tally, record) => {
      tally[record.severity] = (tally[record.severity] ?? 0) + 1;
      return tally;
    }, {});
    expect(bySeverity).toEqual({ fatal: 1, injury: 3, pdo: 25 });

    const fatal = result.records.find((record) => record.externalId === "55763340485");
    expect(fatal).toMatchObject({
      // REPORTDATE is a report date, so no crash date is claimed.
      collisionDate: null,
      collisionYear: 2024,
      killedCount: 1,
      injuredCount: 0,
      pedestrianInvolved: true,
      bicyclistInvolved: false,
      collisionType: null,
      lighting: null,
      weather: null,
      stateFips: "11",
      sourceId: DDOT_DC_SOURCE_ID,
    });
    expect(result.records.filter((record) => record.pedestrianInvolved)).toHaveLength(2);
  });

  it("asks only for named fields, the report year and the study area's envelope", async () => {
    const { urls } = installLayer();
    await fetchDdotCrashes({ bbox, years: [fixture.year] });

    const featureQuery = urls.find((url) => url.searchParams.has("outFields"));
    expect(featureQuery!.origin + featureQuery!.pathname).toBe(`${DDOT_DC_LAYER_URL}/query`);
    expect(featureQuery!.searchParams.get("outFields")!.split(",")).toEqual([...DDOT_DC_REQUESTED_COLUMNS]);
    expect(featureQuery!.searchParams.get("resultRecordCount")).toBe("1000");
    for (const url of urls.filter((u) => !u.searchParams.has("outStatistics"))) {
      expect(url.searchParams.get("where")).toBe(
        "REPORTDATE >= TIMESTAMP '2024-01-01 00:00:00' AND REPORTDATE < TIMESTAMP '2025-01-01 00:00:00'"
      );
      expect(url.searchParams.get("geometry")).toBe("-77.042,38.977,-77.029,38.988");
      expect(url.searchParams.get("inSR")).toBe("4326");
    }
  });

  it("asks the layer for its latest report and queries no later year and none before 2009", async () => {
    const { urls } = installLayer();
    const result = await fetchDdotCrashes({ bbox, years: [2027, 2024, 2008] });
    const asked = new Set(
      urls.filter((url) => !url.searchParams.has("outStatistics")).map((url) => url.searchParams.get("where"))
    );
    expect(asked.size).toBe(1);
    expect(result.yearsQueried).toEqual([2024]);
  });

  it("treats an ArcGIS error body as unavailable, never as zero crashes, and names the error", async () => {
    installLayer({ count: { error: { code: 500, message: "Service not started" } } });
    const failure = fetchDdotCrashes({ bbox, years: [fixture.year] });
    await expect(failure).rejects.toBeInstanceOf(CrashSourceUnavailableError);
    await expect(failure).rejects.toThrow(/ArcGIS error: Service not started/);
  });

  it("treats a layer that reports no latest date as unavailable", async () => {
    installLayer({ years: { features: [{ attributes: { LAST_REPORT: null } }] } });
    await expect(fetchDdotCrashes({ bbox, years: [fixture.year] })).rejects.toBeInstanceOf(CrashSourceUnavailableError);
  });
});

describe("DC in the registry", () => {
  const bbox = fixture.bbox;

  it("answers a DC live read ahead of FARS, with full severity", () => {
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: DC }, "read_only");
    expect(candidates.map((adapter) => adapter.id)).toEqual([DDOT_DC_SOURCE_ID, farsAdapter.id]);
    expect(ddotDcAdapter.severityCompleteness).toBe("kabco_full");
  });

  it("is not stored until the database admits it, so a DC acquisition stores FARS", () => {
    expect(ddotDcAdapter.persistable).toBe(false);
    expect(OBSERVED_CRASH_SOURCE_IDS).not.toContain(DDOT_DC_SOURCE_ID);
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: DC }, "ingest");
    expect(candidates.map((adapter) => adapter.id)).toEqual([farsAdapter.id]);
  });

  it("never answers for an unknown state or a neighboring state", () => {
    const unknown = crashSourcesForStudyArea({ bbox, stateFips: null }, "read_only");
    expect(unknown.candidates.map((adapter) => adapter.id)).not.toContain(DDOT_DC_SOURCE_ID);
    const maryland = crashSourcesForStudyArea({ bbox, stateFips: ["24"] }, "read_only");
    expect(maryland.candidates.map((adapter) => adapter.id)).not.toContain(DDOT_DC_SOURCE_ID);
  });

  it("gives a DC corridor an injury and serious-injury figure, which FARS cannot", async () => {
    installLayer();
    const summary = await fetchCrashesForStudyArea({ bbox, stateFips: DC }, { now: new Date("2025-06-01T00:00:00Z") });
    expect(summary.source).toBe(DDOT_DC_SOURCE_ID);
    expect(summary.severityCompleteness).toBe("kabco_full");
    expect(summary.severeInjuryCrashes).toBe(0);
    expect(summary.totalInjuryCrashes).toBeGreaterThan(0);
    expect(summary.crashDensityBasis).toBe("injury_and_fatal");
  });
});
