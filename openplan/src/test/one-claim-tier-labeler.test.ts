import { stripSourceComments } from "@/test/helpers/source-text";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODELING_CLAIM_STATUSES,
  modelingClaimStatusLabel,
} from "@/lib/models/evidence-backbone";

/**
 * ONE claim-tier labeler, and it lives beside the vocabulary it renders.
 *
 * WHAT WENT WRONG, AND WHY IT MATTERED. Three tier-label maps existed
 * independently: `claimStatusLabel` in planner-pack/vmt-screening-records,
 * `formatModelingClaimStatusLabel` in reports/modeling-evidence, and a
 * component-local copy in the county-run evidence panel. Two of them disagreed —
 * `claim_grade_passed` read "Claim-grade" in the planner-pack and the county-run
 * panel but "Claim-grade passed" in the report lane — so one run described its
 * own evidence strength differently depending on which surface a reviewer
 * opened. The claim tier is the product's honesty firewall; it is the last thing
 * in the repo that may drift by module.
 *
 * The county-run copy also defaulted an unmatched value to "Unknown", which was
 * BOTH less honest than the absence it stood for and unreachable — the tier is a
 * non-null four-value enum there, so the branch read as a safety net while
 * catching nothing.
 *
 * WHAT THIS GUARD LOOKS FOR, and why not the obvious thing. Scanning for the
 * label STRINGS alone produces false positives: an unrelated volumes-fallback
 * response carries a free-text caveat list containing "Screening-grade" that has
 * nothing to do with rendering a tier. So the detector targets the SHAPE of the
 * defect instead — a file that both names two or more claim-tier IDENTIFIERS and
 * emits one of the canonical LABELS is mapping tiers to human words, which is
 * the job that now belongs to exactly one function.
 *
 * Comments are stripped before scanning, so a file may freely EXPLAIN the labels
 * (this one does). Only code counts.
 */

const SRC = path.join(process.cwd(), "src");
const CANONICAL = path.join(SRC, "lib", "models", "evidence-backbone.ts");

/** Every human label the canonical labeler can produce, including the absence. */
const CANONICAL_LABELS = [
  ...MODELING_CLAIM_STATUSES.map((status) => modelingClaimStatusLabel(status)),
  modelingClaimStatusLabel(null),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests may name labels freely — they assert on them.
      return entry === "test" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Remove block comments and whole-line comments. Deliberately simple: it does
 * not try to parse strings containing "//", which is why it only strips lines
 * that are ENTIRELY a comment rather than trailing text after code.
 */
const stripComments = stripSourceComments;

/** True when a file both names tier identifiers and emits canonical labels. */
function looksLikeATierLabelMap(source: string): boolean {
  const code = stripComments(source);
  const identifiers = MODELING_CLAIM_STATUSES.filter((status) => code.includes(`"${status}"`));
  const labels = CANONICAL_LABELS.filter((label) => code.includes(`"${label}"`));
  return identifiers.length >= 2 && labels.length >= 1;
}

describe("exactly one claim-tier labeler", () => {
  it("finds no second tier-label map anywhere in src", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== CANONICAL)
      .filter((file) => looksLikeATierLabelMap(readFileSync(file, "utf8")))
      .map((file) => path.relative(process.cwd(), file));

    expect(
      offenders,
      "these files map claim tiers to human labels — import modelingClaimStatusLabel from @/lib/models/evidence-backbone instead"
    ).toEqual([]);
  });

  /**
   * The assertion above passes trivially if the detector cannot detect anything.
   * The canonical file IS a tier-label map, so it must trip the same detector —
   * this is what proves the scan works rather than merely finding nothing.
   */
  it("guards the guard — the detector fires on the canonical labeler itself", () => {
    expect(looksLikeATierLabelMap(readFileSync(CANONICAL, "utf8"))).toBe(true);
  });

  it("guards the guard — the scan reaches a populated tree and excludes tests", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(200);
    expect(files.every((file) => !file.includes(`${path.sep}test${path.sep}`))).toBe(true);
  });

  /**
   * Both halves of the detector must be load-bearing. A file that only names the
   * identifiers (a tone map, a zod enum, a switch on behaviour) is not a label
   * map and must not be flagged; a file that only quotes one label (a free-text
   * caveat list) is not either.
   */
  it("guards the guard — identifiers alone and labels alone are both innocent", () => {
    const identifiersOnly = `const tone = { "claim_grade_passed": "success", "screening_grade": "warning" };`;
    const labelOnly = `const caveats = ["Uncalibrated", "Screening-grade"];`;
    const both = `switch (s) { case "claim_grade_passed": return "Claim-grade passed"; case "screening_grade": return "Screening-grade"; }`;

    expect(looksLikeATierLabelMap(identifiersOnly)).toBe(false);
    expect(looksLikeATierLabelMap(labelOnly)).toBe(false);
    expect(looksLikeATierLabelMap(both)).toBe(true);
  });

  it("renders the absent tier as a known absence, never as uncertainty", () => {
    expect(modelingClaimStatusLabel(null)).toBe("Claim tier not recorded");
    expect(modelingClaimStatusLabel(undefined)).toBe("Claim tier not recorded");
    // "Unknown" was the county-run panel's wording. A null tier is a fact
    // OpenPlan knows exactly — no decision was recorded — not something it
    // failed to determine.
    expect(modelingClaimStatusLabel(null)).not.toBe("Unknown");
  });

  it("labels every tier in the vocabulary, so a new tier cannot ship unlabelled", () => {
    for (const status of MODELING_CLAIM_STATUSES) {
      const label = modelingClaimStatusLabel(status);
      expect(label, `${status} has no label`).toBeTruthy();
      expect(label, `${status} fell through to the absence label`).not.toBe(
        modelingClaimStatusLabel(null)
      );
    }
  });
});
