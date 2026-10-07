import { describe, expect, it } from "vitest";
import { bcaDocumentSchema } from "@/lib/bca/workbench/schema";
import {
  calculateBcaDocument,
  calculateBcaSensitivity,
} from "@/lib/bca/workbench/engine";
import { exampleBcaDocument, newBcaFlow } from "@/lib/bca/workbench/document";
import { bcaWorkbook, exportBcaPackage } from "@/lib/bca/workbench/export";
import { importBcaModelEvidence } from "@/lib/bca/workbench/model-evidence";
import JSZip from "jszip";
import * as XLSX from "xlsx";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const example = () => exampleBcaDocument(project);
describe("annual BCA calculation", () => {
  it("matches an independent annuity and preserves inputs", () => {
    const doc = example(),
      before = JSON.stringify(doc),
      r = calculateBcaDocument(doc);
    let factor = 0;
    for (let year = 2028; year <= 2047; year++)
      factor += 1 / Math.pow(1.07, year - 2026);
    expect(r.presentValueBenefits).toBeCloseTo(322000 * factor, 6);
    expect(r.presentValueCosts).toBe(2000000);
    expect(r.netPresentValue).toBeCloseTo(322000 * factor - 2000000, 6);
    expect(r.benefitCostRatio).toBeCloseTo((322000 * factor) / 2000000, 10);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it("changes BCR accounting without changing NPV", () => {
    const doc = example(),
      federal = calculateBcaDocument(doc),
      state = calculateBcaDocument({ ...doc, costConvention: "all-costs" });
    expect(state.netPresentValue).toBeCloseTo(federal.netPresentValue!, 6);
    expect(state.presentValueCosts).toBeGreaterThan(federal.presentValueCosts);
    expect(state.benefitCostRatio).not.toBeCloseTo(
      federal.benefitCostRatio!,
      4,
    );
  });
  it("does not turn absent inputs or zero costs into a ratio", () => {
    const doc = example();
    doc.flows[1].build = null;
    const r = calculateBcaDocument(doc);
    expect(r.complete).toBe(false);
    expect(r.benefitCostRatio).toBeNull();
    expect(r.rows.some((r) => r.flowId === "time")).toBe(false);
    doc.flows[1].build = 0;
    doc.flows[0].build = 0;
    expect(calculateBcaDocument(doc).benefitCostRatio).toBeNull();
  });
  it("keeps disbenefits and cost savings signed", () => {
    const doc = example();
    doc.flows[1].build = 110000;
    doc.flows[2].build = 5000;
    const r = calculateBcaDocument(doc);
    expect(r.netPresentValue).toBeLessThan(-2000000);
    expect(r.rows.find((r) => r.flowId === "maintenance")!.value).toBe(-5000);
    expect(r.rows.find((r) => r.flowId === "time")!.value).toBe(-218000);
  });
  it("adds final-year residual value with an explicit increase direction", () => {
    const doc = example(),
      base = calculateBcaDocument(doc);
    doc.flows.push({
      ...newBcaFlow(doc, "benefit", "residual"),
      category: "residual",
      benefitDirection: "increase",
      unit: "dollar",
      noBuild: 0,
      build: 1000000,
      unitValue: 1,
      startYear: 2047,
      endYear: 2047,
    });
    expect(
      calculateBcaDocument(doc).netPresentValue! - base.netPresentValue!,
    ).toBeCloseTo(1000000 / 1.07 ** 21, 6);
    doc.flows[3].benefitDirection = "reduction";
    expect(
      calculateBcaDocument(doc).issues.some(
        (i) => i.code === "residual-direction",
      ),
    ).toBe(true);
  });
  it("rejects dollar multipliers in annual overrides", () => {
    const doc = example();
    doc.flows[0].annualOverrides = [
      { year: 2026, noBuild: 0, build: 2000000, unitValue: 10 },
    ];
    expect(
      calculateBcaDocument(doc).issues.some((i) => i.code === "dollar-unit"),
    ).toBe(true);
  });
  it("preserves explicit annual overrides and discount epoch", () => {
    const doc = example();
    doc.flows[1].quantityGrowthPct = 10;
    doc.flows[1].annualOverrides = [
      { year: 2030, noBuild: 100, build: 50, unitValue: 20 },
    ];
    const r = calculateBcaDocument(doc);
    expect(
      r.rows.find((r) => r.flowId === "time" && r.year === 2030)!.value,
    ).toBe(1000);
    expect(
      r.rows.find((r) => r.flowId === "time" && r.year === 2029)!.value,
    ).toBeCloseTo(15000 * 1.1 * 21.8);
    expect(r.rows.find((r) => r.year === 2026)!.presentValue).toBe(2000000);
  });
  it("refuses clipped costs, duplicate years and incompatible dollar conversions", () => {
    const doc = example();
    doc.flows[0].endYear = 2200;
    expect(bcaDocumentSchema.safeParse(doc).success).toBe(false);
    doc.flows[0].endYear = 2026;
    doc.flows[0].annualOverrides = [
      { year: 2026, noBuild: 0, build: 1, unitValue: 1 },
      { year: 2026, noBuild: 0, build: 1, unitValue: 1 },
    ];
    expect(bcaDocumentSchema.safeParse(doc).success).toBe(false);
    doc.flows[0].annualOverrides = [];
    doc.flows[1].priceYear = 2021;
    doc.flows[1].priceFactor = null;
    expect(
      calculateBcaDocument(doc).issues.some((i) => i.code === "price-year"),
    ).toBe(true);
  });
  it("keeps assumptions, model limits, overlap and profile departures visible", () => {
    const doc = example();
    doc.discountRatePct = 3.1;
    doc.evidence[0].status = "model-screening";
    doc.flows[0].overlapGroup = "same";
    doc.flows[1].overlapGroup = "same";
    expect(calculateBcaDocument(doc).issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["model-use", "overlap", "profile-deviation"]),
    );
  });
  it("stress cases recalculate capital-only accounting", () => {
    const doc = example(),
      r = calculateBcaDocument(doc),
      s = calculateBcaSensitivity(doc),
      high = s.cases.find((c) => c.label === "Higher costs")!;
    expect(high.costs).toBe(2600000);
    expect(high.benefits).toBeLessThan(r.presentValueBenefits);
    expect(high.npv).toBeLessThan(r.netPresentValue!);
    expect(s.breakEvenBenefitMultiplier).toBeGreaterThan(0);
    expect(s.cases.find((c) => c.label === "Lower benefits")!.bcr).toBeLessThan(
      r.benefitCostRatio!,
    );
  });
  it("imports one method while leaving annualization blank and preserving source identities", () => {
    const model = {
      snapshotId: "snapshot",
      scenarioSetId: "set",
      label: "Comparison",
      updatedAt: "2026-10-06",
      result: {
        method: "aequilibrae" as const,
        methodLabel: "AequilibraE",
        baseline: {
          runId: "base",
          claimStatus: "screening",
          statusReason: "No independent acceptance",
        },
        build: { runId: "build", claimStatus: "screening", statusReason: null },
        metrics: [
          {
            key: "daily_vmt" as const,
            label: "VMT",
            baseline: 100,
            build: 80,
            delta: -20,
            percentDelta: -20,
            unit: "vehicle-miles/day",
          },
        ],
      },
    };
    const imported = importBcaModelEvidence(example(), model);
    expect(imported.flows.at(-1)?.noBuild).toBe(100);
    expect(imported.flows.at(-1)?.build).toBe(80);
    expect(imported.flows.at(-1)?.annualization).toBeNull();
    expect(imported.evidence.at(-1)?.status).toBe("model-screening");
    expect(imported.evidence.at(-1)?.locator).toContain("base");
    expect(() => importBcaModelEvidence(imported, model)).toThrow("already");
    model.result.metrics[0].unit = "km/day";
    expect(() => importBcaModelEvidence(example(), model)).toThrow("supported");
  });
});
describe("BCA calculation package", () => {
  it("retains formulas, linked discount controls and source/input records", async () => {
    const doc = example(),
      book = bcaWorkbook(doc);
    expect(book.Sheets.Ledger.K2.f).toContain("Summary!$B$5");
    expect(book.Sheets.Ledger.L2.f).toBe("E2-Summary!$B$4");
    expect(book.Sheets.Ledger.M2.f).toContain('R2="reduction"');
    expect(book.Sheets.Ledger.U1.v).toBe("Quantity unit");
    expect(book.Sheets.Ledger.U2.v).toBe(doc.flows[0].unit);
    expect(book.Sheets.Ledger.V2.v).toBe(doc.flows[0].sourceIds.join("; "));
    expect(book.Sheets.Summary.B10.f).toContain("B7/B8");
    const zip = await JSZip.loadAsync(await exportBcaPackage(doc));
    expect(await zip.file("annual-ledger.csv")!.async("string")).toContain('"quantity_unit","project_element","quantity_source_ids","valuation_source_id"');
    expect(
      JSON.parse(await zip.file("analysis.json")!.async("string")),
    ).toEqual(doc);
    const reopened = XLSX.read(
      await zip.file("calculation.xlsx")!.async("uint8array"),
      { type: "array" },
    );
    expect(reopened.Sheets.Summary.B10.v).toBeCloseTo(
      calculateBcaDocument(doc).benefitCostRatio!,
      10,
    );
    expect(await zip.file("SHA256SUMS.txt")!.async("string")).toContain(
      "calculation.xlsx",
    );
    expect(await zip.file("method-and-review.md")!.async("string")).toContain(
      "Synthetic",
    );
  });
  it("escapes report markup and CSV formula-like input", async () => {
    const doc = example();
    doc.title = "<script>alert(1)</script>";
    doc.evidence[0].title = '=HYPERLINK("bad")';
    const zip = await JSZip.loadAsync(await exportBcaPackage(doc));
    const html = await zip.file("report.html")!.async("string");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const rendered = new DOMParser().parseFromString(html, "text/html");
    expect(rendered.querySelector("script")).toBeNull();
    expect(rendered.querySelector("h1")?.textContent).toBe(doc.title);
    expect(await zip.file("source-register.csv")!.async("string")).toContain(
      "'=HYPERLINK",
    );
  });
});

describe("quantity helpers", () => {
  it("calculates rule-of-half annual person-hours without mixing vehicle-hours", async () => {
    const { travelTimeQuantity } = await import(
      "@/lib/bca/workbench/quantities"
    );
    const q = travelTimeQuantity({
      noBuildTrips: 1000,
      buildTrips: 1200,
      noBuildMinutes: 30,
      buildMinutes: 20,
      occupancy: 2,
      days: 250,
    });
    expect(q.noBuild - q.build).toBeCloseTo(((1100 * 10) / 60) * 2 * 250);
    expect(() =>
      travelTimeQuantity({
        noBuildTrips: 1,
        buildTrips: 1,
        noBuildMinutes: 1,
        buildMinutes: 0,
        occupancy: 0,
        days: 250,
      }),
    ).toThrow();
  });
  it("applies a CMF without concealing worsening safety", async () => {
    const { safetyQuantity } = await import("@/lib/bca/workbench/quantities");
    const q = safetyQuantity({ events: 20, years: 5, cmf: 1.2 });
    expect(q.noBuild).toBe(4);
    expect(q.build).toBe(4.8);
    expect(() => safetyQuantity({ events: 20, years: 0, cmf: 0.8 })).toThrow();
  });
  it("calculates disjoint hazard expected losses and rejects impossible total probability", async () => {
    const { resilienceQuantity } = await import(
      "@/lib/bca/workbench/quantities"
    );
    const q = resilienceQuantity([
      { label: "mild", probability: 0.1, noBuildLoss: 1000, buildLoss: 500 },
      {
        label: "severe",
        probability: 0.01,
        noBuildLoss: 100000,
        buildLoss: 50000,
      },
    ]);
    expect(q.noBuild).toBe(1100);
    expect(q.build).toBe(550);
    expect(() =>
      resilienceQuantity([
        { label: "a", probability: 0.8, noBuildLoss: 1, buildLoss: 0 },
        { label: "b", probability: 0.3, noBuildLoss: 1, buildLoss: 0 },
      ]),
    ).toThrow("sum above");
  });
  it("flags a federal horizon beyond 30 operating years", () => {
    const doc = example();
    doc.endYear = 2090;
    expect(
      calculateBcaDocument(doc).issues.some((i) => i.code === "horizon"),
    ).toBe(true);
  });
});

describe("element reporting", () => {
  it("does not manufacture ratios for elements without allocated capital", async () => {
    const { calculateBcaComponents } = await import(
      "@/lib/bca/workbench/engine"
    );
    const doc = example();
    doc.flows[1].component = "Separate time element";
    const elements = calculateBcaComponents(doc);
    expect(elements).toHaveLength(2);
    expect(
      elements.find((e) => e.component === "Separate time element")!.result
        .benefitCostRatio,
    ).toBeNull();
    expect(
      elements.reduce((s, e) => s + e.result.presentValueBenefits, 0),
    ).toBeCloseTo(calculateBcaDocument(doc).presentValueBenefits, 6);
  });
});

describe("published parameter units", () => {
  it("refuses a mismatched quantity unit and discloses value departures", () => {
    const doc = example();
    doc.flows[1].parameterSourceId = "usdot-2026-personal-time";
    doc.flows[1].unit = "vehicle-hour";
    const r = calculateBcaDocument(doc);
    expect(r.complete).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["parameter-unit", "parameter-departure"]),
    );
  });
});

