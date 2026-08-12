/**
 * Claim-boundary guard for crash and safety copy, wherever it lives.
 *
 * WHY THIS FILE EXISTS. The repo's honesty gates each scan live `src/`
 * surfaces for their own module's overclaims (the old docs-scanning
 * `sales-proof-claim-boundaries.test.ts` was deleted 2026-07-27 with the
 * dated sales docs it read). No general guard knows safety vocabulary — a
 * page asserting a "certified High-Injury Network" would ship green without
 * this file.
 *
 * So the Safety module scans its own source, in the style of
 * `public-page-claims-guardrails.test.ts`.
 *
 * The specific hazards this guards against:
 *   - screening output described as certified / official / adopted / approved;
 *   - crash coverage described as complete when ~22% of CCRS records are
 *     ungeocoded and therefore unmappable;
 *   - a KSI ("killed or seriously injured") figure, which the current source
 *     cannot produce because CCRS Crashes_* has no KABCO A column;
 *   - crash-reduction language that reads as a guarantee.
 *
 * WHY THE ROOTS ARE NOT JUST `safety/`. The claims are what this guard is for,
 * and the claims moved. The shared cartographic crash layer carries the same
 * severity vocabulary, the same KSI caveat and its own coverage sentences —
 * so a "certified High-Injury Network" or a KSI total can now be written in
 * `lib/cartographic/`, `api/map-features/crashes/` or `components/cartographic/`
 * without ever touching `safety/`. A firewall that does not cover where the
 * claims live is not a firewall. Scanning by CLAIM rather than by module also
 * means a directory rename cannot quietly move copy out from under the guard;
 * the "scans something" test below is what catches a root going stale.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_CRASH_DATA_NARRATIVE_CAVEAT,
  SAFETY_GEOCODING_CAVEAT,
  SAFETY_PDO_COMPARABILITY_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_NARRATIVE_CAVEAT,
  describeGeocodingShortfall,
  SAFETY_SCREENING_CAVEAT,
  SAFETY_SCREENING_NARRATIVE_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
} from "@/lib/safety/caveats";

const SAFETY_SOURCE_ROOTS = [
  "src/lib/safety",
  "src/components/safety",
  // The shared map's crash lane. It reuses the Safety caveats but writes its own
  // coverage sentences, so it can overclaim independently of the module above.
  "src/lib/cartographic",
  "src/app/api/map-features/crashes",
  "src/components/cartographic",
];

function collectSourceFiles(relativeRoot: string): string[] {
  const absolute = path.join(process.cwd(), relativeRoot);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    // A root that does not exist yet (components land in a later slice) is not
    // a failure — but the roots list must not silently go empty, which the
    // "scans something" test below enforces.
    return [];
  }

  return entries.flatMap((entry) => {
    const relative = path.join(relativeRoot, entry);
    const full = path.join(process.cwd(), relative);
    if (statSync(full).isDirectory()) return collectSourceFiles(relative);
    return /\.(?:ts|tsx)$/.test(entry) ? [relative] : [];
  });
}

const SAFETY_FILES = SAFETY_SOURCE_ROOTS.flatMap(collectSourceFiles);

const PROHIBITED_SAFETY_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "certified / official / adopted safety analysis or plan",
    pattern:
      /\b(?:certified|official|officially|adopted|approved|authoritative)\b[^.\n]{0,60}\b(?:safety (?:analysis|plan|study)|high[- ]injury network|action plan|hin)\b/i,
  },
  {
    label: "regulatory- or engineering-grade posture",
    pattern:
      /\b(?:engineering|regulatory|legal|compliance)[- ]grade\b[^.\n]{0,60}\b(?:safety|crash|analysis|screening|network)\b/i,
  },
  {
    label: "complete or exhaustive crash coverage",
    pattern:
      /\b(?:complete|comprehensive|exhaustive|every|all)\b[^.\n]{0,40}\b(?:crashes|crash records|collisions)\b/i,
  },
  {
    label: "killed-or-seriously-injured figure the current source cannot produce",
    pattern: /\b(?:ksi|killed or seriously injured|serious injur(?:y|ies))\b[^.\n]{0,40}\b(?:total|count|figure|number)\b/i,
  },
  {
    label: "guaranteed crash reduction",
    pattern:
      /\b(?:guarantee(?:d|s)?|ensure(?:s|d)?|promise(?:s|d)?|will (?:reduce|prevent|eliminate))\b[^.\n]{0,60}\b(?:crash(?:es)?|fatalit(?:y|ies)|injur(?:y|ies)|collisions?)\b/i,
  },
  {
    label: "grant award prediction from safety analysis",
    pattern: /\b(?:predicts?|guarantees?|assures?)\b[^.\n]{0,60}\b(?:ss4a|hsip|grant|award|funding)\b/i,
  },
];

const NEGATION =
  /\b(?:not|never|no|none|nothing|cannot|can't|won't|does not|do not|is not|are not|without|excludes?|excluded|refuses?|unreachable|rather than|instead of|may not|must not)\b/i;

/**
 * Split source into sentences, with comment prose unwrapped first.
 *
 * Sentence granularity is load-bearing: doc comments wrap, so a claim and the
 * "cannot"/"nothing" that negates it routinely land on different lines. A
 * line-based filter would report those as violations (it did), which would push
 * a maintainer toward weakening the patterns — the opposite of what this guard
 * is for.
 */
