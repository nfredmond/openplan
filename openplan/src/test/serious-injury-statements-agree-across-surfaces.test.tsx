import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SeriousInjuryCaveat } from "@/components/safety/serious-injury-caveat";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { fetchCrashesForStudyArea } from "@/lib/data-sources/crashes";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildPacketSafetyEvidence } from "@/lib/reports/safety-evidence-section";
import { formatRtpSafetyEvidenceLine, summarizeRtpSafetyEvidence } from "@/lib/rtp/safety-evidence";
import { buildSafetyCrashEvidence, type SafetyCrashSeverityCounts } from "@/lib/safety/crash-evidence";
import { highInjuryNetworkBasis } from "@/lib/safety/high-injury-network";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import {
  CRASH_SOURCE_SERIOUS_INJURY,
  seriousInjuryAvailability,
  seriousInjuryAvailabilityForRecord,
  type SeriousInjuryAvailability,
} from "@/lib/safety/serious-injury-availability";
import { ccrsAdapter } from "@/lib/safety/sources/ccrs";
import { farsAdapter } from "@/lib/safety/sources/fars";
import { odotOrAdapter } from "@/lib/safety/sources/odot-or";
import { CRASH_SOURCE_ADAPTERS } from "@/lib/safety/sources/registry";
import type { CrashRecord, CrashSourceAdapter } from "@/lib/safety/sources/types";
import { completeEvidenceRecords, evidenceSnapshot } from "./fixtures/grants/ss4a-evidence";

/**
 * KI-2026-11-02-046. For the same CCRS crashes in one California city, the
 * Safety page reported 12 serious-injury crashes while the corridor analysis
 * said serious injury could not be separated.
 *
 * WHY. CCRS's crash file (`Crashes_YYYY`) has only killed and injured counts,
 * so the adapter declares `fatal_injury_only`. Serious injury (KABCO A) is on
 * the injured-person table, joined by `CollisionId`. The Safety acquisition ran
 * that join and recorded `kabco_full`; the corridor scorecard read the adapter
 * directly, never joined, and worded its caveat from the declared value.
 *
 * ONE FIXTURE, EVERY SURFACE. The same crash records go through the Safety
 * acquisition, the Safety banner, the report packet, the SS4A appendices, the
 * RTP criterion line, the high-injury network basis and the corridor
 * scorecard (count, safety line and source note), for CCRS with the join, CCRS
 * without it, FARS and a KABCO state file. Every surface must print the one
 * statement `seriousInjuryAvailability` gives, and the serious-injury count
 * must be the same number or absent everywhere.
 */

const CA = { bbox: { minLon: -121.1, minLat: 39.17, maxLon: -121.0, maxLat: 39.25 }, stateFips: ["06"] };
const OR = { bbox: { minLon: -123.1, minLat: 44.9, maxLon: -122.9, maxLat: 45.0 }, stateFips: ["41"] };
const NV = { bbox: { minLon: -119.9, minLat: 39.45, maxLon: -119.7, maxLat: 39.6 }, stateFips: ["32"] };
const YEAR = 2025;

function crash(externalId: string, severity: CrashRecord["severity"], bbox: typeof CA.bbox): CrashRecord {
  return {
    externalId,
    collisionDate: `${YEAR}-03-14`,
    collisionYear: YEAR,
    severity,
    killedCount: severity === "fatal" ? 1 : 0,
    injuredCount: severity === "fatal" || severity === "pdo" ? 0 : 1,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    motorcyclistInvolved: false,
    collisionType: "rear_end",
    lighting: "daylight",
    weather: "clear",
    sourceAttributes: {},
    latitude: (bbox.minLat + bbox.maxLat) / 2,
    longitude: (bbox.minLon + bbox.maxLon) / 2,
  };
}

/** One fatal, three injury, one PDO. CCRS's injured-person table marks i2 as KABCO A. */
function cityCrashes(bbox: typeof CA.bbox, kabco: boolean): CrashRecord[] {
  return [
    crash("f1", "fatal", bbox),
    crash("i1", "injury", bbox),
    crash("i2", kabco ? "severe_injury" : "injury", bbox),
    crash("i3", "injury", bbox),
    crash("p1", "pdo", bbox),
  ];
}

