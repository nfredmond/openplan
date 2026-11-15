import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JURISDICTION_READINESS_REGISTRY,
  resolveAllJurisdictionReadiness,
  resolveJurisdictionReadiness,
} from "@/lib/jurisdiction-readiness/registry";
import type { JurisdictionReadinessClaim } from "@/lib/jurisdiction-readiness/contracts";
import { STATE_FIPS_TO_USPS, stateFipsFromUsps } from "@/lib/geographies/state-fips";
import { crashSourcesForStudyArea } from "@/lib/safety/sources/registry";
import { FARS_EARLIEST_YEAR, FARS_PUBLISHED_CUTOFF, FARS_SOURCE_ID } from "@/lib/safety/sources/fars";
import { describeGrantProgramCoverage } from "@/lib/grants/programs/coverage";
import { recommendJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import stateInjuryReview from "../../../docs/research/STATE_INJURY_CRASH_SOURCES_2026-11-01.json";

const REPO_ROOT = resolve(process.cwd(), "..");

/** Entries written from the code inventory rather than a frozen journey. */
const CODE_INVENTORY_KIND = "code-inventory";

/** The study-area bbox does not decide a source once the state is known. */
const ANY_BBOX = { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 };

const SOURCES_BY_ID = new Map(JURISDICTION_READINESS_REGISTRY.sources.map((source) => [source.id, source]));

function claimFor(jurisdictionId: string, jobId: string): JurisdictionReadinessClaim {
  const claim = JURISDICTION_READINESS_REGISTRY.claims.find(
    (candidate) => candidate.jurisdictionId === jurisdictionId && candidate.jobId === jobId,
  );
  if (!claim) throw new Error(`no ${jobId} claim for ${jurisdictionId}`);
  return claim;
}

function citedSourcePaths(claim: JurisdictionReadinessClaim): string[] {
  return claim.sourceIds.map((sourceId) => SOURCES_BY_ID.get(sourceId)!.path);
}

function citedSourceText(claim: JurisdictionReadinessClaim): string {
  return citedSourcePaths(claim)
    .map((path) => readFileSync(resolve(REPO_ROOT, path), "utf8"))
    .join("\n");
}

const US_JURISDICTIONS = JURISDICTION_READINESS_REGISTRY.jurisdictions.filter(
  (jurisdiction) => jurisdiction.country === "US",
);

describe("jurisdiction readiness registry", () => {
  it("resolves only an exact jurisdiction and job claim", () => {
    const report = resolveJurisdictionReadiness(
      { countryCode: "us", subdivisionCode: "or", label: "Deschutes County, Oregon" },
      "grants-and-reimbursement",
      { registrySha256: "a".repeat(64) },
    );

    expect(report).toMatchObject({
      jurisdiction: { id: "US-OR", label: "Deschutes County, Oregon" },
      status: "partial",
      registrySha256: "a".repeat(64),
      adapterIds: ["us-federal", "us-or"],
    });
    expect(report?.sources.map((source) => source.id)).toEqual([
      "grant-program-registry",
      "federal-grant-adapter",
      "oregon-grant-adapter",
    ]);
    expect(report?.authorities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "program_catalog",
        agency: "Oregon Department of Transportation",
      }),
    ]));
  });

  it("does not inherit California or country-level behavior for an unregistered subdivision", () => {
    // Canada's country code is CA; it must never reach the US-CA entry.
    const report = resolveJurisdictionReadiness(
      { countryCode: "CA", subdivisionCode: "BC", label: "A British Columbia regional district" },
      "land-use-plan",
    );

    expect(report).toMatchObject({
      jurisdiction: { id: "CA-BC" },
      status: "unassessed",
      adapterIds: [],
      sources: [],
    });
    expect(JSON.stringify(report)).not.toContain("California");
  });

  it("answers a registered state from its own entry without borrowing California", () => {
    const reports = resolveAllJurisdictionReadiness({
      countryCode: "US",
      subdivisionCode: "NV",
      label: "A Nevada county",
    });

    expect(reports.map((report) => [report.job.id, report.status])).toEqual([
      ["project-evidence-handoff", "unassessed"],
      ["land-use-plan", "unavailable"],
      ["safety-analysis", "partial"],
      ["grants-and-reimbursement", "unavailable"],
      ["model-validation-evidence", "unavailable"],
    ]);
    expect(reports.every((report) => report.jurisdiction.id === "US-NV")).toBe(true);
    expect(reports.find((report) => report.job.id === "safety-analysis")?.adapterIds).toEqual([FARS_SOURCE_ID]);
    expect(JSON.stringify(reports)).not.toContain("California");
  });

  it("keeps an unidentified or multi-subdivision place unassessed", () => {
    const report = resolveJurisdictionReadiness(
      { countryCode: "US", subdivisionCode: null, label: "A multistate region" },
      "project-evidence-handoff",
    );

    expect(report?.status).toBe("unassessed");
    expect(report?.applicability).toMatch(/no single state, DC or territory on record/);
  });

  it("makes Puerto Rico limits explicit for every registered job", () => {
    const reports = resolveAllJurisdictionReadiness({
      countryCode: "US",
      subdivisionCode: "PR",
      label: "Puerto Rico",
    });

    expect(reports).toHaveLength(JURISDICTION_READINESS_REGISTRY.jobs.length);
    expect(reports.every((report) => report.status !== "unassessed")).toBe(true);
    expect(reports.find((report) => report.job.id === "land-use-plan")?.status).toBe("unavailable");
    // FARS reads NHTSA's separate Puerto Rico file, fatal-only and only from
    // 2020, when that file starts carrying coordinates.
    const safety = reports.find((report) => report.job.id === "safety-analysis");
    expect(safety?.status).toBe("partial");
    expect(safety?.applicability).toMatch(/2020 through 2024/);
    expect(safety?.limitations.join(" ")).toMatch(/fatal-only/i);
    expect(safety?.limitations.join(" ")).toMatch(/2010 through 2019 carry no crash coordinates/);
  });

  it("does not omit evidence or adapter lineage from a configured claim", () => {
    for (const claim of JURISDICTION_READINESS_REGISTRY.claims) {
      expect(claim.sourceIds.length, claim.id).toBeGreaterThan(0);
      expect(claim.limitations.length, claim.id).toBeGreaterThan(0);
      expect(Array.isArray(claim.authorities), claim.id).toBe(true);
    }
  });

  it("pins official law and observed-data authorities for configured positive claims", () => {
    const californiaPlan = resolveJurisdictionReadiness(
      { countryCode: "US", subdivisionCode: "CA" },
      "land-use-plan",
    );
    const puertoRicoSafety = resolveJurisdictionReadiness(
      { countryCode: "US", subdivisionCode: "PR" },
      "safety-analysis",
    );

    expect(californiaPlan?.authorities.map((authority) => authority.kind)).toContain("statute");
    expect(californiaPlan?.authorities.every((authority) => authority.url.startsWith("https://leginfo.legislature.ca.gov/"))).toBe(true);
    expect(puertoRicoSafety?.authorities).toEqual([
      expect.objectContaining({ kind: "data_source", agency: "National Highway Traffic Safety Administration" }),
    ]);
  });

  it("hash-binds every directly claimed jurisdiction adapter", () => {
    const sourceIds = new Set(JURISDICTION_READINESS_REGISTRY.sources.map((source) => source.id));
    for (const sourceId of [
      "ccrs-source-adapter",
      "fars-source-adapter",
      "federal-grant-adapter",
      "california-grant-adapter",
      "oregon-grant-adapter",
    ]) {
      expect(sourceIds.has(sourceId), sourceId).toBe(true);
    }

    const californiaSafety = JURISDICTION_READINESS_REGISTRY.claims.find(
      (claim) => claim.id === "US-CA/safety-analysis",
    );
    const californiaGrants = JURISDICTION_READINESS_REGISTRY.claims.find(
      (claim) => claim.id === "US-CA/grants-and-reimbursement",
    );
    expect(californiaSafety?.sourceIds).toContain("ccrs-source-adapter");
    expect(californiaGrants?.sourceIds).toEqual(expect.arrayContaining([
      "federal-grant-adapter",
      "california-grant-adapter",
    ]));
  });
});

