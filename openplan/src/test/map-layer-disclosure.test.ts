import { describe, expect, it } from "vitest";
import {
  buildMapLayerDisclosure,
  describeMapLayerCoverage,
  describeMapLayerFailure,
  MAP_FEATURE_LAYER_LIMIT,
  type MapLayerKey,
} from "@/lib/cartographic/layer-disclosure";

/**
 * Six `/api/map-features/*` routes carried an identical `TODO(pagination)` and
 * a bare `.limit(500)`. The cap was silent, so a workspace with 600 projects
 * saw 500 dots and nothing saying 100 were missing — the viewer's honest
 * conclusion ("this is everything") was wrong and nothing contradicted it.
 */

const ALL_KEYS: MapLayerKey[] = ["projects", "rtp", "corridors", "engagement", "aerial", "equity"];

describe("buildMapLayerDisclosure", () => {
  it("is not truncated when everything matched was fetched", () => {
    const d = buildMapLayerDisclosure({ returnedCount: 12, droppedCount: 0, matchedCount: 12 });
    expect(d).toEqual({
      returnedCount: 12,
      matchedCount: 12,
      droppedCount: 0,
      truncated: false,
      limit: MAP_FEATURE_LAYER_LIMIT,
    });
  });

  it("is truncated when the cap cut the result short", () => {
    const d = buildMapLayerDisclosure({ returnedCount: 500, droppedCount: 0, matchedCount: 640 });
    expect(d.truncated).toBe(true);
    expect(d.matchedCount).toBe(640);
  });

  /**
   * A dropped row was fetched. Counting it against the cap is what stops a page
   * of undrawable rows from reading as a truncated layer.
   */
  it("counts dropped rows as fetched, not as missing", () => {
    const d = buildMapLayerDisclosure({ returnedCount: 17, droppedCount: 3, matchedCount: 20 });
    expect(d.truncated).toBe(false);
    expect(d.droppedCount).toBe(3);
  });

  it("falls back to what it fetched when PostgREST returned no count", () => {
    for (const matchedCount of [null, undefined, Number.NaN]) {
      const d = buildMapLayerDisclosure({ returnedCount: 4, droppedCount: 1, matchedCount });
      expect(d.matchedCount).toBe(5);
      expect(d.truncated).toBe(false);
    }
  });
});

describe("describeMapLayerCoverage", () => {
  it("says nothing about a complete layer", () => {
    expect(
      describeMapLayerCoverage(
        "projects",
        buildMapLayerDisclosure({ returnedCount: 12, droppedCount: 0, matchedCount: 12 })
      )
    ).toEqual([]);
  });

  it("names the numbers and what the omission does not mean", () => {
    const [note] = describeMapLayerCoverage(
      "projects",
      buildMapLayerDisclosure({ returnedCount: 500, droppedCount: 0, matchedCount: 1240 })
    );
    expect(note).toContain("showing 500 of 1,240");
    expect(note).toContain("not a finding that they do not exist");
  });

  it("reports undrawable rows on a layer that is NOT truncated", () => {
    const notes = describeMapLayerCoverage(
      "engagement",
      buildMapLayerDisclosure({ returnedCount: 8, droppedCount: 2, matchedCount: 10 })
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("2 engagement pins could not be drawn");
    expect(notes[0]).toContain("missing from the map rather than absent from the record");
  });

  it("reports truncation AND drops as separate sentences", () => {
    const notes = describeMapLayerCoverage(
      "corridors",
      buildMapLayerDisclosure({ returnedCount: 495, droppedCount: 5, matchedCount: 900 })
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("showing 495 of 900");
    expect(notes[1]).toContain("could not be drawn");
  });

  it("uses the singular for exactly one dropped row", () => {
    const notes = describeMapLayerCoverage(
      "aerial",
      buildMapLayerDisclosure({ returnedCount: 3, droppedCount: 1, matchedCount: 4 })
    );
    expect(notes[0]).toContain("1 aerial mission could not be drawn");
    expect(notes[0]).toContain("it is missing");
  });

  it("has copy for every layer key", () => {
    for (const key of ALL_KEYS) {
      const notes = describeMapLayerCoverage(
        key,
        buildMapLayerDisclosure({ returnedCount: 500, droppedCount: 1, matchedCount: 900 })
      );
      expect(notes).toHaveLength(2);
      for (const note of notes) {
        expect(note.length).toBeGreaterThan(20);
        expect(note).not.toContain("undefined");
      }
    }
  });
});

describe("describeMapLayerFailure", () => {
  it("distinguishes a failed layer from an empty one, for every key", () => {
    for (const key of ALL_KEYS) {
      const note = describeMapLayerFailure(key);
      expect(note).toContain("could not be loaded");
      // The house formula: never let an outage read as a fact about the place.
      expect(note).toContain("not a finding that there are none here");
      expect(note).not.toContain("undefined");
    }
  });
});