function fetched(records: CrashRecord[]) {
  return { records, matchedTotal: records.length, geocodedTotal: records.length, yearsCovered: [YEAR], yearsQueried: [YEAR], truncated: false };
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The CCRS injured-person join at the network: answering with i2, or down. */
function stubInjuredPersonTable(mode: "answers" | "down") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      if (mode === "down") throw new Error("data.ca.gov unreachable");
      const url = String(input);
      if (url.includes("package_show")) {
        return json({ result: { resources: [{ id: `ivp-${YEAR}`, name: `InjuredWitnessPassengers_${YEAR}` }] } });
      }
      const sql = decodeURIComponent(url);
      return json({ result: { records: sql.includes("'i2'") ? [{ CollisionId: "i2" }] : [] } });
    }) as unknown as typeof fetch
  );
}

/** Stand-in for the service-role client, keeping what the acquisition wrote. */
function fakeService() {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const crashRows: Array<Record<string, unknown>> = [];
  return {
    inserted,
    updates,
    crashRows,
    from(table: string) {
      if (table === "safety_crash_ingests") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "ingest-1" }, error: null }) }) };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updates.push(patch);
              return { error: null };
            },
          }),
        };
      }
      return {
        upsert: (rows: Array<Record<string, unknown>>) => {
          crashRows.push(...rows);
          return {
            select: async () => ({ data: rows.map((row, index) => ({ id: `crash-${index}`, external_id: row.external_id })), error: null }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
        },
      };
    },
  };
}

/** The stored acquisition row as every reader sees it: insert, then finalize. */
function storedAcquisition(service: ReturnType<typeof fakeService>): Record<string, unknown> {
  return Object.assign({}, service.inserted[0], ...service.updates);
}

function severityCounts(rows: Array<Record<string, unknown>>): SafetyCrashSeverityCounts {
  const counts: Record<keyof SafetyCrashSeverityCounts, number> = { fatal: 0, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 };
  for (const row of rows) counts[row.severity as keyof SafetyCrashSeverityCounts] += 1;
  return counts;
}

function bannerText(sourceId: string | null, severityCompleteness: string): string {
  const { container } = render(<SeriousInjuryCaveat sourceId={sourceId} severityCompleteness={severityCompleteness} />);
  return container.textContent ?? "";
}

/** Every sentence a surface prints about one stored acquisition. */
function storedSurfaces(acquisition: Record<string, unknown>, rows: Array<Record<string, unknown>>) {
  const sourceId = String(acquisition.source_id);
  const severityCompleteness = String(acquisition.severity_completeness);
  const counts = severityCounts(rows);
  const evidence = buildSafetyCrashEvidence(
    {
      id: "ingest-1", projectId: "project-1", status: "ready", sourceId, sourceLabel: "Crash source", attribution: null,
      severityCompleteness, crashCount: rows.length, geocodedCount: rows.length, storedCount: rows.length, truncated: false,
      yearsRequested: [YEAR], createdAt: "2026-11-02T00:00:00.000Z", dimensionCoverage: null,
      partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
    },
    { severity: counts, role: null }
  );
  const packet = buildPacketSafetyEvidence([evidence]);
  if (packet.kind !== "present") throw new Error("expected a packet acquisition");
  const records = completeEvidenceRecords();
  records.safety = {
    status: "ready",
    snapshot: evidenceSnapshot({ source_id: sourceId, severity_completeness: severityCompleteness }),
    otherSeededArtifactCount: 0,
  };
  const ss4aCrash = buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)).find((appendix) => appendix.key === "crash_summary")!;
  return {
    evidence,
    banner: bannerText(sourceId, severityCompleteness),
    reportCaveats: evidence.caveats.join(" "),
    reportSeriousFigure: packet.acquisitions[0].figures.find((figure) => figure.label === "Serious-injury crashes")!,
    ss4aSeverity: ss4aCrash.facts.find((fact) => fact.label === "Severity coverage")!.value,
    rtpLine: formatRtpSafetyEvidenceLine(summarizeRtpSafetyEvidence(evidence)),
    hinBasis: highInjuryNetworkBasis(severityCompleteness),
  };
}

async function corridor(adapter: CrashSourceAdapter, area: typeof CA, records: CrashRecord[]) {
  vi.spyOn(adapter, "fetch").mockResolvedValue(fetched(records));
  return fetchCrashesForStudyArea({ bbox: area.bbox, stateFips: area.stateFips }, { now: new Date(`${YEAR + 1}-06-01T00:00:00Z`) });
}

