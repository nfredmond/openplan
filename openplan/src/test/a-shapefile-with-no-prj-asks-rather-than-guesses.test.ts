/**
 * A shapefile with no `.prj` produces a QUESTION, and the answer is a claim.
 *
 * ═══ THE DESIGN THIS PROTECTS ═══
 *
 * A State Plane shapefile in feet with no `.prj` is the common case, not the
 * exotic one — planning departments hold shapefiles older than the people
 * working on them. Refusing those outright would strand exactly the data this
 * feature exists for; guessing would be worse than either, because a State
 * Plane zone guessed wrong lands a layer a hundred kilometres away and looks
 * entirely ordinary doing it.
 *
 * So OpenPlan asks. And the answer a planner gives is a DIFFERENT KIND OF FACT
 * from a `.prj`: it is a statement a named person made, it can be wrong, and
 * every surface that shows it says so. `planner_asserted` exists to keep those
 * two apart forever — it may never be written as, or upgraded into, `prj_file`.
 */

import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildShp, buildZip } from "./fixtures/context-layer-uploads";
import { describeSpatialFileSrs } from "@/lib/geo/crs/describe";
import { forwardProject } from "@/lib/geo/crs/projections";
import { findCrsByCode } from "@/lib/geo/crs/registry";
import { spatialFileCrsFor } from "@/lib/geo/crs";
import {
  SPATIAL_FILE_SRS_BASES,
  importSpatialFile,
  type InflateRawSync,
  type SpatialFileCrsResolver,
} from "@/lib/geo/spatial-file-import";

const nodeInflate: InflateRawSync = (compressed, declared) =>
  new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(declared, 1) }));

const SACRAMENTO: [number, number] = [-121.4944, 38.5816];

/** A shapefile zip carrying geometry and NOTHING that names a coordinate system. */
function shapefileWithoutPrj(code: string): Uint8Array {
  const entry = findCrsByCode(code)!;
  const [x, y] = forwardProject(entry.method, SACRAMENTO[0], SACRAMENTO[1], entry.params);
  return buildZip([
    {
      name: "parcels.shp",
      data: buildShp([{ type: "point", position: [x / entry.unitToMetres, y / entry.unitToMetres] }]),
    },
    { name: "parcels.shx", data: new Uint8Array(100) },
  ]);
}