describe("published operator time", () => {
  it("accepts operator person-hours and flags unsupported real valuation escalation", () => {
    const doc = example();
    doc.flows[1].parameterSourceId = "usdot-2026-truck-time";
    doc.flows[1].unitValue = 37.2;
    expect(
      calculateBcaDocument(doc).issues.some((i) => i.code === "parameter-unit"),
    ).toBe(false);
    doc.flows[1].realValueGrowthPct = 10;
    expect(
      calculateBcaDocument(doc).issues.some(
        (i) => i.code === "parameter-departure",
      ),
    ).toBe(true);
  });
});

it("does not report partial NPV when an alternate discount rate exceeds the calculation range", () => {
  const doc = example();
  doc.discountRatePct = 100;
  doc.sensitivity.alternateDiscountRatePct = 0;
  const time = doc.flows.find(flow => flow.category === "travel-time")!;
  Object.assign(time, {noBuild:1e13,build:0,unitValue:1,quantityGrowthPct:100});
  expect(calculateBcaDocument(doc).complete).toBe(true);
  const alternate = calculateBcaSensitivity(doc).cases.at(-1)!;
  expect(alternate.bcr).toBeNull();
  expect(alternate.npv).toBeNull();
  expect(alternate.issues.some(issue => issue.code === "overflow")).toBe(true);
});