function expectStatementEverywhere(
  expected: SeriousInjuryAvailability,
  stored: ReturnType<typeof storedSurfaces> | null,
  corridorRun: Awaited<ReturnType<typeof fetchCrashesForStudyArea>>
) {
  const note = String(corridorRun.sourceSnapshot.note);
  expect(corridorRun.narrativeLine).toContain(expected.statement);
  expect(note).toContain(expected.statement);
  if (!stored) return;
  expect(stored.evidence.seriousInjury.statement).toBe(expected.statement);
  expect(stored.reportCaveats).toContain(expected.statement);
  expect(stored.ss4aSeverity).toContain(expected.statement);
  expect(stored.banner).toBe(expected.separable ? "" : expected.statement);
  expect(stored.hinBasis).toBe(expected.separable ? "ksi" : "fatal_only");
  if (expected.separable) {
    expect(stored.reportSeriousFigure.value).toBe(corridorRun.severeInjuryCrashes);
    expect(stored.rtpLine).toMatch(/fatal or serious-injury crash/);
  } else {
    expect(stored.reportSeriousFigure.value).toBeNull();
    expect(stored.reportSeriousFigure.absentBecause).toBe(expected.statement);
    expect(stored.rtpLine).toContain(`serious injuries: ${expected.absenceLabel!.toLowerCase()}`);
    expect(corridorRun.severeInjuryCrashes).toBeNull();
  }
}

