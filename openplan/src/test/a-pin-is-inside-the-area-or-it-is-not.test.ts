import { describe, expect, it } from "vitest";
import {
  bboxContainsPoint,
  evaluateGeofence,
  evaluateGeofenceForAll,
  geofenceInviteSentence,
  geofenceRefusalMessage,
  geofenceUpdateRefusal,
  parseGeofenceBoundary,
  placeCanGeofence,
} from "@/lib/engagement/geofence";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import { resolveMapPointQuestionView } from "@/lib/engagement/survey";

/**
 * The geometry, on its own, with no route and no database around it.
 *
 * Every case here is one a real consultation produces: a pin in the wrong
 * hemisphere, a pin exactly on the boundary line, a pin in the hole of a
 * doughnut-shaped area, a comment with no pin at all, an area that crosses the
 * antimeridian, and a boundary this code cannot read. The verdicts are asserted
 * WITH their basis, because "outside by the bounding box" and "outside by the
 * boundary" are different strengths of answer and the route treats them
 * differently.
 *
 * The coordinates below are arbitrary arithmetic — squares on round numbers —
 * chosen precisely so no place, county or agency is baked into a test.
 */

/** A unit square from (0,0) to (2,2), as GeoJSON orders it. */
const square = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

const squareBbox = { minLon: 0, minLat: 0, maxLon: 2, maxLat: 2 };

describe("a coordinate is inside a campaign's area, or it is not", () => {
  it("accepts a pin inside the boundary and says the boundary is what decided it", () => {
    expect(evaluateGeofence({ bbox: squareBbox, geometry: square }, { latitude: 1, longitude: 1 })).toEqual({
      state: "inside",
      basis: "boundary",
      boundaryUnreadable: false,
    });
  });

  it("refuses a pin in another hemisphere on the bounding box alone, without walking the polygon", () => {
    const verdict = evaluateGeofence(
      { bbox: squareBbox, geometry: square },
      { latitude: -33.9, longitude: 151.2 }
    );
    expect(verdict).toEqual({ state: "outside", basis: "bbox", boundaryUnreadable: false });
  });

  it("refuses a pin inside the bounding box but outside the shape it contains", () => {
    // An L-shaped area: the bbox is the whole 2×2 square, the shape is not.
    const lShape = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };

    // The missing quadrant. Inside the box, outside the L.
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: lShape }, { latitude: 1.5, longitude: 1.5 })
    ).toEqual({ state: "outside", basis: "boundary", boundaryUnreadable: false });

    // And the arm of the L is still inside, so the shape is not being ignored.
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: lShape }, { latitude: 0.5, longitude: 1.5 }).state
    ).toBe("inside");
  });

  /**
   * A resident standing on the edge of the study area is in it. Ray casting on
   * its own answers this arbitrarily — it depends which side of a vertex the ray
   * grazes — so the on-segment test has to run first, and these are the cases
   * that catch it being removed.
   */
  it("counts a pin exactly on the boundary as inside — on an edge, and on a corner", () => {
    for (const point of [
      { latitude: 1, longitude: 0 }, // west edge
      { latitude: 2, longitude: 1 }, // north edge
      { latitude: 0, longitude: 0 }, // corner, and a ring vertex
      { latitude: 2, longitude: 2 }, // opposite corner
    ]) {
      expect(evaluateGeofence({ bbox: squareBbox, geometry: square }, point), JSON.stringify(point)).toEqual({
        state: "inside",
        basis: "boundary",
        boundaryUnreadable: false,
      });
    }
  });

  it("counts a pin on the bounding box edge as inside when only a box is on record", () => {
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: null }, { latitude: 0, longitude: 2 })
    ).toEqual({ state: "inside", basis: "bbox", boundaryUnreadable: false });
  });

  it("treats the inside of a hole as outside, and the hole's own edge as inside", () => {
    const doughnut = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    const place = { bbox: { minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 }, geometry: doughnut };

    expect(evaluateGeofence(place, { latitude: 5, longitude: 5 }).state).toBe("outside");
    expect(evaluateGeofence(place, { latitude: 2, longitude: 2 }).state).toBe("inside");
    // The rim of the hole is the boundary, and a boundary belongs to what it bounds.
    expect(evaluateGeofence(place, { latitude: 5, longitude: 4 }).state).toBe("inside");
  });

  it("accepts a pin in any part of a multi-part area", () => {
    const twoIslands = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 6],
            [5, 5],
          ],
        ],
      ],
    };
    const place = { bbox: { minLon: 0, minLat: 0, maxLon: 6, maxLat: 6 }, geometry: twoIslands };

    expect(evaluateGeofence(place, { latitude: 0.5, longitude: 0.5 }).state).toBe("inside");
    expect(evaluateGeofence(place, { latitude: 5.5, longitude: 5.5 }).state).toBe("inside");
    // Between the two islands: inside the bbox, in neither polygon.
    expect(evaluateGeofence(place, { latitude: 3, longitude: 3 })).toEqual({
      state: "outside",
      basis: "boundary",
      boundaryUnreadable: false,
    });
  });
});

