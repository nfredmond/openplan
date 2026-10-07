import { presentValue } from "../engine";
import { getBcaProfile, USDOT_PARAMETERS } from "./profiles";
import { bcaDocumentSchema, type BcaDocument } from "./schema";

export const WORKBENCH_ENGINE_VERSION = "annual-ledger-1";
export type BcaIssue = {
  code: string;
  severity: "error" | "review";
  message: string;
  flowId?: string;
};
export type BcaLedgerRow = {
  flowId: string;
  label: string;
  side: "benefit" | "cost";
  category: string;
  year: number;
  noBuild: number;
  build: number;
  quantity: number;
  annualization: number;
  unitValue: number;
  priceFactor: number;
  value: number;
  rate: number;
  discountYears: number;
  presentValue: number;
};
export type BcaCalculation = ReturnType<typeof calculateBcaDocument>;

/** Calculate only complete streams. Partial sums stay visible but never become a headline ratio. */
export function calculateBcaDocument(input: BcaDocument) {
  const doc = bcaDocumentSchema.parse(input);
  const issues: BcaIssue[] = [];
  const rows: BcaLedgerRow[] = [];
  const add = (
    code: string,
    severity: BcaIssue["severity"],
    message: string,
    flowId?: string,
  ) => issues.push({ code, severity, message, ...(flowId ? { flowId } : {}) });
  if (!doc.noBuildDescription || !doc.alternative || !doc.geography)
    add(
      "scope",
      "review",
      "Describe the No Build case, Build alternative and analysis geography.",
    );
  if (!doc.applicability || !doc.methodology)
    add(
      "method",
      "review",
      "Record why this program edition and calculation method apply.",
    );
  if (
    !doc.flows.some(
      (flow) => flow.side === "cost" && flow.category === "capital",
    )
  )
    add(
      "capital",
      "error",
      "Add the full incremental capital cost, including all funding sources.",
    );
  if (!doc.flows.some((flow) => flow.side === "benefit"))
    add(
      "benefits",
      "error",
      "No monetized benefit stream is entered. Describe unmonetized benefits separately.",
    );
  if (
    !doc.flows.some((flow) => flow.category === "maintenance") &&
    !doc.exclusions.trim()
  )
    add(
      "maintenance",
      "review",
      "Enter incremental maintenance costs or explain their exclusion.",
    );
  const profile = getBcaProfile(doc.programId);
  if (!profile)
    add(
      "profile",
      "review",
      "This program profile is not recognized. Verify the retained method.",
    );
  if (
    profile &&
    profile.id !== "custom" &&
    (doc.priceYear !== profile.priceYear ||
      doc.discountRatePct !== profile.discountRatePct ||
      doc.programVersion !== profile.version ||
      doc.costConvention !== profile.costConvention)
  )
    add(
      "profile-deviation",
      "review",
      "Settings differ from the selected program edition. Record the authority for each difference before use.",
    );
  if (
    profile?.costConvention === "capital-only" &&
    doc.endYear - doc.openingYear + 1 > 30
  )
    add(
      "horizon",
      "review",
      "More than 30 operating years exceeds the USDOT recommendation. Document useful life, replacement costs and the authority for a longer period.",
    );
  const evidence = new Map(doc.evidence.map((source) => [source.id, source]));
  const groups = new Map<string, string[]>();
  for (const flow of doc.flows) {
    const name = flow.label || flow.id;
    const preset = USDOT_PARAMETERS.find(
      (parameter) => flow.parameterSourceId === `usdot-2026-${parameter.id}`,
    );
    if (preset && flow.unit !== preset.unit)
      add(
        "parameter-unit",
        "error",
        `${name}: the cited USDOT value is per ${preset.unit}, not per ${flow.unit}. Convert the physical quantity with evidence or select a matching value.`,
        flow.id,
      );
    if (
      preset &&
      (flow.unitValue !== preset.value ||
        flow.priceYear !== 2024 ||
        flow.realValueGrowthPct !== 0 ||
        flow.annualOverrides.some((row) => row.unitValue !== preset.value))
    )
      add(
        "parameter-departure",
        "review",
        `${name}: the entered valuation differs from the linked USDOT preset. Record the replacement source and rationale.`,
        flow.id,
      );

    if (flow.overlapGroup)
      groups.set(flow.overlapGroup, [
        ...(groups.get(flow.overlapGroup) ?? []),
        flow.id,
      ]);
    if (!flow.label || !flow.rationale)
      add(
        "rationale",
        "review",
        `${name}: explain the project change and calculation.`,
        flow.id,
      );
    const sourceIds = [
      ...flow.sourceIds,
      flow.parameterSourceId,
      ...(flow.priceYear !== doc.priceYear ? [flow.conversionSourceId] : []),
    ];
    if (!flow.sourceIds.length || !flow.parameterSourceId)
      add(
        "source-missing",
        "review",
        `${name}: link quantity evidence and a monetization source.`,
        flow.id,
      );
    for (const sourceId of new Set(sourceIds)) {
      const source = sourceId ? evidence.get(sourceId) : undefined;
      if (!source) {
        add(
          "source-link",
          "review",
          `${name}: a required source is absent.`,
          flow.id,
        );
        continue;
      }
      if (
        source.status !== "documented" ||
        !source.reference ||
        !source.locator ||
        !source.method
      )
        add(
          "source-quality",
          "review",
          `${name}: ${source.title || source.id} is ${source.status} or lacks a reference, locator or method.`,
          flow.id,
        );
      if (source.status === "model-screening")
        add(
          "model-use",
          "review",
          `${name}: screening model results do not establish a validated grant forecast. Retain the model's geography, year, network and use restrictions.`,
          flow.id,
        );
    }
    if (
      flow.priceYear !== doc.priceYear &&
      (!flow.conversionSourceId || flow.priceFactor === null)
    )
      add(
        "price-year",
        "error",
        `${name}: provide a sourced conversion from ${flow.priceYear} to ${doc.priceYear} constant dollars.`,
        flow.id,
      );
    if (flow.priceYear === doc.priceYear && flow.priceFactor !== 1)
      add(
        "price-factor",
        "error",
        `${name}: the same dollar year requires a conversion factor of 1.`,
        flow.id,
      );
    if (
      flow.unit === "dollar" &&
      (flow.unitValue !== 1 ||
        flow.annualOverrides.some((row) => row.unitValue !== 1))
    )
      add(
        "dollar-unit",
        "error",
        `${name}: dollar quantities require a unit value of 1.`,
        flow.id,
      );
    if (flow.side === "benefit" && flow.startYear < doc.openingYear)
      add(
        "early-benefit",
        "review",
        `${name}: benefits begin before opening. Document any phased operation.`,
        flow.id,
      );
    if (
      flow.category === "residual" &&
      (flow.side !== "benefit" || flow.benefitDirection !== "increase")
    )
      add(
        "residual-direction",
        "error",
        `${name}: residual value must be an increase in benefits (Build minus No Build).`,
        flow.id,
      );
    if (flow.category === "residual" && flow.startYear !== doc.endYear)
      add(
        "residual-timing",
        "error",
        `${name}: residual value belongs in the final analysis year.`,
        flow.id,
      );
    if (
      flow.discountRatePct !== null &&
      flow.discountRatePct !== doc.discountRatePct
    )
      add(
        "separate-rate",
        "review",
        `${name}: document the authority for a different discount rate.`,
        flow.id,
      );
    const flowRows: BcaLedgerRow[] = [];
    for (let year = flow.startYear; year <= flow.endYear; year++) {
      const override = flow.annualOverrides.find((row) => row.year === year);
      const noBuild = override ? override.noBuild : flow.noBuild;
      const build = override ? override.build : flow.build;
      const unitValue = override ? override.unitValue : flow.unitValue;
      if (
        noBuild === null ||
        build === null ||
        unitValue === null ||
        flow.annualization === null ||
        flow.priceFactor === null
      ) {
        add(
          "missing-number",
          "error",
          `${name}: ${year} lacks No Build, Build, annualization, unit value or dollar conversion. Blank is not zero.`,
          flow.id,
        );
        break;
      }
      const elapsed = year - flow.startYear;
      const quantityFactor = override
        ? 1
        : (1 + flow.quantityGrowthPct / 100) ** elapsed;
      const valueFactor = override
        ? 1
        : (1 + flow.realValueGrowthPct / 100) ** elapsed;
      const quantity =
        (flow.side === "benefit" && flow.benefitDirection === "reduction"
          ? noBuild - build
          : build - noBuild) * quantityFactor;
      const adjustedUnitValue = unitValue * valueFactor;
      const value =
        quantity * flow.annualization * adjustedUnitValue * flow.priceFactor;
      const rate = flow.discountRatePct ?? doc.discountRatePct;
      const pv = presentValue(value, rate, year - doc.discountYear);
      if (!Number.isFinite(pv) || Math.abs(pv) > 1e18) {
        add(
          "overflow",
          "error",
          `${name}: annual value exceeds the calculation range.`,
          flow.id,
        );
        break;
      }
      flowRows.push({
        flowId: flow.id,
        label: name,
        side: flow.side,
        category: flow.category,
        year,
        noBuild: noBuild * quantityFactor,
        build: build * quantityFactor,
        quantity,
        annualization: flow.annualization,
        unitValue: adjustedUnitValue,
        priceFactor: flow.priceFactor,
        value,
        rate,
        discountYears: year - doc.discountYear,
        presentValue: pv,
      });
    }
    if (
      !issues.some(
        (issue) => issue.flowId === flow.id && issue.severity === "error",
      )
    )
      rows.push(...flowRows);
  }
  for (const [group, ids] of groups)
    if (
      ids.length > 1 &&
      ids.some(
        (id) => !doc.flows.find((flow) => flow.id === id)?.overlapResolution,
      )
    )
      add(
        "overlap",
        "review",
        `Review overlapping streams in ${group}. Explain why their benefits are additive or remove duplication.`,
      );
  // Economic signs and BCR placement are separate. Federal guidance puts net
  // O&M and residual in the numerator; only upfront capital stays below the line.
  const ratioRows = rows.map((row) => ({
    ...row,
    ratioSide:
      doc.costConvention === "capital-only" &&
      row.side === "cost" &&
      row.category !== "capital"
        ? ("benefit" as const)
        : row.side,
    ratioValue:
      doc.costConvention === "capital-only" &&
      row.side === "cost" &&
      row.category !== "capital"
        ? -row.presentValue
        : row.presentValue,
  }));
  const benefits = ratioRows
    .filter((row) => row.ratioSide === "benefit")
    .reduce((sum, row) => sum + row.ratioValue, 0);
  const costs = ratioRows
    .filter((row) => row.ratioSide === "cost")
    .reduce((sum, row) => sum + row.ratioValue, 0);
  if (costs <= 0)
    add(
      "nonpositive-cost",
      "error",
      "Discounted incremental costs must exceed zero to calculate a benefit-cost ratio.",
    );
  const complete = !issues.some((issue) => issue.severity === "error");
  const annual = Array.from(
    { length: doc.endYear - doc.startYear + 1 },
    (_, i) => {
      const year = doc.startYear + i;
      const selected = rows.filter((row) => row.year === year);
      const benefits = selected
        .filter((row) => row.side === "benefit")
        .reduce((s, r) => s + r.value, 0);
      const costs = selected
        .filter((row) => row.side === "cost")
        .reduce((s, r) => s + r.value, 0);
      const presentValueNet = selected.reduce(
        (s, r) => s + (r.side === "benefit" ? r.presentValue : -r.presentValue),
        0,
      );
      return { year, benefits, costs, net: benefits - costs, presentValueNet };
    },
  );
  return {
    engineVersion: WORKBENCH_ENGINE_VERSION,
    complete,
    issues,
    rows,
    ratioRows,
    annual,
    presentValueBenefits: benefits,
    presentValueCosts: costs,
    netPresentValue: complete ? benefits - costs : null,
    benefitCostRatio: complete ? benefits / costs : null,
    status: complete
      ? issues.length
        ? "review-required"
        : "calculated"
      : "incomplete",
  } as const;
}

