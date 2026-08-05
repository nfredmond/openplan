import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE } from "@/lib/invoicing/profiles/us-federal-generic";

/**
 * Claim boundaries for the two nationwide US registry artifacts: the federal-aid
 * stage-gate template and the generic reimbursement profile.
 *
 * THE RULE THESE ENFORCE: descriptor copy cites the CFR section and never
 * restates its figure. The single-audit threshold (2 CFR 200.501) and the de
 * minimis indirect rate (2 CFR 200.414(f)) both CHANGED in the 2024 Uniform
 * Guidance revision — a dollar amount or percentage baked into copy would have
 * gone stale silently, while the citation stays correct across amendments. So
 * a `$` figure or a `%` figure appearing anywhere in either artifact fails the
 * build, and the required citations must stay present.
 *
 * (Grant BUNDLE entries are a different surface with an established
 * match-percentage voice; this guard covers the TEMPLATE and PROFILE artifacts
 * only.)
 */

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "src/lib/stage-gates/templates/us_federal_aid_stage_gates_v0.1.json"
);

const DOLLAR_FIGURE = /\$\s?\d/;
const PERCENT_FIGURE = /\d+(\.\d+)?\s*%/;

describe("US federal-aid stage-gate template claims", () => {
  const templateSource = readFileSync(TEMPLATE_PATH, "utf8");
  const template = JSON.parse(templateSource) as {
    scope_notes?: string[];
  };

  it("cites the governing CFR sections", () => {
    for (const citation of [
      "2 CFR 200.501", // single-audit threshold (figure lives in the CFR, not here)
      "23 CFR 630", // no reimbursement for pre-authorization costs
      "49 CFR 24", // Uniform Act relocation/acquisition
      "2 CFR 200.334", // records retention
      "2 CFR 200.317", // procurement standards
    ]) {
      expect(templateSource, `template must cite ${citation}`).toContain(citation);
    }
  });

  it("carries no dollar figure and no percent figure anywhere in the artifact", () => {
    expect(templateSource).not.toMatch(DOLLAR_FIGURE);
    expect(templateSource).not.toMatch(PERCENT_FIGURE);
  });

  it("discloses its three scope limits: the state-manual overlay, FTA, and NEPA-only", () => {
    const scopeNotes = template.scope_notes ?? [];
    expect(scopeNotes.length).toBeGreaterThanOrEqual(3);

    const joined = scopeNotes.join(" ");
    // A state DOT's local-agency manual implements and extends these steps.
    expect(joined).toContain("state DOT");
    // FTA-funded transit follows different mechanics.
    expect(joined).toContain("FTA");
    // The template carries NEPA only; CEQA/SEPA are jurisdiction overlays.
    expect(joined).toContain("NEPA");
  });
});

describe("US federal-generic reimbursement profile claims", () => {
  const profile = US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE;

  /** Every human-readable string the descriptor carries, in one list. */
  const copyStrings: string[] = [
    profile.profileName,
    profile.jurisdiction.label,
    ...profile.postureOptions.flatMap((posture) => [
      posture.label,
      // `description` is optional on the posture type; every posture on THIS
      // profile must carry one, or its copy is not being checked at all.
      ...(posture.description ? [posture.description] : []),
    ]),
    ...(profile.framingNote ? [profile.framingNote] : []),
    ...(profile.documentationChecklist ?? []).flatMap((item) => [item.label, item.guidance]),
  ];
  const allCopy = copyStrings.join("\n");

  it("carries a description on every posture, so no posture's copy escapes this guard", () => {
    // `description` is optional on the type; the copy sweep above skips absent
    // ones, so an absent one here would be copy this guard never reads.
    for (const posture of profile.postureOptions) {
      expect(posture.description, `posture ${posture.postureId} has no description`).toBeTruthy();
    }
  });

  it("cites the governing CFR sections", () => {
    // De minimis indirect rate: cited, never restated as a percentage.
    expect(allCopy).toContain("2 CFR 200.414(f)");
    // Advance payments: acknowledged as agreement-dependent, cited.
    expect(allCopy).toContain("2 CFR 200.305");
  });

  it("carries no dollar figure and no percent figure in any copy string", () => {
    for (const copy of copyStrings) {
      expect(copy, `dollar figure in: ${copy}`).not.toMatch(DOLLAR_FIGURE);
      expect(copy, `percent figure in: ${copy}`).not.toMatch(PERCENT_FIGURE);
    }
  });

  it("frames itself as subordinate to the executed funding agreement", () => {
    expect(profile.framingNote).toBeDefined();
    expect(profile.framingNote).toContain("executed funding agreement controls");
    expect(profile.framingNote).toContain("the agreement wins");
  });

  it("offers exactly the agreed posture vocabulary, with progress invoicing as the default", () => {
    expect(profile.postureOptions.map((posture) => posture.postureId)).toEqual([
      "progress_invoicing",
      "final_only",
      "retention_in_effect",
      "deferred_agreement_terms",
    ]);
    expect(profile.defaultPostureId).toBe("progress_invoicing");
  });
});
