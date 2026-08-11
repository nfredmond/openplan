import { describe, expect, it } from "vitest";

import { blankComments, readMigration } from "./migrations/read-migrations";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * aerial_flight_plans — one planner-authored flight plan per mission.
 *
 * Structural assertions against the parsed migrations, so they hold with no
 * live database — the arrangement vmt-significance-screenings-migration uses.
 * What matters here: dishonest states are unstorable (a snapshot with no
 * fingerprint, a plan with no vertical intent, an out-of-band overlap), the
 * writes are role-aware at the permissive layer, and NOTHING vendor- or
 * jurisdiction-specific is frozen into SQL.
 */

// Comments are BLANKED before any regex runs. This test asserts on SQL that
// executes, never on prose — a guard that reads comments can be tripped by its
// own documentation or excused by it, and this repo has paid for both
// directions (see the prose-is-not-the-artifact lesson).
const migrationSql = blankComments(readMigration("20260811000001_aerial_flight_plans.sql"));

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();

describe("aerial_flight_plans migration", () => {
  it("creates the table with every column the flight-plan route projects", () => {
    expect(schema.tables()).toContain("aerial_flight_plans");

    for (const column of [
      "id",
      "workspace_id",
      "mission_id",
      "camera_key",
      "target_gsd_cm_per_px",
      "altitude_agl_m",
      "front_overlap_pct",
      "side_overlap_pct",
      "speed_m_s",
      "gimbal_pitch_deg",
      "cross_grid",
      "boundary_margin_m",
      "corridor_width_m",
      "crew_pilot_name",
      "rth_altitude_m",
      "notes",
      "generated_plan",
      "generated_at",
      "generated_with",
      "updated_by",
      "created_at",
      "updated_at",
    ]) {
      expect(schema.hasColumn("aerial_flight_plans", column), `missing ${column}`).toBe(true);
    }
  });

  it("holds exactly one plan per mission, cascading with it", () => {
    expect(migrationSql).toMatch(
      /mission_id\s+UUID\s+NOT NULL UNIQUE REFERENCES public\.aerial_missions\(id\) ON DELETE CASCADE/i
    );
    expect(schema.childrenOf("aerial_missions")).toContain("aerial_flight_plans");
    expect(schema.childrenOf("workspaces")).toContain("aerial_flight_plans");
  });

  it("makes an out-of-band overlap unstorable — the photogrammetric 40–95 window", () => {
    expect(migrationSql).toMatch(/CHECK \(front_overlap_pct >= 40 AND front_overlap_pct <= 95\)/i);
    expect(migrationSql).toMatch(/CHECK \(side_overlap_pct >= 40 AND side_overlap_pct <= 95\)/i);
  });

  it("requires vertical intent: a GSD target, an altitude, or both — never neither", () => {
    expect(migrationSql).toMatch(/aerial_flight_plans_vertical_intent CHECK/i);
    expect(migrationSql).toMatch(
      /target_gsd_cm_per_px IS NOT NULL OR altitude_agl_m IS NOT NULL/i
    );
  });

  it("binds a grid snapshot to its timestamp and parameter fingerprint — all three or none", () => {
    expect(migrationSql).toMatch(/aerial_flight_plans_snapshot_is_datable CHECK/i);
    expect(migrationSql).toMatch(
      /generated_plan IS NULL AND generated_at IS NULL AND generated_with IS NULL/i
    );
    expect(migrationSql).toMatch(
      /generated_plan IS NOT NULL AND generated_at IS NOT NULL AND generated_with IS NOT NULL/i
    );
  });

  it("hardcodes no vendor, no camera spec, and no regulatory ceiling", () => {
    // The camera is a registry KEY; sensor numbers live in code as data. A
    // vendor or model name appearing in SQL would be the hardcoding defect.
    expect(migrationSql).not.toMatch(/\b(dji|mavic|phantom|autel|sony|wingtra|parrot|skydio)\b/i);
    expect(migrationSql).not.toMatch(/sensor_width|focal_length|image_width/i);
    // No altitude ceiling: Part 107's 400 ft is one jurisdiction's rule, and
    // core schema stays jurisdiction-neutral. Only the > 0 sanity bound exists.
    expect(migrationSql).not.toMatch(/altitude_agl_m\s*<=?\s*\d/i);
    expect(migrationSql).not.toMatch(/\b(400|121\.9|121\.92)\b/);
  });

  it("makes a cross-workspace plan unstorable via the scope trigger", () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION public\.validate_aerial_flight_plan_scope\(\)/i);
    expect(migrationSql).toMatch(/mission_workspace_id <> NEW\.workspace_id/i);
    expect(migrationSql).toMatch(
      /CREATE TRIGGER trg_aerial_flight_plans_scope\s+BEFORE INSERT OR UPDATE ON public\.aerial_flight_plans/i
    );
  });

  it("denies a viewer through role-aware write policies, with no restrictive companion needed", () => {
    expect(schema.rlsEnabled("aerial_flight_plans")).toBe(true);

    expect(
      policies.permissiveGrants("aerial_flight_plans", "SELECT").map((policy) => policy.policy)
    ).toEqual(["aerial_flight_plans_read"]);

    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      const grants = policies.permissiveGrants("aerial_flight_plans", command);
      expect(grants.map((policy) => policy.policy)).toEqual([
        `aerial_flight_plans_writer_${command.toLowerCase()}`,
      ]);
      // Role-aware by construction: workspace_member_can_write is the shared
      // fail-closed predicate, so a viewer is denied at the database.
      expect(grants[0].body).toMatch(/public\.workspace_member_can_write\s*\(\s*workspace_id\s*\)/i);
    }

    // And no restrictive gate exists for it — the permissive layer carries the
    // role, which is the intended post-20260728000006 shape.
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      expect(policies.restrictiveGates("aerial_flight_plans", command)).toEqual([]);
    }
  });

  it("grants explicitly under the deny-by-default privilege posture", () => {
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.aerial_flight_plans FROM PUBLIC, anon/i);
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.aerial_flight_plans TO authenticated/i
    );
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.aerial_flight_plans TO service_role/i
    );
  });

  it("indexes the workspace sweep path", () => {
    expect(migrationSql).toMatch(/aerial_flight_plans_workspace_idx\s+ON public\.aerial_flight_plans\(workspace_id\)/i);
  });
});
