import { describe, expect, it, vi } from "vitest";

import {
  DEMOGRAPHICS_SCREENING_CAVEAT,
  demographicsRowFromInput,
  loadDemographicsSummary,
  shapeDemographicsSummary,
  type DemographicsSummaryRow,
} from "@/lib/engagement/demographics";

const RPC_ROWS: DemographicsSummaryRow[] = [
  { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 12 },
  { dimension: "age_band", band: "25_34", respondent_count: 6 },
  { dimension: "age_band", band: "35_44", respondent_count: 5 },
  // 'suppressed' counts are always >= 5 (the RPC floors the residual bucket).
  { dimension: "age_band", band: "suppressed", respondent_count: 5 },
  { dimension: "primary_language", band: "en", respondent_count: 7 },
  { dimension: "primary_language", band: "es", respondent_count: 5 },
  { dimension: "household_tenure", band: "rent", respondent_count: 8 },
  { dimension: "household_tenure", band: "suppressed", respondent_count: 5 },
  { dimension: "race_ethnicity", band: "white", respondent_count: 6 },
  { dimension: "race_ethnicity", band: "hispanic", respondent_count: 5 },
  { dimension: "race_ethnicity", band: "suppressed", respondent_count: 5 },
];

describe("shapeDemographicsSummary", () => {
  it("groups by dimension, labels bands, sorts desc with 'suppressed' last", () => {
    const summary = shapeDemographicsSummary(RPC_ROWS);
    expect(summary.respondentsWithDemographics).toBe(12);
    expect(summary.hasAny).toBe(true);
    expect(summary.hasSuppressed).toBe(true);
    expect(summary.caveat).toBe(DEMOGRAPHICS_SCREENING_CAVEAT);

    expect(summary.dimensions.age_band.map((b) => b.band)).toEqual(["25_34", "35_44", "suppressed"]);
    expect(summary.dimensions.age_band[0].label).toBe("25–34");
    expect(summary.dimensions.household_tenure.map((b) => b.band)).toEqual(["rent", "suppressed"]);
    expect(summary.dimensions.race_ethnicity[0]).toEqual({ band: "white", label: "White", count: 6 });
  });

  it("coerces string-typed bigint counts and ignores unknown dimensions", () => {
    const summary = shapeDemographicsSummary([
      { dimension: "age_band", band: "25_34", respondent_count: "6" },
      { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: "6" },
      { dimension: "not_a_dimension", band: "x", respondent_count: 99 },
    ]);
    expect(summary.dimensions.age_band[0].count).toBe(6);
    expect(summary.respondentsWithDemographics).toBe(6);
  });

  it("reports an empty summary when there are no rows", () => {
    const summary = shapeDemographicsSummary([]);
    expect(summary.hasAny).toBe(false);
    expect(summary.hasSuppressed).toBe(false);
    expect(summary.respondentsWithDemographics).toBe(0);
  });
});

describe("demographicsRowFromInput", () => {
  it("coarsens ZIP-5 to ZIP-3 and keeps the multi-select race array", () => {
    const row = demographicsRowFromInput("item-1", "camp-1", {
      ageBand: "25_34",
      zip5: "95945",
      primaryLanguage: "es",
      raceEthnicity: ["hispanic", "white"],
      householdTenure: "rent",
      consented: true,
    });
    expect(row).toEqual({
      item_id: "item-1",
      campaign_id: "camp-1",
      age_band: "25_34",
      zip3: "959",
      primary_language: "es",
      race_ethnicity: ["hispanic", "white"],
      household_tenure: "rent",
      consented: true,
    });
  });

  it("drops an invalid ZIP and an empty race array", () => {
    const row = demographicsRowFromInput("i", "c", { ageBand: "18_24", zip5: "9594", raceEthnicity: [] });
    expect(row?.zip3).toBeNull();
    expect(row?.race_ethnicity).toBeNull();
    expect(row?.age_band).toBe("18_24");
  });

  it("returns null when the respondent supplied nothing storable", () => {
    expect(demographicsRowFromInput("i", "c", {})).toBeNull();
    expect(demographicsRowFromInput("i", "c", { raceEthnicity: [], consented: true })).toBeNull();
    expect(demographicsRowFromInput("i", "c", undefined)).toBeNull();
  });
});

describe("loadDemographicsSummary", () => {
  it("calls the RPC scoped to the campaign and shapes the result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: RPC_ROWS, error: null });
    const { summary, error } = await loadDemographicsSummary({ rpc }, "camp-9");
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("engagement_demographics_summary", { p_campaign_id: "camp-9" });
    expect(summary.respondentsWithDemographics).toBe(12);
  });

  it("returns an empty summary and the message on RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const { summary, error } = await loadDemographicsSummary({ rpc }, "camp-9");
    expect(error).toBe("boom");
    expect(summary.hasAny).toBe(false);
  });
});
