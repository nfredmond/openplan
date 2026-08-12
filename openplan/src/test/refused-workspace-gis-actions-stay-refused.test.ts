/**
 * The workspace-GIS writes were deliberately REFUSED as assistant actions on
 * 2026-08-12, and this is the executable form of those decisions.
 *
 * ═══ WHY THIS FILE HAD TO BE WRITTEN TWICE OVER ═══
 *
 * Four route headers already cited this path —
 * `workspace-gis/layers/route.ts`, `layers/[layerId]/route.ts`,
 * `ingests/route.ts` and `geo/crs/route.ts` — and the file did not exist. A
 * citation to nothing reads exactly like protection: a later session greps for
 * the refusal, finds a route header confidently pointing at a guard, and
 * registers the action believing the guard would have caught it. Prose that
 * names an executable and is not one is worse than prose that names nothing.
 *
 * ═══ THE THREE DECISIONS ═══
 *
 * 1. UPLOADING GEOMETRY. The payload is a file — up to 200 MB of parcel
 *    boundaries — that the model would author from outside the system. No
 *    approval sheet can render a quarter of a million polygons, so the approver
 *    consents to a filename. This is the offline-comment-import refusal and the
 *    mission-imagery refusal in a third costume.
 *
 * 2. ASSERTING A COORDINATE SYSTEM. The sharpest of the three, and it is not
 *    about file size at all. When a shapefile carries no .prj, OpenPlan asks a
 *    PERSON which system it is in and records the answer as THEIR statement,
 *    with their name and the time on it (`srs_basis = 'planner_asserted'`,
 *    `srs_asserted_by`). A model will produce "NAD83 / California zone 3
 *    (ftUS)" fluently and wrongly, the layer will land forty kilometres away
 *    looking entirely ordinary, and the record will say a named planner
 *    asserted it. That is a claim-tier promotion that no tier guard can see,
 *    because the tier here is carried by an attribution column rather than by a
 *    `tier` column — `an-agent-may-not-promote-a-tier` passes green on every
 *    kind below. It is also the one refusal whose payload is TINY: an
 *    authority code is eleven characters, which is precisely why it looks safe.
 *
 * 3. DELETING A LAYER. An id-only payload, and therefore the horizon-band and
 *    mission-imagery precedent: the id test is a proxy for "the model authors
 *    no consequential content", and an erasure IS the content. A workspace GIS
 *    layer is referenced by other modules (`workspace_gis_layer_references`),
 *    so deleting one silently empties whatever was drawn on top of it, and an
 *    agent tidying a layer list has a standing incentive to remove exactly the
 *    layer whose absence nobody will notice until a map is wrong.
 *
 * A ratchet in one direction only: an entry may be REMOVED, but only by a
 * session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

type RefusedWorkspaceGisAction = {
  label: string;
  /**
   * Alternative spellings a future session might reach for. A kind matches
   * when it contains every word in ANY one group.
   */
  nameGroups: string[][];
  /** One plausible kind name PER GROUP, so a group matching nothing is caught. */
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedWorkspaceGisAction[] = [
  {
    label: "uploading geometry as a workspace map layer",
    nameGroups: [
      ["upload", "layer"],
      ["create", "map", "layer"],
      ["upload", "shapefile"],
      ["ingest", "geometry"],
    ],
    provokes: [
      "upload_workspace_layer",
      "create_map_layer",
      "upload_shapefile",
      "ingest_geometry_batch",
    ],
    reason:
      "The consequential payload is a file of up to 200 MB — a county parcel fabric is a quarter of a million " +
      "polygons — that the model would author from OUTSIDE the system, and no approval sheet can render what " +
      "the planner would be consenting to. They would be approving a filename. Geometry uploaded this way " +
      "then becomes the base other modules draw on top of, so a fabricated boundary sits invisibly under " +
      "later work. Upload is a human console write; the route exists and is member-gated.",
  },
  {
    label: "asserting which coordinate system a layer is in",
    nameGroups: [
      ["assert", "crs"],
      ["set", "crs"],
      ["coordinate", "system"],
      ["srs"],
    ],
    provokes: ["assert_layer_crs", "set_layer_crs", "choose_coordinate_system", "set_layer_srs"],
    reason:
      "A file with no .prj gets its coordinate system from a PERSON, recorded as that person's statement with " +
      "their name and the time on it. A model produces a State Plane zone fluently and wrongly; the layer " +
      "lands forty kilometres away looking entirely ordinary, and the row then says a named planner asserted " +
      "it. The payload is eleven characters, which is exactly why it looks safe — and the tier guard cannot " +
      "see this promotion, because the tier is carried by `srs_basis` and `srs_asserted_by` rather than by a " +
      "column any tier vocabulary names.",
  },
  {
    label: "deleting a workspace map layer or one of its versions",
    nameGroups: [
      ["delete", "layer"],
      ["remove", "layer"],
      ["delete", "workspace", "gis"],
    ],
    provokes: ["delete_workspace_layer", "remove_map_layer", "delete_workspace_gis_version"],
    reason:
      "An id-only payload that authors an erasure — the horizon-band-delete precedent. Layers are referenced " +
      "by other modules through `workspace_gis_layer_references`, so removing one silently empties whatever " +
      "was drawn on it, and the map afterwards looks deliberate rather than broken. An agent tidying a layer " +
      "list has a standing incentive to remove precisely the layer whose absence nobody notices until a map " +
      "is wrong — the completion-signal shape the registry refuses.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

function matchesRefusal(kind: string, entry: RefusedWorkspaceGisAction): boolean {
  return entry.nameGroups.some((group) => group.every((word) => kind.includes(word)));
}

describe("the refused workspace-GIS actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.label}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matchesRefusal(kind, entry));

      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on ` +
          `2026-08-12: ${entry.reason} If the argument has genuinely changed, remove this entry AND record ` +
          "why — do not delete the assertion to make a build pass."
      ).toEqual([]);
    });
  }

  it("guards the guard: every name group would catch a registration", () => {
    // A group matching nothing is a hole with no symptom; the GTFS guard once
    // survived a typo in one of six groups because only the ENTRY was checked.
    for (const entry of REFUSED) {
      expect(
        entry.provokes.length,
        `"${entry.label}" must provoke one name per group`
      ).toBe(entry.nameGroups.length);

      entry.nameGroups.forEach((group, index) => {
        const provoker = entry.provokes[index];
        expect(
          group.every((word) => provoker.includes(word)),
          `group [${group.join(", ")}] of "${entry.label}" does not match its own provoker ${provoker}`
        ).toBe(true);
      });
    }
  });

  it("leaves innocent registered actions alone", () => {
    // Real registered kinds, including the two these matchers sit closest to:
    // a record-creation and a scaffold that both write geometry-adjacent rows.
    for (const innocent of [
      "create_project_record",
      "launch_model_run",
      "refresh_gtfs_feed",
      "create_rtp_horizon_bands_from_cycle_horizon",
    ]) {
      expect(REGISTERED_KINDS, `${innocent} must exist for this check to mean anything`).toContain(innocent);
      const hits = REFUSED.filter((entry) => matchesRefusal(innocent, entry));
      expect(hits.map((entry) => entry.label), innocent).toEqual([]);
    }
  });

  /**
   * THE REGISTRY DID NOT GROW. This lane shipped eight API routes and a full
   * upload path; the count is asserted here so that landing it cannot quietly
   * add a thirteenth action along the way.
   */
  it("leaves the action registry at twelve", () => {
    expect(REGISTERED_KINDS.length).toBe(12);
  });
});
