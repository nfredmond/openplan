import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TRANSIT_NO_FEED_REASON_LABELS } from "@/components/models/model-run-evidence-panel";

/**
 * EVERY REASON THE WORKER CAN EMIT MUST HAVE A SENTENCE, AND THE FALLBACK MAY
 * NOT MAKE A CLAIM ABOUT THE STUDY AREA.
 *
 * `transit_los.no_feed_reason` is a machine string produced in Python and
 * rendered in TypeScript. There is no shared type across that seam and no
 * compiler that spans it, so a reason added on one side and not the other is
 * invisible to both lanes' suites — which is exactly what happened. Measured
 * 2026-08-06: three reasons the worker emits had no label —
 * `selected_feed_stamp_version_unsupported`, `selected_feed_unavailable` and
 * `feed_publishes_frequencies_only`.
 *
 * That is not a cosmetic gap, because of what the panel says when it has no
 * label: it fell through to "No GTFS feed was applied to this study area", a
 * COVERAGE CLAIM. Both lanes' code goes to real trouble never to make that claim
 * for a selection failure — `plan_feed` refuses to report `no_local_feed`,
 * `build_mode_provenance` branches on the reason prefix, and the panel keeps
 * `discovery_found_no_covering_feed` separate from `feed_catalog_unavailable`
 * for precisely this reason. Three unlabelled outcomes walked straight through
 * all of it and printed the sentence anyway, underneath a VMT number.
 *
 * WHY THIS GUARD READS PYTHON SOURCE. The vocabulary's author is the worker; the
 * panel is the copy. Guarding the copy against a hand-written list would just be
 * a third place to forget. This derives the set from the AUTHOR — and it fails
 * closed: if it can find no reasons at all, it says so rather than passing.
 */
const REPO_ROOT = path.join(process.cwd(), "..");
const WORKER_DIR = path.join(REPO_ROOT, "workers", "aequilibrae_worker");
const WORKER_SOURCES = ["main.py", "gtfs_skim.py"].map((name) => path.join(WORKER_DIR, name));

/**
 * The machine reasons the worker writes, read out of its own source.
 *
 * Three spellings, because the worker uses three: an assignment to a
 * `no_feed_reason` name or dict key, a keyword argument, and the first
 * positional argument of `SelectedFeedError(...)` — which is the constructor's
 * documented `no_feed_reason` parameter.
 */
function workerNoFeedReasons(): Set<string> {
  const found = new Set<string>();
  for (const file of WORKER_SOURCES) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/no_feed_reason"?\]?\s*=\s*"([a-z_]+)"/g)) {
      found.add(match[1]);
    }
    for (const match of source.matchAll(/SelectedFeedError\(\s*"([a-z_]+)"/g)) {
      found.add(match[1]);
    }
    // `_STAMP_REFUSAL_REASONS` maps a stamp status to a reason; the values are
    // reasons the worker emits even though no assignment names them.
    const table = source.match(/_STAMP_REFUSAL_REASONS\s*=\s*\{([\s\S]*?)\}/);
    if (table) {
      for (const match of table[1].matchAll(/:\s*"([a-z_]+)"/g)) found.add(match[1]);
    }
  }
  return found;
}

describe("the transit no-feed reason vocabulary crosses the language seam intact", () => {
  it("finds the worker's own source, so a silent no-op cannot pass for coverage", () => {
    // The failure mode this guard is most likely to develop is finding nothing —
    // a moved file, a renamed worker directory — and then passing forever.
    for (const file of WORKER_SOURCES) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
    }
    const reasons = workerNoFeedReasons();
    expect(reasons.size).toBeGreaterThan(8);
    // Anchors: one from each of the three extraction spellings, so a broken
    // regex fails here instead of quietly shrinking the set it checks.
    expect(reasons).toContain("transit_skim_timed_out"); // plain assignment
    expect(reasons).toContain("selected_feed_checksum_mismatch"); // SelectedFeedError
    expect(reasons).toContain("selected_feed_unavailable"); // _STAMP_REFUSAL_REASONS
  });

  it("gives every reason the worker can emit a sentence a planner can act on", () => {
    const missing = [...workerNoFeedReasons()]
      .filter((reason) => !(reason in TRANSIT_NO_FEED_REASON_LABELS))
      .sort();

    expect(
      missing,
      `these reasons render as the generic fallback instead of their own sentence: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("keeps the fallback sentence off the study area", () => {
    // THE REASON THE GAP MATTERED. An unlabelled reason falls through to this
    // sentence, and it used to assert that no feed covered the study area —
    // which is a fact about the AREA, earned only when a feed was actually
    // looked for. A selection failure establishes nothing about the area.
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/models/model-run-evidence-panel.tsx"),
      "utf8"
    );
    expect(panel).toContain('"No GTFS feed was applied to this run."');
    expect(panel).not.toContain('"No GTFS feed was applied to this study area."');
  });

  it("never lets a selection failure be described as a coverage fact", () => {
    // Every `selected_feed_*` label describes THE FEED THE PLANNER CHOSE. None
    // may say anything about what does or does not serve the area — the honesty
    // rule of this whole lane, asserted over the strings rather than trusted.
    for (const [reason, label] of Object.entries(TRANSIT_NO_FEED_REASON_LABELS)) {
      if (!reason.startsWith("selected_feed_")) continue;
      expect(label.toLowerCase(), reason).not.toMatch(/no (published )?(gtfs )?feed covers/);
      expect(label.toLowerCase(), reason).not.toMatch(/no transit (service|demand) (here|in this)/);
    }

    // And the two genuine coverage answers stay distinguishable: a catalog that
    // ANSWERED and listed nothing is a coverage fact; a catalog nobody could
    // reach settles nothing. Collapsing them tells a planner their area has no
    // transit when only a download failed.
    expect(TRANSIT_NO_FEED_REASON_LABELS.discovery_found_no_covering_feed).toMatch(/covers this study area/);
    expect(TRANSIT_NO_FEED_REASON_LABELS.feed_catalog_unavailable).toMatch(/unknown/);
  });
});
