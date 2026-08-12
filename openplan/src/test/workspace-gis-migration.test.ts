import { describe, expect, it } from "vitest";
import { loadGrantInventory } from "./migrations/grant-inventory";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { blankComments, readMigration } from "./migrations/read-migrations";

/**
 * THE WORKSPACE GIS SCHEMA, guarded where the schema is the artifact.
 *
 * Every assertion below is about a live property of the database — a CHECK, a
 * privilege, a foreign-key action, a function's security context — and each one
 * is a decision a future edit could reverse with nothing else noticing. Four of
 * them are the difference between this feature and a feature that silently
 * draws geometry in the wrong place, which is the failure this lane exists to
 * make impossible.
 */

const LAYERS_MIGRATION = "20260812000015_workspace_gis_layers.sql";
const FEATURES_MIGRATION = "20260812000016_workspace_gis_features.sql";
const REFERENCES_MIGRATION = "20260812000018_workspace_gis_layer_references.sql";

const layersSql = readMigration(LAYERS_MIGRATION);
const featuresSql = readMigration(FEATURES_MIGRATION);
const referencesSql = readMigration(REFERENCES_MIGRATION);

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();
const grants = loadGrantInventory();

const TABLES = [
  "workspace_gis_layers",
  "workspace_gis_layer_versions",
  "workspace_gis_features",
  "workspace_gis_layer_references",
] as const;

