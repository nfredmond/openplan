/**
 * Iowa DOT's crash layer as a crash source: what is asked, what is mapped, and
 * what an outage looks like.
 *
 * The network is replaced by responses recorded once from Iowa DOT's crash and
 * person layers on 2026-11-01 (`fixtures/iowadot-ia-crash-layer-2026-11-01.json`:
 * 22 crashes in a small box in Guthrie Center, 2024). The fake answers by
 * query shape and layer, so it checks what the adapter ASKS as well as how it
 * reads the answer.
 *
 * Blind category: the live layers' drift, and Iowa DOT's web application
 * firewall, which blocks some WHERE shapes with an HTML page. Both surface in
 * production as unavailable, not in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/iowadot-ia-crash-layer-2026-11-01.json";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import {
  IOWADOT_IA_LAYER_URL,
  IOWADOT_IA_PERSON_LAYER_URL,
  IOWADOT_IA_REQUESTED_COLUMNS,
  IOWADOT_IA_REQUESTED_PERSON_COLUMNS,
  IOWADOT_IA_SOURCE_ID,
  fetchIowaCrashes,
  iowaDotIaAdapter,
  iowaSeverity,
  toIowaCollisionDate,
  toIowaCrashKey,
} from "@/lib/safety/sources/iowadot-ia";
import { IOWADOT_IA_VOCABULARY } from "@/lib/safety/sources/iowadot-ia-vocabulary";
import { OBSERVED_CRASH_SOURCE_IDS, crashSourcesForStudyArea } from "@/lib/safety/sources/registry";
import { CrashSourceUnavailableError } from "@/lib/safety/sources/types";
import { findDescriptorVocabularyViolations } from "@/lib/safety/vocabulary";
import { farsAdapter } from "@/lib/safety/sources/fars";

const IOWA = ["19"];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Override = Partial<Record<"years" | "count" | "features" | "persons", unknown>>;

function installLayers(override: Override = {}) {
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url);
    const params = url.searchParams;
    if (url.pathname.includes("Crash_Person_Data")) return jsonResponse(override.persons ?? fixture.responses.persons);
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

describe("the Iowa descriptor", () => {
  it("maps only into the neutral vocabulary", () => {
    expect(findDescriptorVocabularyViolations(IOWADOT_IA_VOCABULARY)).toEqual([]);
  });

  it("takes severity from Iowa DOT's crash severity, with major injury kept apart", () => {
    expect([1, 2, 3, 5].map((code) => iowaSeverity(code, 0).severity)).toEqual(["fatal", "severe_injury", "injury", "pdo"]);
  });

  it("splits the possible-or-unknown class by the possible-injury count, and keeps unknown unknown", () => {
    expect(iowaSeverity(4, 1).severity).toBe("injury");
    expect(iowaSeverity(4, 0).severity).toBe("unknown");
    expect(iowaSeverity(4, null).severity).toBe("unknown");
    // A code the dictionary does not define is not classified, and is counted.
    expect(iowaSeverity(6, 0)).toEqual({ severity: "unknown", raw: "6", unmapped: true });
    expect(iowaSeverity(null, 0).severity).toBe("unknown");
  });
});

describe("Iowa parsing helpers", () => {
  it("reads the crash date as the UTC calendar date the layer stores", () => {
    expect(toIowaCollisionDate(1420070400000)).toBe("2015-01-01");
    expect(toIowaCollisionDate(null)).toBeNull();
  });

  it("reads the crash key the same way from both layers", () => {
    expect(toIowaCrashKey(20241407470)).toBe("20241407470");
    expect(toIowaCrashKey("20241407470")).toBe("20241407470");
    expect(toIowaCrashKey("")).toBeNull();
  });
});

describe("fetching Iowa crashes", () => {
  const bbox = fixture.bbox;

  it("maps the recorded crashes with Iowa DOT's severity and the person layer's non-motorists", async () => {
    installLayers();
    const result = await fetchIowaCrashes({ bbox, years: [fixture.year] });

    expect(result.records).toHaveLength(22);
    expect(result.matchedTotal).toBe(22);
    const bySeverity = result.records.reduce<Record<string, number>>((tally, record) => {
      tally[record.severity] = (tally[record.severity] ?? 0) + 1;
      return tally;
    }, {});
    // One code-4 crash has a possible injury (injury), the other does not (unknown).
    expect(bySeverity).toEqual({ fatal: 1, severe_injury: 2, injury: 2, unknown: 1, pdo: 16 });

    const fatal = result.records.find((record) => record.externalId === "20241407470");
    expect(fatal).toMatchObject({
      collisionYear: 2024,
      killedCount: 1,
      // The person layer lists a pedalcyclist for this crash.
      bicyclistInvolved: true,
      pedestrianInvolved: false,
      motorcyclistInvolved: false,
      lighting: "dawn_dusk",
      weather: "clear",
      stateFips: "19",
      sourceId: IOWADOT_IA_SOURCE_ID,
    });
    expect(result.records.filter((record) => record.bicyclistInvolved)).toHaveLength(1);
    // Non-collision (code 1) and rear-to-side (code 9) are kept and counted, not guessed.
    expect(result.unmappedByDimension?.collision_type).toBe(11);
    expect(result.yearsQueried).toEqual([2024]);
    expect(result.truncated).toBe(false);
  });

  it("asks only for named fields, located crashes and the study area's envelope", async () => {
    const { urls } = installLayers();
    await fetchIowaCrashes({ bbox, years: [fixture.year] });

    const crashQuery = urls.find((url) => url.searchParams.has("outFields") && !url.pathname.includes("Person"));
    expect(crashQuery!.origin + crashQuery!.pathname).toBe(`${IOWADOT_IA_LAYER_URL}/query`);
    expect(crashQuery!.searchParams.get("outFields")!.split(",")).toEqual([...IOWADOT_IA_REQUESTED_COLUMNS]);
    for (const url of urls.filter((u) => !u.searchParams.has("outStatistics") && !u.pathname.includes("Person"))) {
      expect(url.searchParams.get("where")).toBe(
        "CRASH_DATE >= DATE '2024-01-01' AND CRASH_DATE < DATE '2025-01-01' AND NOT (XCOORD = 190000 AND YCOORD = 4460000)"
      );
      expect(url.searchParams.get("geometry")).toBe("-94.52,41.665,-94.46,41.695");
      expect(url.searchParams.get("inSR")).toBe("4326");
    }

    const personQuery = urls.find((url) => url.pathname.includes("Crash_Person_Data"));
    expect(personQuery!.origin + personQuery!.pathname).toBe(`${IOWADOT_IA_PERSON_LAYER_URL}/query`);
    expect(personQuery!.searchParams.get("outFields")!.split(",")).toEqual([...IOWADOT_IA_REQUESTED_PERSON_COLUMNS]);
    expect(personQuery!.searchParams.get("where")).toMatch(/^CRASH_YEAR = 2024 AND NM_TYPE IN \('Pedestrian', /);
    expect(personQuery!.searchParams.get("geometry")).toBe("-94.52,41.665,-94.46,41.695");
  });

  it("asks the layer for its dates and does not query years outside them", async () => {
    const { urls } = installLayers();
    const result = await fetchIowaCrashes({ bbox, years: [2027, 2024, 2014] });

    const asked = urls
      .filter((url) => !url.pathname.includes("Person") && !url.searchParams.has("outStatistics"))
      .map((url) => url.searchParams.get("where"));
    expect(asked.every((where) => where?.startsWith("CRASH_DATE >= DATE '2024-01-01'"))).toBe(true);
    expect(result.yearsQueried).toEqual([2024]);
  });

  it("treats an ArcGIS error body as unavailable, never as zero crashes, and names the error", async () => {
    installLayers({ count: { error: { code: 500, message: "Service not started" } } });
    const failure = fetchIowaCrashes({ bbox, years: [fixture.year] });
    await expect(failure).rejects.toBeInstanceOf(CrashSourceUnavailableError);
    await expect(failure).rejects.toThrow(/ArcGIS error: Service not started/);
  });

  it("treats a person layer that does not answer as unavailable, not as no pedestrians", async () => {
    installLayers({ persons: { error: { code: 400, message: "Invalid query" } } });
    await expect(fetchIowaCrashes({ bbox, years: [fixture.year] })).rejects.toThrow(/ArcGIS error: Invalid query/);
  });

  it("treats a layer that reports no dates as unavailable", async () => {
    installLayers({ years: { features: [{ attributes: { FIRST_DATE: null, LAST_DATE: null } }] } });
    await expect(fetchIowaCrashes({ bbox, years: [fixture.year] })).rejects.toBeInstanceOf(CrashSourceUnavailableError);
  });
});

describe("Iowa in the registry", () => {
  const bbox = fixture.bbox;

  it("answers an Iowa live read ahead of FARS, with full severity", () => {
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: IOWA }, "read_only");
    expect(candidates.map((adapter) => adapter.id)).toEqual([IOWADOT_IA_SOURCE_ID, farsAdapter.id]);
    expect(iowaDotIaAdapter.severityCompleteness).toBe("kabco_full");
  });

  it("is not stored until the database admits it, so an Iowa acquisition stores FARS", () => {
    expect(iowaDotIaAdapter.persistable).toBe(false);
    expect(OBSERVED_CRASH_SOURCE_IDS).not.toContain(IOWADOT_IA_SOURCE_ID);
    const { candidates } = crashSourcesForStudyArea({ bbox, stateFips: IOWA }, "ingest");
    expect(candidates.map((adapter) => adapter.id)).toEqual([farsAdapter.id]);
  });

  it("never answers for an unknown state or another state", () => {
    const unknown = crashSourcesForStudyArea({ bbox, stateFips: null }, "read_only");
    expect(unknown.candidates.map((adapter) => adapter.id)).not.toContain(IOWADOT_IA_SOURCE_ID);
    const nebraska = crashSourcesForStudyArea({ bbox, stateFips: ["31"] }, "read_only");
    expect(nebraska.candidates.map((adapter) => adapter.id)).not.toContain(IOWADOT_IA_SOURCE_ID);
  });

  it("gives an Iowa corridor a serious-injury count, which FARS cannot", async () => {
    installLayers();
    const summary = await fetchCrashesForStudyArea({ bbox, stateFips: IOWA }, { now: new Date("2025-06-01T00:00:00Z") });
    expect(summary.source).toBe(IOWADOT_IA_SOURCE_ID);
    expect(summary.severityCompleteness).toBe("kabco_full");
    // The fake answers every year with the same recorded crashes.
    expect(summary.severeInjuryCrashes).toBeGreaterThan(0);
    expect(summary.unclassifiedCrashes).toBeGreaterThan(0);
    expect(summary.crashDensityBasis).toBe("injury_and_fatal");
  });
});
