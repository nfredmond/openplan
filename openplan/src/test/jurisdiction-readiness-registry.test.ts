import { describe, expect, it } from "vitest";
import {
  JURISDICTION_READINESS_REGISTRY,
  resolveAllJurisdictionReadiness,
  resolveJurisdictionReadiness,
} from "@/lib/jurisdiction-readiness/registry";

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
    const report = resolveJurisdictionReadiness(
      { countryCode: "US", subdivisionCode: "NV", label: "A Nevada county" },
      "land-use-plan",
    );

    expect(report).toMatchObject({
      jurisdiction: { id: "US-NV" },
      status: "unassessed",
      adapterIds: [],
      sources: [],
    });
    expect(JSON.stringify(report)).not.toContain("California");
  });

  it("keeps an unidentified or multi-subdivision place unassessed", () => {
    const report = resolveJurisdictionReadiness(
      { countryCode: "US", subdivisionCode: null, label: "A multistate region" },
      "project-evidence-handoff",
    );

    expect(report?.status).toBe("unassessed");
    expect(report?.applicability).toMatch(/does not identify one subdivision/i);
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
    expect(reports.find((report) => report.job.id === "safety-analysis")?.limitations.join(" ")).toMatch(
      /fatal-only/i,
    );
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