function tableBody(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for public.${table}`);
  const end = sql.indexOf("\n);", start);
  if (end < 0) throw new Error(`could not find the end of public.${table}`);
  return sql.slice(start, end);
}

describe("the workspace GIS schema", () => {
  it("creates four tables with row security on", () => {
    for (const table of TABLES) {
      expect(schema.createdIn(table), `${table} must be created`).toBeTruthy();
      expect(schema.rlsEnabled(table), `${table} must enable row level security`).toBe(true);
    }
  });

  /**
   * THE CLAIM-TIER LINE, IN SQL, IN BOTH DIRECTIONS.
   *
   * A shapefile with no .prj is placed by a PERSON choosing a coordinate
   * system. That is an assertion, not evidence, and the difference decides
   * whether a planner reading the layer months later knows a human guessed. The
   * CHECK is an equality rather than an implication precisely so the promotion
   * direction is closed too: an UPDATE rewriting `planner_asserted` as
   * `prj_file` while leaving the author behind fails in the database.
   */
  it("refuses an asserted coordinate system with no author, and evidence with one", () => {
    const body = tableBody(layersSql, "workspace_gis_layer_versions");

    expect(body).toMatch(/CONSTRAINT workspace_gis_layer_versions_assertion_has_an_author/i);
    expect(body).toMatch(
      /\(srs_basis = 'planner_asserted'\)\s*\n?\s*=\s*\(srs_asserted_by IS NOT NULL AND srs_asserted_at IS NOT NULL\)/i
    );

    // The vocabulary itself: there is no member meaning "assumed".
    expect(body).toMatch(/srs_basis IN \(/i);
    expect(body).not.toMatch(/'assumed'|'guessed'|'default_wgs84'/i);
  });

  /**
   * A HALF-UPLOADED LAYER CAN NEVER PRESENT AS COMPLETE.
   *
   * The ingest is chunked because the files are 200 MB, which means a browser
   * that crashes mid-upload is normal rather than exceptional. `ready` is
   * defined in the database as "the count that arrived equals the count
   * declared", so no route, script or future agent can mark a layer with holes
   * in it finished.
   */
  it("defines a ready upload as a complete one", () => {
    const body = tableBody(layersSql, "workspace_gis_layer_versions");

    expect(body).toMatch(/CONSTRAINT workspace_gis_layer_versions_ready_is_complete/i);
    expect(body).toMatch(
      /ingest_status <> 'ready'\s*\n?\s*OR \(finalized_at IS NOT NULL AND feature_count = declared_feature_count\)/i
    );
    expect(body, "a version may not hold more features than it declared").toMatch(
      /feature_count <= declared_feature_count/i
    );
    expect(body, "a failed ingest must say why, from the fixed vocabulary").toMatch(
      /\(ingest_status = 'failed'\) = \(ingest_failure_reason IS NOT NULL\)/i
    );
  });

  /**
   * A LAYER MAY ONLY DRAW A FINISHED UPLOAD OF ITS OWN.
   *
   * A foreign key can say `current_version_id` names a version. It cannot say
   * the version belongs to this layer or that its ingest finished — and both of
   * those are how a map quietly starts drawing a partial upload, or another
   * layer's geometry. The trigger is the only thing that can check it, so the
   * trigger is what this asserts.
   */
  it("guards current_version_id with a trigger, not with a convention", () => {
    expect(layersSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.workspace_gis_current_version_is_drawable\(\)/i
    );
    expect(layersSql).toMatch(
      /CREATE TRIGGER workspace_gis_layers_current_version_guard\s*\n?\s*BEFORE INSERT OR UPDATE OF current_version_id ON public\.workspace_gis_layers/i
    );
    expect(layersSql, "a version of another layer must be refused").toMatch(
      /v_layer_id <> NEW\.id/i
    );
    expect(layersSql, "an unfinished upload must be refused").toMatch(/v_status <> 'ready'/i);
  });

  /**
   * NO SHAPE OUTSIDE THE WORLD, WHATEVER WROTE IT.
   *
   * A State Plane file in feet read as degrees produces coordinates in the
   * millions. The CRS lane refuses that with an explanation; this CHECK is the
   * last net, so a path written years from now by someone who never read that
   * lane still cannot store a shape off the planet.
   */
  it("bounds stored geometry to WGS84 in the table itself", () => {
    const body = tableBody(featuresSql, "workspace_gis_features");

    expect(body).toMatch(/CONSTRAINT workspace_gis_features_within_wgs84/i);
    expect(body).toMatch(/ST_XMin\(geom\) >= -180 AND ST_XMax\(geom\) <= 180/i);
    expect(body).toMatch(/ST_YMin\(geom\) >= -90 AND ST_YMax\(geom\) <= 90/i);
    expect(body, "the column must be SRID 4326 geometry").toMatch(
      /geom geometry\(Geometry, 4326\) NOT NULL/i
    );
    expect(featuresSql, "the viewport query needs a spatial index").toMatch(
      /CREATE INDEX IF NOT EXISTS workspace_gis_features_geom_idx\s*\n?\s*ON public\.workspace_gis_features USING GIST \(geom\)/i
    );
  });

  /**
   * A RETRIED UPLOAD BATCH IS A NO-OP.
   *
   * Without the unique index a dropped connection doubles a batch of shapes and
   * runs the version's count past its declared total — at which point the
   * completion CHECK above can never be satisfied and the layer is stuck
   * forever. The idempotence and the completeness rule hold each other up.
   */
  it("makes a resent batch harmless", () => {
    expect(tableBody(featuresSql, "workspace_gis_features")).toMatch(
      /CONSTRAINT workspace_gis_features_unique_index UNIQUE \(version_id, feature_index\)/i
    );
    expect(featuresSql).toMatch(/ON CONFLICT \(version_id, feature_index\) DO NOTHING/i);
  });

  /**
   * BOTH GEOMETRY FUNCTIONS RUN AS THE CALLER.
   *
   * supabase-js cannot read or write a PostGIS column, so these two functions
   * are the ONLY way in and out of the feature table. SECURITY DEFINER on
   * either would make them a bypass around every policy in this migration —
   * for a table holding parcel owner names.
   */
  it("reads and writes geometry as the caller, never as the definer", () => {
    for (const fn of ["workspace_gis_append_features", "workspace_gis_features_in_bbox"]) {
      const start = featuresSql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(start, `${fn} must exist`).toBeGreaterThan(-1);
      const body = featuresSql.slice(start, start + 1400);
      expect(body, `${fn} must be SECURITY INVOKER`).toMatch(/SECURITY INVOKER/i);
      expect(body, `${fn} must pin its search_path`).toMatch(
        /SET search_path = public, pg_catalog/i
      );
      expect(body, `${fn} must not be SECURITY DEFINER`).not.toMatch(/SECURITY DEFINER/i);
    }
  });

  /**
   * ABOVE THE CAP THE VIEWPORT READ DRAWS NOTHING.
   *
   * Every other map layer draws its cap and says "showing 500 of 2,000". For a
   * parcel fabric that is a trap — an arbitrary subset reads as holes in a
   * fabric that has none. The zero-row branch is in the SQL, so a caller cannot
   * opt out of it by asking differently.
   */
  it("returns no geometry at all when the match count exceeds the limit", () => {
    expect(featuresSql).toMatch(
      /LIMIT CASE WHEN counted\.n > GREATEST\(p_limit, 0\) THEN 0 ELSE GREATEST\(p_limit, 0\) END/i
    );
    // And the count still comes back: the LEFT JOIN is what keeps the row.
    expect(featuresSql).toMatch(/LEFT JOIN LATERAL/i);
    expect(featuresSql).toMatch(/counted\.n AS matched_count/i);
  });

  /**
   * DELETING A REFERENCED LAYER IS REFUSED BY THE DATABASE — and deleting a
   * whole workspace is not blocked by rows that go with it. Both behaviours
   * come from choosing NO ACTION over RESTRICT, which is exactly the kind of
   * difference a later edit "tidies" without knowing what it is for.
   */
  it("refuses to delete an adopted layer, in the foreign key", () => {
    const body = tableBody(referencesSql, "workspace_gis_layer_references");

    expect(body).toMatch(
      /layer_id UUID NOT NULL\s*\n?\s*REFERENCES public\.workspace_gis_layers\(id\) ON DELETE NO ACTION/i
    );
    expect(body, "RESTRICT would abort a workspace delete on rows that cascade with it").not.toMatch(
      /workspace_gis_layers\(id\) ON DELETE RESTRICT/i
    );
    expect(body, "the dialog must be able to name what breaks").toMatch(
      /reference_label TEXT NOT NULL/i
    );
  });

  /**
   * EVERY POLICY HAS ITS DOOR. 20260804000001 made new tables born with no
   * client grants at all, so a table with careful policies and no GRANT answers
   * `permission denied` before RLS is ever consulted — the work_notifications
   * defect. Asserted here per table as well as by the repo-wide guard, because
   * this lane adds four tables at once.
   */
  it("grants authenticated exactly the commands its policies promise", () => {
    for (const table of TABLES) {
      expect(grants.holds(table, "authenticated", "SELECT"), `${table} SELECT`).not.toBe("none");
      expect(grants.holds(table, "authenticated", "INSERT"), `${table} INSERT`).not.toBe("none");
      expect(grants.holds(table, "authenticated", "DELETE"), `${table} DELETE`).not.toBe("none");
      expect(grants.holds(table, "anon", "SELECT"), `${table} must be unreachable to anon`).toBe(
        "none"
      );
    }

    // The feature table has no UPDATE policy and must have no UPDATE grant:
    // geometry is never edited in place, a corrected file is a new version.
    expect(policies.permissiveGrants("workspace_gis_features", "UPDATE")).toEqual([]);
    expect(grants.holds("workspace_gis_features", "authenticated", "UPDATE")).toBe("none");
  });

  /**
   * WORKSPACE LAYERS ARE NEVER PUBLIC. The engagement table has a publication
   * switch because its whole purpose is to show geometry to residents. This one
   * has none, and the absence is the feature: a parcel layer carries owner
   * names, and there is no column here anyone could flip.
   */
  it("has no publication switch and no anon policy", () => {
    // COMMENTS ARE BLANKED FIRST. The header explains at length why this table
    // has no publication switch, and a matcher run over the prose finds the
    // word in the sentence saying it is absent — the recorded failure mode
    // where documentation satisfies the guard written against it.
    expect(blankComments(layersSql)).not.toMatch(/visible_to_participants|is_public|published/i);
    for (const table of TABLES) {
      const anonPolicies = policies
        .forTable(table)
        .filter((policy) => policy.roles.includes("anon"));
      expect(anonPolicies, `${table} must have no anon policy`).toEqual([]);
    }
    // AND NO STORAGE BUCKET SHIPS WITH THIS LANE. Retaining the uploaded file
    // needs a browser-direct-to-storage transfer this repository does not have
    // yet, and a private bucket nothing writes to is infrastructure pretending
    // to be a capability. The version's storage_bucket/storage_path columns
    // stand, both-or-neither, and every reader says the original is not held.
    expect(layersSql).not.toMatch(/storage\.buckets/i);
  });

  /**
   * NOTHING NAMES A PLACE, A PROJECTION OR A JURISDICTION.
   *
   * Product non-negotiable #0. The coordinate system is DATA on a row — an
   * authority, a code, a name — and never a vocabulary frozen into a CHECK. A
   * planner in Ohio must be able to load Ohio North in US survey feet without
   * anybody editing SQL.
   */
  it("freezes no coordinate system, unit or place into the schema", () => {
    const all = `${layersSql}\n${featuresSql}\n${referencesSql}`;
    expect(all).not.toMatch(/EPSG:\d|state_?plane|NAD_1983|\bUTM\b|California|Ohio|FIPS/i);
    // srs_code is free text: a code the registry gains tomorrow must store today.
    const body = tableBody(layersSql, "workspace_gis_layer_versions");
    const codeLine = body.split("\n").find((line) => line.trim().startsWith("srs_code"));
    expect(codeLine).toBeTruthy();
    expect(codeLine, "an authority code is data, not an enum").not.toMatch(/IN \(/i);
  });
});