describe("serious-injury statements agree across surfaces", () => {
  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __clearFetchJsonResponseCacheForTests();
  });

  it("CCRS with the injured-person join: both the Safety page and the corridor count 1 serious-injury crash and say how", async () => {
    stubInjuredPersonTable("answers");
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched(cityCrashes(CA.bbox, false)));
    const service = fakeService();
    const result = await ingestCrashesForStudyArea({ service: service as never, workspaceId: "ws-1", ...CA, years: [YEAR], includeParties: false });
    const acquisition = storedAcquisition(service);
    expect(acquisition).toMatchObject({ source_id: "ccrs-ca", severity_completeness: "kabco_full" });
    expect(result.seriousInjuryUpgrades).toBe(1);

    vi.restoreAllMocks();
    const corridorRun = await corridor(ccrsAdapter, CA, cityCrashes(CA.bbox, false));
    expect(corridorRun.severeInjuryCrashes).toBe(1);
    expect(corridorRun.severityCompleteness).toBe("kabco_full");
    expect(corridorRun.sourceSnapshot.seriousInjuryEnrichment).toBe("applied");
    // The corridor map paints the same crash as serious that the Safety map stores as serious.
    expect(corridorRun.points.filter((point) => point.properties.severityBucket === "severe_injury")).toHaveLength(1);

    const expected = seriousInjuryAvailability({ declared: "fatal_injury_only", enrichment: "applied" });
    expect(expected.basis).toBe("injured_person_join");
    expect(seriousInjuryAvailability(result.seriousInjury)).toEqual(expected);
    const stored = storedSurfaces(acquisition, service.crashRows);
    expect(stored.reportSeriousFigure.value).toBe(1);
    expectStatementEverywhere(expected, stored, corridorRun);
    expect(corridorRun.narrativeLine).not.toMatch(/not separated here|source does not separate/i);
  });

  it("CCRS when the join cannot run: no surface counts serious injuries, and none blames the source", async () => {
    stubInjuredPersonTable("down");
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched(cityCrashes(CA.bbox, false)));
    const service = fakeService();
    const result = await ingestCrashesForStudyArea({ service: service as never, workspaceId: "ws-1", ...CA, years: [YEAR], includeParties: false });
    const acquisition = storedAcquisition(service);
    expect(acquisition).toMatchObject({ source_id: "ccrs-ca", severity_completeness: "fatal_injury_only" });
    expect(result.seriousInjuryUpgrades).toBe(0);

    vi.restoreAllMocks();
    const corridorRun = await corridor(ccrsAdapter, CA, cityCrashes(CA.bbox, false));
    expect(corridorRun.sourceSnapshot.seriousInjuryEnrichment).toBe("not_applied");

    const expected = seriousInjuryAvailability({ declared: "fatal_injury_only", enrichment: "not_applied" });
    expect(expected.basis).toBe("join_not_applied");
    const stored = storedSurfaces(acquisition, service.crashRows);
    expectStatementEverywhere(expected, stored, corridorRun);
    // The pre-fix sentences: true of neither the source nor the data.
    for (const text of [corridorRun.narrativeLine, String(corridorRun.sourceSnapshot.note), stored.ss4aSeverity, stored.reportCaveats]) {
      expect(text).not.toMatch(/source does not separate|is not, so no KSI total/i);
    }
  });

  it("CCRS with the join switched off reads the same as a join that failed", async () => {
    vi.spyOn(ccrsAdapter, "fetch").mockResolvedValue(fetched(cityCrashes(CA.bbox, false)));
    const service = fakeService();
    await ingestCrashesForStudyArea({ service: service as never, workspaceId: "ws-1", ...CA, years: [YEAR], includeParties: false, enrichSeriousInjury: false });
    expect(seriousInjuryAvailabilityForRecord({ sourceId: "ccrs-ca", severityCompleteness: storedAcquisition(service).severity_completeness }).basis).toBe("join_not_applied");
  });

  it("CCRS with a requested year that has no injured-person table does not claim the join ran", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ result: { resources: [{ id: "ivp-2024", name: "InjuredWitnessPassengers_2024" }] } })) as unknown as typeof fetch
    );
    const corridorRun = await corridor(ccrsAdapter, CA, cityCrashes(CA.bbox, false));
    expect(corridorRun.sourceSnapshot.seriousInjuryEnrichment).toBe("not_applied");
    expect(corridorRun.severeInjuryCrashes).toBeNull();
  });

  it("FARS: every surface says fatal crashes only, and nothing counts serious injuries", async () => {
    const fatalOnly = [crash("f1", "fatal", NV.bbox), crash("f2", "fatal", NV.bbox)];
    vi.spyOn(farsAdapter, "fetch").mockResolvedValue(fetched(fatalOnly));
    const service = fakeService();
    const result = await ingestCrashesForStudyArea({ service: service as never, workspaceId: "ws-1", ...NV, years: [YEAR], includeParties: false });
    const acquisition = storedAcquisition(service);
    expect(acquisition).toMatchObject({ source_id: "fars-national", severity_completeness: "fatal_only" });

    vi.restoreAllMocks();
    const corridorRun = await corridor(farsAdapter, NV, fatalOnly);
    const expected = seriousInjuryAvailability({ declared: "fatal_only", enrichment: "not_supported" });
    expect(seriousInjuryAvailability(result.seriousInjury)).toEqual(expected);
    const stored = storedSurfaces(acquisition, service.crashRows);
    expect(stored.ss4aSeverity).toMatch(/^Fatal crashes only\. /);
    expectStatementEverywhere(expected, stored, corridorRun);
  });

  it("a KABCO state file (Oregon): the corridor and every reader of its record count serious injuries from the source's own field", async () => {
    // Oregon's file is read-only (`safety_crashes` does not admit it), so it
    // reaches the corridor and the Safety live read, never a stored row. The
    // stored surfaces are read here the way they would read its row.
    const records = cityCrashes(OR.bbox, true);
    const corridorRun = await corridor(odotOrAdapter, OR, records);
    expect(corridorRun.source).toBe("odot-or");
    expect(corridorRun.severeInjuryCrashes).toBe(1);
    expect(corridorRun.severityCompleteness).toBe("kabco_full");
    const expected = seriousInjuryAvailability({ declared: "kabco_full", enrichment: "not_supported" });
    expect(expected.basis).toBe("source_severity");
    const asRecorded = storedSurfaces({ source_id: "odot-or", severity_completeness: "kabco_full" }, records.map((record) => ({ severity: record.severity })));
    expect(asRecorded.reportSeriousFigure.value).toBe(1);
    expectStatementEverywhere(expected, asRecorded, corridorRun);
  });

  it("describes every registered source exactly as its adapter declares it", () => {
    // The client-safe table is a copy of the adapters; a copy drifts unless
    // something fails when it does.
    expect(Object.keys(CRASH_SOURCE_SERIOUS_INJURY).sort()).toEqual(CRASH_SOURCE_ADAPTERS.map((adapter) => adapter.id).sort());
    for (const adapter of CRASH_SOURCE_ADAPTERS) {
      expect(CRASH_SOURCE_SERIOUS_INJURY[adapter.id]).toEqual({
        declared: adapter.severityCompleteness,
        seriousInjuryJoin: typeof adapter.enrichSeriousInjury === "function",
      });
    }
  });

  it("claims nothing about a source the record does not name", () => {
    const unnamed = seriousInjuryAvailabilityForRecord({ sourceId: null, severityCompleteness: "fatal_injury_only" });
    expect(unnamed.basis).toBe("unknown");
    expect(unnamed.separable).toBe(false);
    expect(unnamed.statement).not.toMatch(/injured-person|source does not separate/i);
  });
});