/**
 * The product is meant to reach worldwide, and 20260729000003 deliberately
 * permits `place_min_lon > place_max_lon` so an area spanning the date line can
 * be recorded at all. Both tests here have to survive it — a hemisphere baked
 * into either one would refuse every resident of the place it is baked against.
 */
describe("an area that crosses the antimeridian still has an inside", () => {
  const wrappingBbox = { minLon: 179, minLat: -1, maxLon: -179, maxLat: 1 };
  const wrappingShape = {
    type: "Polygon",
    coordinates: [
      [
        [179.5, -0.5],
        [-179.5, -0.5],
        [-179.5, 0.5],
        [179.5, 0.5],
        [179.5, -0.5],
      ],
    ],
  };

  it("does not treat a wrapping bounding box as an empty interval", () => {
    expect(bboxContainsPoint(wrappingBbox, 179.5, 0)).toBe(true);
    expect(bboxContainsPoint(wrappingBbox, -179.5, 0)).toBe(true);
    expect(bboxContainsPoint(wrappingBbox, 180, 0)).toBe(true);
    // The far side of the planet is not inside a two-degree box.
    expect(bboxContainsPoint(wrappingBbox, 0, 0)).toBe(false);
    expect(bboxContainsPoint(wrappingBbox, -170, 0)).toBe(false);
  });

  it("puts a pin on either side of the date line inside the shape that spans it", () => {
    const place = { bbox: wrappingBbox, geometry: wrappingShape };

    expect(evaluateGeofence(place, { latitude: 0, longitude: 179.9 })).toEqual({
      state: "inside",
      basis: "boundary",
      boundaryUnreadable: false,
    });
    expect(evaluateGeofence(place, { latitude: 0, longitude: -179.9 })).toEqual({
      state: "inside",
      basis: "boundary",
      boundaryUnreadable: false,
    });
    expect(evaluateGeofence(place, { latitude: 0, longitude: 0 }).state).toBe("outside");
  });

  it("keeps an ordinary western-hemisphere box working, which is the case a wrap fix can break", () => {
    const bbox = { minLon: -83.2, minLat: 39.85, maxLon: -82.8, maxLat: 40.1 };
    expect(bboxContainsPoint(bbox, -83, 40)).toBe(true);
    expect(bboxContainsPoint(bbox, -82.7, 40)).toBe(false);
    expect(bboxContainsPoint(bbox, 96.9, 40)).toBe(false); // the antipode, not the point
  });
});

describe("what is NOT a refusal", () => {
  it("does not check a submission that carries no coordinate", () => {
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: square }, { latitude: null, longitude: null })
    ).toEqual({ state: "not_checked", reason: "no_coordinate" });

    // Half a coordinate is no coordinate. Treating a lone latitude as a point
    // would put a pin on the prime meridian and refuse it there.
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: square }, { latitude: 1, longitude: null }).state
    ).toBe("not_checked");
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: square }, { latitude: Number.NaN, longitude: 1 })
        .state
    ).toBe("not_checked");
  });

  it("does not check anything when no area is on record", () => {
    expect(evaluateGeofence({ bbox: null, geometry: null }, { latitude: 1, longitude: 1 })).toEqual({
      state: "not_checked",
      reason: "no_area",
    });
  });

  it("falls back to the box, and SAYS so, when the boundary is a shape it cannot read", () => {
    const line = { type: "LineString", coordinates: [[0, 0], [2, 2]] };

    // A line has no interior. It is not silently treated as one.
    expect(parseGeofenceBoundary(line)).toBeNull();
    expect(evaluateGeofence({ bbox: squareBbox, geometry: line }, { latitude: 1, longitude: 1 })).toEqual({
      state: "inside",
      basis: "bbox",
      boundaryUnreadable: true,
    });

    // Outside the box is still final: the box contains the shape, whatever the
    // shape turned out to be.
    expect(
      evaluateGeofence({ bbox: squareBbox, geometry: line }, { latitude: 40, longitude: -83 })
    ).toEqual({ state: "outside", basis: "bbox", boundaryUnreadable: true });
  });

  it("reads a Polygon, a MultiPolygon and a Feature wrapping one — and nothing else", () => {
    expect(parseGeofenceBoundary(square)).not.toBeNull();
    expect(parseGeofenceBoundary({ type: "Feature", geometry: square })).not.toBeNull();
    expect(parseGeofenceBoundary({ type: "MultiPolygon", coordinates: [square.coordinates] })).not.toBeNull();

    expect(parseGeofenceBoundary(null)).toBeNull();
    expect(parseGeofenceBoundary({ type: "Point", coordinates: [1, 1] })).toBeNull();
    expect(parseGeofenceBoundary({ type: "GeometryCollection", geometries: [square] })).toBeNull();
    // A ring with a non-numeric vertex is not a ring with one fewer vertex.
    expect(
      parseGeofenceBoundary({ type: "Polygon", coordinates: [[[0, 0], ["x", 1], [1, 1], [0, 0]]] })
    ).toBeNull();
  });

  it("refuses to answer for a ring too wide to disambiguate, rather than guessing", () => {
    // Longitudes spanning more than half the planet describe two complementary
    // regions and nothing in the coordinates says which one is meant.
    const halfThePlanet = {
      type: "Polygon",
      coordinates: [
        [
          [-170, -10],
          [0, -10],
          [170, -10],
          [170, 10],
          [0, 10],
          [-170, 10],
          [-170, -10],
        ],
      ],
    };

    const verdict = evaluateGeofence(
      { bbox: { minLon: -170, minLat: -10, maxLon: 170, maxLat: 10 }, geometry: halfThePlanet },
      { latitude: 0, longitude: 0 }
    );
    expect(verdict).toEqual({ state: "inside", basis: "bbox", boundaryUnreadable: true });
  });
});

