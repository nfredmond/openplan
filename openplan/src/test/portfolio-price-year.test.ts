import { describe, expect, it } from "vitest";
import { reviewPortfolioImport, reviewPortfolioWorkbook, type PortfolioSheetConfiguration } from "@/lib/projects/portfolio-import";

const configuration: PortfolioSheetConfiguration = {
  worksheetIndex: 0, headerRow: 1, mapping: { name: 0, estimatedCost: 1 },
  defaults: {
    planType: "capital_program", status: "draft", deliveryPhase: "programming",
    cost: { currency: "USD", scale: "ones", priceYear: null },
  },
};

function review(csv: string, config = configuration) {
  return reviewPortfolioWorkbook({
    bytes: new TextEncoder().encode(csv), filename: "costs.csv", contentType: "text/csv",
    configurations: [config], existingProjects: [], previouslyCreatedRows: [],
  });
}

describe("portfolio cost price-year evidence", () => {
  it.each([0, 3001, 2022.5])("does not turn an invalid explicit default %s into an unknown year", (priceYear) => {
    expect(() => reviewPortfolioImport({
      bytes: new TextEncoder().encode("Name,Cost\nBridge,4200000"),
      mapping: configuration.mapping,
      defaults: { ...configuration.defaults, cost: { ...configuration.defaults.cost!, priceYear } },
    })).toThrowError(expect.objectContaining({ code: "missing_cost_defaults" }));
  });

  it("preserves unknown price-year evidence in the legacy CSV reviewer too", () => {
    const result = reviewPortfolioImport({
      bytes: new TextEncoder().encode("Name,Cost\nBridge,4200000"),
      mapping: configuration.mapping, defaults: configuration.defaults,
    });
    expect(result.rows[0]).toMatchObject({
      estimatedCost: { amount: "4200000", currency: "USD", priceYear: null },
      state: "warning", errors: [], warnings: [{ code: "unknown_price_year" }],
    });
  });

  it("retains a cost with an unknown year and warns instead of inventing the current year", async () => {
    const result = await review("Name,Cost\nBridge,4200000");
    expect(result.rows[0]).toMatchObject({
      estimatedCost: { amount: "4200000", currency: "USD", priceYear: null },
      state: "warning", canCreate: true, errors: [],
      warnings: [{ code: "unknown_price_year", message: expect.stringMatching(/unknown/i) }],
    });
  });

  it("keeps a blank mapped source year unknown even when a default year was supplied", async () => {
    const result = await review("Name,Cost,Year\nBridge,4200000,", {
      ...configuration, mapping: { ...configuration.mapping, costPriceYear: 2 },
      defaults: { ...configuration.defaults, cost: { ...configuration.defaults.cost!, priceYear: 2024 } },
    });
    expect(result.rows[0].estimatedCost?.priceYear).toBeNull();
    expect(result.rows[0].warnings).toContainEqual(expect.objectContaining({ code: "unknown_price_year" }));
  });

  it.each(["2022", "0", "2022.5", "unknown", "3001"])("preserves or rejects the explicit source value %s", async (year) => {
    const result = await review(`Name,Cost,Year\nBridge,4200000,${year}`, {
      ...configuration, mapping: { ...configuration.mapping, costPriceYear: 2 },
    });
    if (year === "2022") {
      expect(result.rows[0].estimatedCost?.priceYear).toBe(2022);
      expect(result.rows[0].warnings).toEqual([]);
    } else {
      expect(result.rows[0].estimatedCost).toBeNull();
      expect(result.rows[0].errors).toContainEqual(expect.objectContaining({ code: "invalid_cost" }));
    }
  });
});
