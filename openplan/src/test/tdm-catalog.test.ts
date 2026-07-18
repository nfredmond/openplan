import { describe, expect, it } from "vitest";

import {
  TDM_STRATEGY_CATALOG,
  getTdmStrategy,
  type TdmStrategyCategory,
} from "@/lib/tdm/catalog";

// Clean re-implementation (not a port) of transitscore-3d's
// `lib/tdmCalculations.ts` TDM_PROGRAMS catalog. Harvest defects
// deliberately fixed and pinned by these tests:
//   - `enabled: boolean` UI state baked into the catalog data — dropped;
//   - uncited "CARB guidelines" claims — replaced by honest per-strategy
//     sourceNotes stating the defaults come from general TDM literature and
//     were NOT verified against CAPCOA 2021 (no invented measure IDs);
//   - ev-charging presented as a VMT measure — kept for parity but marked
//     countsTowardVmt: false and its sourceNote flags it as an
//     emissions-side measure.
// (The additive-summing, site-context double-count, and silent 60% cap
// defects lived in the combiner and are pinned in tdm-engine.test.ts.)

const VALID_CATEGORIES: readonly TdmStrategyCategory[] = [
  "infrastructure",
  "pricing",
  "programs",
  "policy",
];

const EXPECTED_KEYS = [
  "bike-parking",
  "bike-share",
  "ev-charging",
  "car-share",
  "unbundled-parking",
  "transit-subsidy",
  "parking-cashout",
  "carpool-program",
  "telecommute",
  "guaranteed-ride",
  "flexible-hours",
  "reduced-parking",
  "transit-oriented",
  "complete-streets",
];

describe("TDM_STRATEGY_CATALOG", () => {
  it("contains exactly the 14 harvest strategies", () => {
    expect(TDM_STRATEGY_CATALOG).toHaveLength(14);
    expect(TDM_STRATEGY_CATALOG.map((strategy) => strategy.key)).toEqual(EXPECTED_KEYS);
  });

  it("has unique keys", () => {
    const keys = TDM_STRATEGY_CATALOG.map((strategy) => strategy.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every defaultVmtReductionPct in (0, 10]", () => {
    for (const strategy of TDM_STRATEGY_CATALOG) {
      expect(strategy.defaultVmtReductionPct).toBeGreaterThan(0);
      expect(strategy.defaultVmtReductionPct).toBeLessThanOrEqual(10);
    }
  });

  it("gives every strategy a non-empty sourceNote", () => {
    for (const strategy of TDM_STRATEGY_CATALOG) {
      expect(strategy.sourceNote.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses only valid categories", () => {
    for (const strategy of TDM_STRATEGY_CATALOG) {
      expect(VALID_CATEGORIES).toContain(strategy.category);
    }
  });

  it("does not bake UI selection state (enabled) into the data", () => {
    for (const strategy of TDM_STRATEGY_CATALOG) {
      expect("enabled" in strategy).toBe(false);
    }
  });

  it("flags ev-charging as an emissions-side measure, not a VMT measure", () => {
    const evCharging = getTdmStrategy("ev-charging");
    expect(evCharging).not.toBeNull();
    expect(evCharging?.defaultVmtReductionPct).toBe(1.0);
    expect(evCharging?.countsTowardVmt).toBe(false);
    expect(evCharging?.sourceNote).toMatch(/emissions-side/i);
    expect(evCharging?.sourceNote).toMatch(/negligible/i);
  });

  it("marks every strategy except ev-charging as counting toward VMT", () => {
    for (const strategy of TDM_STRATEGY_CATALOG) {
      expect(strategy.countsTowardVmt).toBe(strategy.key !== "ev-charging");
    }
    expect(
      TDM_STRATEGY_CATALOG.filter((strategy) => strategy.countsTowardVmt)
    ).toHaveLength(13);
  });
});

describe("getTdmStrategy", () => {
  it("returns the full entry for a known key", () => {
    const transitSubsidy = getTdmStrategy("transit-subsidy");
    expect(transitSubsidy).toEqual({
      key: "transit-subsidy",
      name: "Transit Pass Subsidy",
      description: "Free or subsidized transit passes for residents",
      category: "pricing",
      defaultVmtReductionPct: 6.5,
      countsTowardVmt: true,
      sourceNote:
        "Screening default informed by general TDM literature; not verified against CAPCOA's Handbook for Analyzing GHG Mitigation Measures (2021) — confirm the measure-specific value before CEQA or grant use.",
    });
  });

  it("returns null for an unknown key", () => {
    expect(getTdmStrategy("hyperloop-stop")).toBeNull();
    expect(getTdmStrategy("")).toBeNull();
  });
});