function toSentences(source: string): string[] {
  return source
    // Strip leading comment markers so wrapped prose rejoins into sentences.
    .replace(/^\s*(?:\/\/+|\/\*+|\*+\/?)\s?/gm, " ")
    .replace(/[ \t]*\r?\n[ \t]*/g, " ")
    .split(/(?<=[.;:])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Drop sentences that explicitly DENY a claim, so the caveats themselves —
 * which necessarily name the things they rule out — do not trip their own guard.
 */
function withoutNegatedClaims(source: string): string {
  return toSentences(source)
    .filter((sentence) => !NEGATION.test(sentence))
    .join("\n");
}

describe("safety and shared-map crash claim boundaries", () => {
  it("actually scans safety source files", () => {
    // Without this, an empty glob would make every assertion below vacuous.
    expect(SAFETY_FILES.length).toBeGreaterThan(0);
  });

  it("covers the shared map's crash lane, not only the Safety module", () => {
    // Named individually rather than counted: the crash claims live in these
    // three trees now, and a root silently dropping to zero files would leave
    // them unscanned while the count above still passed on `safety/` alone.
    for (const root of ["src/lib/cartographic", "src/app/api/map-features/crashes", "src/components/cartographic"]) {
      expect(
        SAFETY_FILES.filter((file) => file.startsWith(root)).length,
        `${root} contributed no files to the crash-claim scan`
      ).toBeGreaterThan(0);
    }
  });

  it.each(SAFETY_FILES)("keeps %s inside screening-grade safety claims", (file) => {
    const source = withoutNegatedClaims(readFileSync(path.join(process.cwd(), file), "utf8"));

    for (const { label, pattern } of PROHIBITED_SAFETY_CLAIMS) {
      expect(source, `${file} contains prohibited safety claim: ${label}`).not.toMatch(pattern);
    }
  });

  it("actually catches the overclaims it is meant to catch", () => {
    // A guard nobody can see fail is indistinguishable from no guard. These are
    // the exact phrasings this file exists to keep out of the Safety module.
    const overclaims: Array<[string, string]> = [
      ["certified / official / adopted safety analysis or plan", "Download the certified Safety Action Plan"],
      ["certified / official / adopted safety analysis or plan", "Your adopted High-Injury Network is ready"],
      ["regulatory- or engineering-grade posture", "An engineering-grade crash analysis for your corridor"],
      ["complete or exhaustive crash coverage", "Showing all crashes in the study area"],
      ["killed-or-seriously-injured figure the current source cannot produce", "KSI total for the corridor"],
      ["guaranteed crash reduction", "This countermeasure will reduce crashes by 30%"],
      ["grant award prediction from safety analysis", "This plan guarantees SS4A funding"],
    ];

    for (const [label, text] of overclaims) {
      const matcher = PROHIBITED_SAFETY_CLAIMS.find((claim) => claim.label === label);
      expect(matcher, `no matcher labelled ${label}`).toBeDefined();
      expect(withoutNegatedClaims(text), `"${text}" should trip: ${label}`).toMatch(matcher!.pattern);
    }
  });

  it("does not fire on the honest phrasings the module actually uses", () => {
    const honest = [
      "Screening-level safety analysis for internal prioritization and grant-readiness review.",
      "This source does not separate suspected serious injuries, so a KSI total cannot be derived from it.",
      "Reported crashes that the source agency did not geolocate do not appear on the map.",
      "Showing 916 of 1,180 reported crashes in view.",
    ];

    for (const text of honest) {
      const scanned = withoutNegatedClaims(text);
      for (const { label, pattern } of PROHIBITED_SAFETY_CLAIMS) {
        expect(scanned, `honest copy wrongly tripped ${label}: "${text}"`).not.toMatch(pattern);
      }
    }
  });

  it("states the screening boundary and refuses adopted-plan posture", () => {
    expect(SAFETY_SCREENING_CAVEAT).toMatch(/screening[- ]level/i);
    expect(SAFETY_SCREENING_CAVEAT).toMatch(/not an adopted safety plan/i);
    expect(SAFETY_SCREENING_CAVEAT).toMatch(/certified/i);
  });

  it("keeps a single-sentence narrative variant for every narrative caveat", () => {
    // Multi-sentence caveats leave their trailing sentences uncited and trip
    // the per-sentence grounding validator — the same reason
    // BCA_NARRATIVE_CAVEAT exists alongside BCA_SCREENING_CAVEAT.
    for (const caveat of [SAFETY_SCREENING_NARRATIVE_CAVEAT, SAFETY_CRASH_DATA_NARRATIVE_CAVEAT]) {
      const sentences = caveat.split(/(?<=\.)\s+/).filter(Boolean);
      expect(sentences).toHaveLength(1);
    }
  });

  it("discloses that crash data is reported-not-modeled but may be incomplete", () => {
    expect(SAFETY_CRASH_DATA_CAVEAT).toMatch(/reported collisions/i);
    expect(SAFETY_CRASH_DATA_CAVEAT).toMatch(/not modeled estimates/i);
    expect(SAFETY_CRASH_DATA_CAVEAT).toMatch(/incomplete|vary by source/i);
  });

  it("discloses that ungeocoded crashes cannot be mapped", () => {
    expect(SAFETY_GEOCODING_CAVEAT).toMatch(/coordinates/i);
    expect(SAFETY_GEOCODING_CAVEAT).toMatch(/do not appear on the map/i);
  });

  it("discloses that a KSI total cannot be derived from the current source", () => {
    expect(SAFETY_SEVERITY_COMPLETENESS_CAVEAT).toMatch(/serious injur/i);
    expect(SAFETY_SEVERITY_COMPLETENESS_CAVEAT).toMatch(/cannot be derived/i);
  });
});

/**
 * The two disclosures this lane added, and the constant it deliberately did NOT
 * add.
 */
describe("the claims the crash filters make on a planner's behalf", () => {
  it("refuses to let an unclassified collision read as a mild one", () => {
    // These records were stored as property-damage-only until the `unknown`
    // band existed, because a missing count parsed to zero. The sentence has to
    // say the classification is missing, not that the outcome was mild.
    expect(SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT).toMatch(/no casualty count/i);
    expect(SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT).toMatch(/counted in the total/i);
    expect(SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT).toMatch(/missing information, not a mild outcome/i);
  });

  it("keeps the unclassified narrative variant to one sentence", () => {
    const sentences = SAFETY_UNCLASSIFIED_SEVERITY_NARRATIVE_CAVEAT.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences).toHaveLength(1);
  });

  it("says why property-damage-only counts are not comparable", () => {
    expect(SAFETY_PDO_COMPARABILITY_CAVEAT).toMatch(/not comparable/i);
    expect(SAFETY_PDO_COMPARABILITY_CAVEAT).toMatch(/agencies|places|years/i);
  });

  it("quotes no fixed geocoding percentage anywhere in the shipped copy", () => {
    // THE DEFECT THIS PREVENTS. The geocoded share is wildly local: 77.7%
    // statewide and 99.6% in one rural county of the same state, probed the
    // same day. A constant would describe almost no real extract correctly, in
    // either direction, while sounding precise.
    for (const caveat of [
      SAFETY_CRASH_DATA_CAVEAT,
      SAFETY_GEOCODING_CAVEAT,
      SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
      SAFETY_PDO_COMPARABILITY_CAVEAT,
    ]) {
      expect(caveat).not.toMatch(/\d+(\.\d+)?\s?%/);
    }
  });

  it("computes the geocoding shortfall from the extract's own two counts", () => {
    expect(describeGeocodingShortfall(1180, 1089)).toMatch(/91 of the 1,180 reported crashes/);
    expect(describeGeocodingShortfall(1180, 1089)).toMatch(/92\.3% were mapped/);
    // A different extract, a different sentence — which is the whole point.
    expect(describeGeocodingShortfall(1180, 1175)).toMatch(/99\.6% were mapped/);
  });

  it("says nothing rather than inventing a share it cannot compute", () => {
    // A percentage from an unreadable denominator is a fabricated figure, and
    // a cheerful "100% mapped" on every clean acquisition trains a reader to
    // skip the disclosure that matters.
    expect(describeGeocodingShortfall(1180, 1180)).toBeNull();
    expect(describeGeocodingShortfall(0, 0)).toBeNull();
    expect(describeGeocodingShortfall(Number.NaN, 5)).toBeNull();
    // More mapped than reported is a broken row, not a 110% success rate.
    expect(describeGeocodingShortfall(10, 12)).toBeNull();
  });
});