describe("a shapefile with no .prj asks rather than guesses", () => {
  it("refuses by name when nothing can answer the question", () => {
    // No resolver at all — the engagement lane, and any deployment with no
    // registry. The refusal says what is missing and what to do, and it never
    // reads the file as WGS 84.
    const result = importSpatialFile(
      { filename: "parcels.zip", bytes: shapefileWithoutPrj("EPSG:2226"), featureCap: null },
      nodeInflate
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("srs_undetermined");
    expect(result.message).toContain("no .prj file");
    expect(result.message).toContain("will not guess");
  });

  it("passes the absence to the resolver, so a picker can be offered", () => {
    // The resolver is told `prjText: null` rather than simply not called. That
    // is what lets the workspace-GIS lane turn the refusal into a question
    // instead of a dead end.
    const seen: (string | null)[] = [];
    const resolver: SpatialFileCrsResolver = ({ prjText }) => {
      seen.push(prjText);
      return { ok: false, reason: "srs_undetermined", message: "choose a coordinate system" };
    };
    const result = importSpatialFile(
      { filename: "parcels.zip", bytes: shapefileWithoutPrj("EPSG:2226"), featureCap: null },
      nodeInflate,
      resolver
    );
    expect(seen).toEqual([null]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("choose a coordinate system");
  });

  it("records a planner's answer as an assertion, never as evidence from the file", () => {
    const asserted = findCrsByCode("EPSG:2226")!;
    const resolver: SpatialFileCrsResolver = () => ({
      ok: true,
      crs: spatialFileCrsFor(asserted),
      basis: "planner_asserted",
    });
    const result = importSpatialFile(
      { filename: "parcels.zip", bytes: shapefileWithoutPrj("EPSG:2226"), featureCap: null },
      nodeInflate,
      resolver
    );

    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;

    // THE CLAIM TIER. The layer is placed and the geometry is right, and the
    // basis still says a person said so. Anything that turned this into
    // `prj_file` would erase the difference between a file that identified
    // itself and a file somebody identified for it.
    expect(result.srs.basis).toBe("planner_asserted");
    expect(result.srs.reprojectedFrom?.code).toBe("2226");
    const coordinates = (result.featureCollection.features[0].geometry as GeoJSON.Point).coordinates;
    expect(coordinates[0]).toBeCloseTo(SACRAMENTO[0], 5);
    expect(coordinates[1]).toBeCloseTo(SACRAMENTO[1], 5);
  });

  it("explains an assertion as a statement somebody made, and names them", () => {
    const asserted = findCrsByCode("EPSG:2226")!;
    const sentence = describeSpatialFileSrs({
      authority: "EPSG",
      code: "4326",
      name: "WGS 84",
      basis: "planner_asserted",
      assertedBy: "Dana Whitfield",
      reprojectedFrom: {
        authority: asserted.authority,
        code: asserted.code,
        name: asserted.name,
        unit: asserted.unit,
      },
    });

    expect(sentence).toContain("Dana Whitfield stated");
    expect(sentence).toContain("said nothing about its coordinate system");
    expect(sentence).toContain("cannot confirm it");
    expect(sentence).toContain("NAD83 / California zone 2 (ftUS)");
    // And it must never read like the file said it.
    expect(sentence).not.toContain("read from the shapefile");
  });

  it("explains a .prj as evidence, in words an assertion never gets", () => {
    // The contrast is the point. If both sentences read the same way, the claim
    // tier exists in the database and nowhere a planner can see it.
    const sentence = describeSpatialFileSrs({
      authority: "EPSG",
      code: "4326",
      name: "WGS 84",
      basis: "prj_file",
      reprojectedFrom: { authority: "EPSG", code: "2226", name: "NAD83 / California zone 2 (ftUS)", unit: "US survey foot" },
    });
    expect(sentence).toContain("read from the shapefile's .prj file");
    expect(sentence).not.toContain("stated");
    expect(sentence).not.toContain("cannot confirm");
  });

  it("keeps `planner_asserted` in the vocabulary as a member of its own", () => {
    // A guard against the quiet version of this regression: collapsing the two
    // bases into one, or dropping the member and defaulting to `prj_file`,
    // would leave every test above passing except this one.
    expect([...SPATIAL_FILE_SRS_BASES]).toContain("planner_asserted");
    expect([...SPATIAL_FILE_SRS_BASES]).toContain("prj_file");
    expect(new Set(SPATIAL_FILE_SRS_BASES).size).toBe(SPATIAL_FILE_SRS_BASES.length);
  });

  it("still refuses a file whose .prj is present but names something unknown", () => {
    // The no-.prj path must not become a catch-all that swallows a file that
    // DID identify itself, with a system OpenPlan does not carry. Those are
    // different problems and the second one has a code the planner can look up.
    const zip = buildZip([
      { name: "parcels.shp", data: buildShp([{ type: "point", position: [1000, 1000] }]) },
      {
        name: "parcels.prj",
        data: new TextEncoder().encode('PROJCS["Municipal Grid 1962",AUTHORITY["LOCAL","7"]]'),
      },
    ]);
    const resolver: SpatialFileCrsResolver = ({ prjText }) => ({
      ok: false,
      reason: "srs_unsupported",
      message: `OpenPlan does not carry the coordinate system this file names: ${prjText?.slice(7, 30)}`,
    });
    const result = importSpatialFile({ filename: "parcels.zip", bytes: zip, featureCap: null }, nodeInflate, resolver);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("srs_unsupported");
    expect(result.message).toContain("Municipal Grid 1962");
  });
});