describe("the operator control cannot be offered a check that cannot run", () => {
  it("needs an extent, not merely a recorded place", () => {
    expect(placeCanGeofence({ bbox: squareBbox })).toBe(true);
    expect(placeCanGeofence({ bbox: null })).toBe(false);
    expect(placeCanGeofence(null)).toBe(false);
  });

  it("refuses turning the check on with no area, and clearing the area under a live check", () => {
    expect(geofenceUpdateRefusal({ enabled: true, hasArea: false, areaCleared: false })).toMatch(
      /no area on record/i
    );
    expect(geofenceUpdateRefusal({ enabled: true, hasArea: false, areaCleared: true })).toMatch(
      /clearing the area/i
    );

    // The two states that are fine: the check is off, or it has something to test.
    expect(geofenceUpdateRefusal({ enabled: false, hasArea: false, areaCleared: true })).toBeNull();
    expect(geofenceUpdateRefusal({ enabled: true, hasArea: true, areaCleared: false })).toBeNull();
  });
});

describe("what a participant is told", () => {
  it("names the real reason, offers the way through, and describes no geometry", () => {
    const message = geofenceRefusalMessage("Franklin County, Ohio");

    expect(message).toContain("Franklin County, Ohio");
    expect(message).toMatch(/outside/i);
    // The route that always works has to be in the sentence, or the refusal
    // silences someone who had something to say.
    expect(message).toMatch(/without a location/i);

    // Not a lie about the input, and not a scolding.
    expect(message).not.toMatch(/invalid/i);
    expect(message).not.toMatch(/error/i);
    // A refusal must not be an oracle for probing an agency's boundary.
    expect(message).not.toMatch(/-?\d+\.\d+/);
  });

  it("still says something true when the agency never named its area", () => {
    const message = geofenceRefusalMessage(null);
    expect(message).toMatch(/the area this consultation covers/i);
    expect(message).not.toMatch(/null|undefined/i);
  });

  it("warns before the pin is placed, not only after", () => {
    expect(geofenceInviteSentence("the Broad Street corridor")).toMatch(
      /has to be inside the Broad Street corridor/i
    );
    expect(geofenceInviteSentence(null)).toMatch(/the area this campaign covers/i);
    // Same promise as the refusal, made in advance.
    expect(geofenceInviteSentence(null)).toMatch(/without a location is accepted from anywhere/i);
    // And it promises the rule that is ENFORCED, which is about anything marked
    // on the map, not only a dropped point. A sentence naming only a "pin" would
    // understate a check that refuses a drawn line or area too.
    expect(geofenceInviteSentence(null)).not.toMatch(/\bA pin on this map\b/i);
  });
});

/**
 * A DRAWN SHAPE IS NOT ITS CENTROID.
 *
 * The portal's map is a geometry picker: a comment may carry a Point, a
 * LineString or a Polygon, and the row keeps only the vertex centroid. A check
 * that looked at the centroid alone would be one an adversary walks straight
 * through — a square drawn around the study area has its centroid dead inside
 * it — while the shape that is stored, drawn on the operator's map and clustered
 * by the hotspot screen is the one nobody tested.
 */