/** Assumed stress cases are deterministic scenarios, not confidence intervals or success probabilities. */
export function calculateBcaSensitivity(doc: BcaDocument) {
  const base = calculateBcaDocument(doc);
  if (!base.complete)
    return { cases: [], drivers: [], breakEvenBenefitMultiplier: null };
  const s = doc.sensitivity;
  const cases: {label: string; benefits: number; costs: number; npv: number | null; bcr: number | null; issues: BcaIssue[]}[] = [
    { label: "Base case", b: 1, c: 1 },
    { label: "Lower benefits", b: 1 + s.benefitLowPct / 100, c: 1 },
    { label: "Higher benefits", b: 1 + s.benefitHighPct / 100, c: 1 },
    { label: "Lower costs", b: 1, c: 1 + s.costLowPct / 100 },
    { label: "Higher costs", b: 1, c: 1 + s.costHighPct / 100 },
    {
      label: "Lower benefits and higher costs",
      b: 1 + s.benefitLowPct / 100,
      c: 1 + s.costHighPct / 100,
    },
  ].map((item) => {
    // Scale positive benefits/costs only. Disbenefits and cost savings stay signed.
    const stressed = base.ratioRows.map((r) => ({
      side: r.ratioSide,
      value:
        r.ratioValue *
        (r.side === "benefit" && r.presentValue > 0
          ? item.b
          : r.side === "cost" && r.presentValue > 0
            ? item.c
            : 1),
    }));
    const benefits = stressed
      .filter((r) => r.side === "benefit")
      .reduce((sum, r) => sum + r.value, 0);
    const costs = stressed
      .filter((r) => r.side === "cost")
      .reduce((sum, r) => sum + r.value, 0);
    return {
      label: item.label,
      benefits,
      costs,
      npv: benefits - costs,
      bcr: costs > 0 ? benefits / costs : null,
      issues: [],
    };
  });
  const alternate = calculateBcaDocument({
    ...doc,
    discountRatePct: s.alternateDiscountRatePct,
  });
  cases.push({
    label: `${s.alternateDiscountRatePct}% discount rate`,
    benefits: alternate.presentValueBenefits,
    costs: alternate.presentValueCosts,
    npv: alternate.netPresentValue,
    bcr: alternate.benefitCostRatio,
    issues: alternate.issues.filter(issue => issue.severity === "error"),
  });
  const drivers = doc.flows
    .map((flow) => ({
      id: flow.id,
      label: flow.label,
      side: flow.side,
      presentValue: base.rows
        .filter((r) => r.flowId === flow.id)
        .reduce((s, r) => s + r.presentValue, 0),
    }))
    .sort((a, b) => Math.abs(b.presentValue) - Math.abs(a.presentValue));
  const positiveBenefits = base.ratioRows
    .filter((r) => r.side === "benefit" && r.ratioValue > 0)
    .reduce((s, r) => s + r.ratioValue, 0);
  const disbenefits = base.presentValueBenefits - positiveBenefits;
  return {
    cases,
    drivers,
    breakEvenBenefitMultiplier:
      positiveBenefits > 0
        ? (base.presentValueCosts - disbenefits) / positiveBenefits
        : null,
  };
}

/** Element ratios use only allocated streams. Never add or average their ratios. */
export function calculateBcaComponents(doc: BcaDocument) {
  const groups = [...new Set(doc.flows.map((flow) => flow.component))];
  return groups.map((component) => ({
    component,
    result: calculateBcaDocument({
      ...doc,
      flows: doc.flows.filter((flow) => flow.component === component),
    }),
  }));
}