describe("readiness entries for every state, DC and inhabited territory", () => {
  it("registers each one with an explicit status for every job", () => {
    const expected = Object.values(STATE_FIPS_TO_USPS).map((usps) => `US-${usps}`).sort();
    expect(US_JURISDICTIONS.map((jurisdiction) => jurisdiction.id).sort()).toEqual(expected);
    for (const jurisdiction of US_JURISDICTIONS) {
      for (const job of JURISDICTION_READINESS_REGISTRY.jobs) {
        expect(() => claimFor(jurisdiction.id, job.id), `${jurisdiction.id}/${job.id}`).not.toThrow();
      }
    }
  });

  it("states the crash sources the source registry serves for each one", () => {
    const farsThrough = Number(FARS_PUBLISHED_CUTOFF.publishedThrough.slice(0, 4));
    for (const jurisdiction of US_JURISDICTIONS) {
      const stateFips = stateFipsFromUsps(jurisdiction.subdivision);
      expect(stateFips, jurisdiction.id).not.toBeNull();
      const { candidates } = crashSourcesForStudyArea({ bbox: ANY_BBOX, stateFips: [stateFips!] }, "read_only");
      const claim = claimFor(jurisdiction.id, "safety-analysis");

      expect(claim.adapterIds, jurisdiction.id).toEqual(candidates.map((adapter) => adapter.id));
      expect(claim.status, jurisdiction.id).toBe(candidates.length > 0 ? "partial" : "unavailable");
      const cited = citedSourceText(claim);
      for (const adapter of candidates) {
        expect(cited, `${jurisdiction.id} cites ${adapter.id}`).toContain(`"${adapter.id}"`);
      }
      if (candidates.some((adapter) => !adapter.persistable)) {
        expect(claim.limitations.join(" "), jurisdiction.id).toMatch(/read live and not stored/);
      }
      const stored = candidates.filter((adapter) => adapter.persistable);
      if (stored.length > 0 && stored.every((adapter) => adapter.severityCompleteness === "fatal_only")) {
        expect(claim.limitations.join(" "), jurisdiction.id).toMatch(/fatal-only/i);
      }
      if (jurisdiction.assessmentKind === CODE_INVENTORY_KIND && candidates.some((adapter) => adapter.id === FARS_SOURCE_ID)) {
        expect(claim.applicability, jurisdiction.id).toContain(`${FARS_EARLIEST_YEAR} through ${farsThrough}`);
      }
    }
  });

  it("repeats the dated state source review for each state that reads FARS alone", () => {
    const verdictText: Record<string, string> = {
      usable: "usable",
      usable_with_limits: "usable with limits",
      not_usable: "not usable",
      unknown: "unknown",
    };
    const reviewed = new Map(stateInjuryReview.states.map((row) => [row.usps, row]));
    let checked = 0;
    for (const jurisdiction of US_JURISDICTIONS) {
      const claim = claimFor(jurisdiction.id, "safety-analysis");
      if (jurisdiction.assessmentKind !== CODE_INVENTORY_KIND) continue;
      if (claim.adapterIds.join() !== FARS_SOURCE_ID) continue;
      const row = reviewed.get(jurisdiction.subdivision!);
      expect(row, jurisdiction.id).toBeDefined();
      expect(claim.limitations.join(" "), jurisdiction.id).toContain(`rated ${row!.name} ${verdictText[row!.verdict]}: ${row!.reason}`);
      expect(citedSourcePaths(claim), jurisdiction.id).toContain("docs/research/STATE_INJURY_CRASH_SOURCES_2026-11-01.md");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("states the grant bundles the program registry matches for each one", () => {
    for (const jurisdiction of US_JURISDICTIONS) {
      const coverage = describeGrantProgramCoverage({ country: "US", subdivision: jurisdiction.subdivision });
      const stateBundles = coverage.bundles
        .filter((bundle) => bundle.scope === "jurisdiction_match")
        .map((bundle) => bundle.key);
      const claim = claimFor(jurisdiction.id, "grants-and-reimbursement");

      expect(claim.status, jurisdiction.id).toBe(stateBundles.length > 0 ? "partial" : "unavailable");
      if (stateBundles.length > 0) {
        expect(claim.adapterIds, jurisdiction.id).toEqual(["us-federal", ...stateBundles]);
        for (const key of stateBundles) {
          expect(citedSourcePaths(claim), jurisdiction.id).toContain(`openplan/src/lib/grants/programs/${key}.ts`);
        }
      } else {
        expect(claim.adapterIds, jurisdiction.id).toEqual([]);
      }
    }
  });

  it("states the land-use plan bundle the plan registry recommends for each one", () => {
    for (const jurisdiction of US_JURISDICTIONS) {
      const recommendation = recommendJurisdictionPlanDescriptor({
        country: "US",
        subdivision: jurisdiction.subdivision,
      });
      const claim = claimFor(jurisdiction.id, "land-use-plan");
      const matched = recommendation.kind === "jurisdiction_matched";

      expect(claim.status, jurisdiction.id).toBe(matched ? "partial" : "unavailable");
      // Puerto Rico's earlier entry lists no adapter; every other entry names the recommended descriptor.
      expect([[], [recommendation.descriptor.id]], jurisdiction.id).toContainEqual(claim.adapterIds);
      if (jurisdiction.assessmentKind === CODE_INVENTORY_KIND) {
        expect(claim.adapterIds, jurisdiction.id).toEqual([recommendation.descriptor.id]);
      }
    }
  });

  it("claims model validation only where the comparable-observation study ran", () => {
    for (const jurisdiction of US_JURISDICTIONS) {
      if (jurisdiction.id === "US-CA") continue;
      const claim = claimFor(jurisdiction.id, "model-validation-evidence");
      expect(claim.status, jurisdiction.id).toBe("unavailable");
      expect(claim.adapterIds, jurisdiction.id).toEqual([]);
    }
  });

  it("keeps entries written from the code inventory to what the code declares", () => {
    const inventoryIds = new Set(
      US_JURISDICTIONS.filter((jurisdiction) => jurisdiction.assessmentKind === CODE_INVENTORY_KIND).map(
        (jurisdiction) => jurisdiction.id,
      ),
    );
    expect(inventoryIds.size).toBeGreaterThan(0);
    const exemplarAuthorityUrls = new Set(
      JURISDICTION_READINESS_REGISTRY.claims
        .filter((claim) => !inventoryIds.has(claim.jurisdictionId))
        .flatMap((claim) => claim.authorities.map((authority) => authority.url)),
    );
    for (const jurisdictionId of inventoryIds) {
      for (const job of JURISDICTION_READINESS_REGISTRY.jobs) {
        const claim = claimFor(jurisdictionId, job.id);
        // No frozen journey exists for these places, so nothing is "supported".
        expect(claim.status, claim.id).not.toBe("supported");
        expect(JSON.stringify(claim), claim.id).not.toContain("California");
        const cited = citedSourceText(claim);
        for (const authority of claim.authorities) {
          const declared = cited.includes(authority.url) || exemplarAuthorityUrls.has(authority.url);
          expect(declared, `${claim.id} ${authority.url}`).toBe(true);
        }
      }
      expect(claimFor(jurisdictionId, "project-evidence-handoff").status, jurisdictionId).toBe("unassessed");
    }
  });
});

/**
 * THE FIRST PROVEN JOB CHANGED WHAT FIVE ROWS MAY SAY, AND NOTHING ELSE.
 *
 * The November 14, 2026 record (docs/product/capability-evidence) holds
 * agent-run hosted journeys for one California county, one Nevada county and
 * a tribal area. The Nevada handoff row said "no Nevada journey is retained as
 * evidence", which the record made false. Each row the record touches now
 * cites it, quotes only counts the record holds, and keeps the status it had:
 * the registry has no rule that a proven job record raises a status.
 *
 * Blind category: whether the record's journeys were themselves sound (the
 * direction check and its review cover that), and rows for jobs the record
 * did not exercise, which are not read here.
 */
describe("rows the first proven job record changes", () => {
  type RecordJourney = { role: string; crashes: { sourceId: string; reportedCount: number; storedCount: number } };
  const capabilityRegistry = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "docs/product/US_PLANNING_CAPABILITY_REGISTRY.json"), "utf8"),
  ) as { provenJobs: Array<{ evidence: Array<{ path: string; sha256: string }> }> };
  const recordEvidence = capabilityRegistry.provenJobs[0].evidence.find((item) => item.path.endsWith(".v1.json"))!;
  const record = JSON.parse(readFileSync(resolve(REPO_ROOT, recordEvidence.path), "utf8")) as {
    journeys: RecordJourney[];
  };
  const journey = (role: string) => record.journeys.find((candidate) => candidate.role === role)!;
  const RECORD_SOURCE = "first-proven-job-record-20261114";

  it("pins the same record bytes the proven job entry names", () => {
    expect(SOURCES_BY_ID.get(RECORD_SOURCE)).toEqual({
      id: RECORD_SOURCE,
      path: recordEvidence.path,
      sha256: recordEvidence.sha256,
    });
  });

  it("cites the record from exactly these rows and leaves each status as it was", () => {
    const citing = JURISDICTION_READINESS_REGISTRY.claims
      .filter((claim) => claim.sourceIds.includes(RECORD_SOURCE))
      .map((claim) => [claim.id, claim.status]);
    expect(citing).toEqual([
      ["US-CA/safety-analysis", "partial"],
      ["US-CA/grants-and-reimbursement", "partial"],
      ["US-NV/project-evidence-handoff", "unassessed"],
      ["US-NV/safety-analysis", "partial"],
      ["US-NV/grants-and-reimbursement", "unavailable"],
    ]);
    for (const claim of JURISDICTION_READINESS_REGISTRY.claims.filter((row) => row.sourceIds.includes(RECORD_SOURCE))) {
      const text = [claim.applicability, ...claim.limitations].join(" ");
      expect(text, claim.id).toMatch(/agent-run journey on the hosted site/);
    }
  });

  it("names the journey in every limit, because limits print under their own heading in each project's plan", () => {
    // Review 54: "The county's 12 stored crashes ... No planner reviewed the plan." read as the
    // reader's own county and plan on every Nevada project.
    for (const claim of JURISDICTION_READINESS_REGISTRY.claims.filter((row) => row.sourceIds.includes(RECORD_SOURCE))) {
      for (const limitation of claim.limitations) {
        expect(limitation, claim.id).not.toMatch(/^The county|\bits plan\b|reviewed the plan\./);
        if (/case numbers|not checked against the source independently/.test(limitation)) {
          expect(limitation, claim.id).toMatch(/^In the November 14, 2026 journey,/);
          expect(limitation, claim.id).toMatch(/the plan that journey exported/);
        }
      }
    }
  });

  it("no longer says no Nevada journey is retained, and still does not assess the handoff", () => {
    const claim = claimFor("US-NV", "project-evidence-handoff");
    expect(claim.applicability).not.toMatch(/no Nevada journey/i);
    expect(claim.applicability).toMatch(/did not assemble an evidence package/);
    expect(claim.limitations.join(" ")).toMatch(/not assessed here/);
  });

  it("quotes the crash counts the record holds, and their limits", () => {
    const california = journey("california-county").crashes;
    const nevada = journey("nevada-county").crashes;
    const californiaSafety = claimFor("US-CA", "safety-analysis");
    const nevadaSafety = claimFor("US-NV", "safety-analysis");

    expect(california.sourceId).toBe("ccrs-ca");
    expect(californiaSafety.applicability).toContain(
      `stored ${california.storedCount} of the ${california.reportedCount} CCRS crashes`,
    );
    expect(californiaSafety.limitations.join(" ")).toMatch(/not checked against the source independently/);

    expect(nevada.sourceId).toBe(FARS_SOURCE_ID);
    expect(nevadaSafety.applicability).toContain(`stored ${nevada.storedCount} FARS fatal crashes for one Nevada county`);
    expect(nevadaSafety.limitations.join(" ")).toContain(`same ${nevada.storedCount} case numbers`);
    expect(nevadaSafety.limitations.join(" ")).toMatch(/fatal-only/i);
  });

  it("says the grant journeys covered one federal program and no award or reimbursement", () => {
    for (const jurisdictionId of ["US-CA", "US-NV"]) {
      const claim = claimFor(jurisdictionId, "grants-and-reimbursement");
      expect(claim.applicability + " " + claim.limitations.join(" "), jurisdictionId).toMatch(/federal SS4A/);
      expect(claim.limitations.join(" "), jurisdictionId).toMatch(/recorded no award or reimbursement/);
    }
  });
});