describe("every part of a drawn shape has to be inside, not just its middle", () => {
  const SQUARE = {
    bbox: { minLon: 0, minLat: 0, maxLon: 2, maxLat: 2 },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    },
  };

  it("refuses a shape drawn AROUND the area, whose centroid is inside it", () => {
    // The centroid of this ring is (1, 1) — the exact middle of the area — and
    // every one of its corners is thousands of kilometres away.
    const ring: Array<{ latitude: number; longitude: number }> = [
      { latitude: -60, longitude: -60 },
      { latitude: -60, longitude: 62 },
      { latitude: 62, longitude: 62 },
      { latitude: 62, longitude: -60 },
    ];

    expect(evaluateGeofence(SQUARE, { latitude: 1, longitude: 1 }).state).toBe("inside");
    expect(evaluateGeofenceForAll(SQUARE, ring).state).toBe("outside");
  });

  it("refuses a line with one end outside, and accepts one wholly inside", () => {
    expect(
      evaluateGeofenceForAll(SQUARE, [
        { latitude: 1, longitude: 1 },
        { latitude: 1, longitude: 40 },
      ]).state
    ).toBe("outside");

    expect(
      evaluateGeofenceForAll(SQUARE, [
        { latitude: 0.5, longitude: 0.5 },
        { latitude: 1.5, longitude: 1.5 },
      ]).state
    ).toBe("inside");
  });

  it("reports the shape on the basis of its LEAST certain vertex", () => {
    // One vertex answered from the bbox alone (no boundary loaded for it) must
    // not let the whole shape claim a boundary answer.
    const bboxOnly = { bbox: SQUARE.bbox, geometry: null };
    const verdict = evaluateGeofenceForAll(bboxOnly, [
      { latitude: 1, longitude: 1 },
      { latitude: 1.5, longitude: 1.5 },
    ]);
    expect(verdict).toEqual({ state: "inside", basis: "bbox", boundaryUnreadable: false });
  });

  it("checks nothing when nothing was marked", () => {
    expect(evaluateGeofenceForAll(SQUARE, [])).toEqual({
      state: "not_checked",
      reason: "no_coordinate",
    });
  });
});

/**
 * A RULE IS ONLY ANNOUNCED WHERE IT IS ENFORCED.
 *
 * `PortalMapFraming.summary` has TWO consumers: the comment map on the public
 * portal, whose submissions go through `/api/engage/[shareToken]/submit` and are
 * geofenced — and a survey `map_point` question, whose answer is written by
 * `/api/engage/[shareToken]/survey/submit`, which does not check the geofence at
 * all. A rule sentence riding inside `summary` therefore appears above a map
 * where it is NOT true, and additionally promises that a submission without a
 * location is accepted beside a question that may be REQUIRED.
 *
 * So the rule travels in `submissionRule`, and this is the guard that keeps it
 * out of the shared sentence.
 */
describe("the location rule is not claimed on a surface that does not enforce it", () => {
  const framingWithRule = () =>
    resolvePortalMapFraming({
      campaignPlace: {
        state: "set",
        label: "the Broad Street corridor",
        bbox: { minLon: -83.05, minLat: 39.95, maxLon: -83.0, maxLat: 39.98 },
      },
      submissionGeofenceEnabled: true,
    });

  it("carries the rule in its own field, not inside the shared framing sentence", () => {
    const framing = framingWithRule();

    expect(framing.submissionRule).toMatch(/has to be inside the Broad Street corridor/i);
    expect(framing.summary).not.toMatch(/has to be inside/i);
    expect(framing.summary).not.toMatch(/accepted from anywhere/i);
  });

  it("leaves the field null for a campaign that never asked for the rule", () => {
    const framing = resolvePortalMapFraming({
      campaignPlace: {
        state: "set",
        label: "the Broad Street corridor",
        bbox: { minLon: -83.05, minLat: 39.95, maxLon: -83.0, maxLat: 39.98 },
      },
    });

    expect(framing.submissionRule).toBeNull();
  });

  it("keeps the rule out of a survey map-point question's framing note", () => {
    // This question's note is the campaign's `summary`, verbatim. The survey
    // submit route does not run the geofence, so a note claiming a location rule
    // would be the product asserting something it has not established.
    const note = resolveMapPointQuestionView(null, framingWithRule()).framingNote;

    expect(note).not.toBeNull();
    expect(note).not.toMatch(/has to be inside/i);
    expect(note).not.toMatch(/accepted from anywhere/i);
  });
});
