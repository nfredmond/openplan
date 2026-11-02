// @vitest-environment node
/**
 * Puerto Rico fatal crashes come from NHTSA's separate Puerto Rico FARS file.
 *
 * The fixture holds rows copied verbatim from the published Puerto Rico
 * accident tables, captured 2026-11-01 (see its `files` entries for the
 * archive URL, SHA-256 and row counts). The network is stubbed: every archive
 * request is answered from the fixture or refused, so these tests check which
 * NHTSA file the adapter asks for and what it does with the real rows.
 *
 * Blind category: the fixture is a few rows of two years. It shows the schema
 * and the state code, not that every published year parses; the header
 * comment in fars.ts records the per-year counts checked by hand.
 */

import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "./fixtures/fars-puerto-rico-accident-sample.json";
import table from "./fixtures/us-jurisdiction-source-table.json";
import {
  FARS_PUERTO_RICO_EARLIEST_YEAR,
  FARS_SOURCE_ID,
  farsAnnualArchiveUrl,
  farsPuertoRicoArchiveUrl,
  fetchFarsCrashes,
  parseFarsAnnualCsv,
} from "@/lib/safety/sources/fars";
import { CrashSourceUnavailableError } from "@/lib/safety/sources/types";

/** Adjuntas Municipio, from the Census 2024 county file (the per-state table's PR row). */
const ADJUNTAS_BBOX = table.rows.find((row) => row.countyGeoid === "72001")!.bbox;
const PUERTO_RICO_BBOX = { minLon: -67.3, minLat: 17.9, maxLon: -65.4, maxLat: 18.52 };
const DETROIT_BBOX = { minLon: -83.2, minLat: 42.2, maxLon: -83.0, maxLat: 42.4 };

async function archiveOf(member: string, csv: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(member, csv);
  return zip.generateAsync({ type: "arraybuffer" });
}

/** Answers the 2024 Puerto Rico archive from the fixture; every other URL is refused with 404. */
function stubNhtsa(options: { puertoRico2024?: "fixture" | "missing" } = {}) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url === farsPuertoRicoArchiveUrl(2024) && options.puertoRico2024 !== "missing") {
      const file = sample.files["2024"];
      return new Response(await archiveOf(file.member, file.csv), { status: 200 });
    }
    return new Response("NoSuchKey", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return requested;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the recorded Puerto Rico accident rows", () => {
  it("parse to fatal-only records attributed to Puerto Rico's FIPS code, not FARS's 43", () => {
    const parsed = parseFarsAnnualCsv(sample.files["2024"].csv, 2024, PUERTO_RICO_BBOX);

    expect(parsed.records.map((record) => record.externalId)).toEqual([
      "2024-430001",
      "2024-430002",
      "2024-430003",
      "2024-430009",
      "2024-430063",
    ]);
    for (const record of parsed.records) {
      expect(record.stateFips).toBe("72");
      expect(record.severity).toBe("fatal");
      expect(record.injuredCount).toBeNull();
      expect(record.sourceId).toBe(FARS_SOURCE_ID);
    }
    // ST_CASE 430002 and 430009 each list one person not in a vehicle (PEDS = 1).
    expect(parsed.records.filter((record) => record.pedestrianInvolved).map((record) => record.externalId)).toEqual([
      "2024-430002",
      "2024-430009",
    ]);
  });

  it("keep only the crash inside the study area's bbox", () => {
    const parsed = parseFarsAnnualCsv(sample.files["2024"].csv, 2024, ADJUNTAS_BBOX);

    expect(parsed.matchedTotal).toBe(1);
    expect(parsed.records[0]).toMatchObject({
      externalId: "2024-430063",
      collisionDate: "2024-04-14",
      killedCount: 1,
      stateFips: "72",
    });
  });

  it("before 2020 carry no coordinates, so a bbox can match none of them", () => {
    // The whole 2019 table is like this (0 of 275 rows), which is why the
    // Puerto Rico file answers only from 2020.
    const parsed = parseFarsAnnualCsv(sample.files["2019"].csv, 2019, PUERTO_RICO_BBOX);
    expect(parsed.records).toEqual([]);
    expect(FARS_PUERTO_RICO_EARLIEST_YEAR).toBe(2020);
  });
});

describe("fetching FARS for a Puerto Rico study area", () => {
  it("reads only the Puerto Rico archive, never the National one", async () => {
    const requested = stubNhtsa();

    const result = await fetchFarsCrashes({ bbox: ADJUNTAS_BBOX, years: [2024] });

    expect(requested).toEqual([farsPuertoRicoArchiveUrl(2024)]);
    expect(result.yearsQueried).toEqual([2024]);
    expect(result.records.map((record) => [record.externalId, record.stateFips])).toEqual([["2024-430063", "72"]]);
  });

  it("does not ask for a year before 2020 and does not count it as observed", async () => {
    const requested = stubNhtsa();

    const result = await fetchFarsCrashes({ bbox: ADJUNTAS_BBOX, years: [2024, 2019] });

    expect(requested).toEqual([farsPuertoRicoArchiveUrl(2024)]);
    expect(result.yearsQueried).toEqual([2024]);
  });

  it("reports the source unavailable, not zero deaths, when only pre-2020 years are asked", async () => {
    const requested = stubNhtsa();

    await expect(fetchFarsCrashes({ bbox: ADJUNTAS_BBOX, years: [2018, 2019] })).rejects.toBeInstanceOf(
      CrashSourceUnavailableError
    );
    expect(requested).toEqual([]);
  });

  it("reports the source unavailable, not zero deaths, when the Puerto Rico archive cannot be read", async () => {
    stubNhtsa({ puertoRico2024: "missing" });

    await expect(fetchFarsCrashes({ bbox: ADJUNTAS_BBOX, years: [2024] })).rejects.toBeInstanceOf(
      CrashSourceUnavailableError
    );
  });
});

describe("fetching FARS for a study area in the 50 states", () => {
  it("never reads the Puerto Rico archive", async () => {
    const requested = stubNhtsa();

    await expect(fetchFarsCrashes({ bbox: DETROIT_BBOX, years: [2024] })).rejects.toBeInstanceOf(
      CrashSourceUnavailableError
    );
    expect(requested).toEqual([farsAnnualArchiveUrl(2024)]);
  });
});
