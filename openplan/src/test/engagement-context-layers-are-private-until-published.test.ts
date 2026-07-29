import { describe, expect, it } from "vitest";

import { readMigration } from "./migrations/read-migrations";
import { classifyRoleAwareness, loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { contextLayerPublicationWarning } from "@/lib/engagement/context-layers";

/**
 * An uploaded map layer stays private until an operator publishes it, and
 * publishing means the open internet.
 *
 * WHY THIS TABLE NEEDS ITS OWN GUARD. Everything else in the engagement module
 * is either operator-only or already public by construction. This one carries a
 * single boolean that moves geometry — possibly parcel geometry, possibly with
 * owner attributes riding along — from "our workspace" to "anyone with the
 * link". Three things have to hold at once for that to be safe, and none of them
 * is visible from the route alone:
 *
 *   1. the default is off, so an upload is not a publication;
 *   2. anon has no policy and no grant, so publication cannot happen by
 *      accident through PostgREST — it happens only in the one service-role
 *      query that filters on the flag;
 *   3. a viewer cannot flip it, at the database and not merely at the route.
 */

const MIGRATION = "20260729000002_engagement_context_layers.sql";
const TABLE = "engagement_context_layers";

const sql = readMigration(MIGRATION);
const inventory = loadPolicyInventory();
const schema = loadSchemaInventory();

describe("the engagement_context_layers table", () => {
  it("declares the columns the map, the legend, and the disclosure all read", () => {
    const columns = schema.columns(TABLE);
    expect(columns).toBeDefined();

    for (const column of [
      "workspace_id",
      "campaign_id",
      "name",
      "display_color",
      "geometry_kinds",
      "features",
      "bbox",
      "visible_to_participants",
      // The disclosure contract, in the same field names as MapLayerDisclosure.
      "feature_count",
      "source_feature_count",
      "dropped_feature_count",
      "truncated",
      // How the coordinate system was established — the column that makes
      // "read from your .prj" distinguishable from "assumed".
      "srs_basis",
      "srs_name",
      "srs_authority",
      "srs_code",
    ]) {
      expect(columns?.has(column), `missing column ${column}`).toBe(true);
    }
  });

  it("keeps an upload private until somebody decides otherwise", () => {
    expect(sql).toMatch(/visible_to_participants\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i);
  });

  it("cannot record a truncation that disagrees with its own counts", () => {
    // Derived in two places is how two places come to disagree, and the number
    // a resident reads ("showing 500 of 2,000 shapes") is downstream of this.
    // All three columns count SHAPES — one drawn geometry each — which is what
    // keeps both sides of this arithmetic in the same unit when a
    // GeometryCollection is expanded at import.
    expect(sql).toContain(
      "truncated = ((feature_count + dropped_feature_count) < source_feature_count)"
    );
  });

  it("refuses two layers with the same legend entry on one campaign", () => {
    expect(sql).toMatch(/UNIQUE \(campaign_id, name\)/);
  });

  it("enables row-level security", () => {
    expect(schema.rlsEnabled(TABLE)).toBe(true);
  });
});

describe("who the database lets touch a context layer", () => {
  it("lets any member of the owning workspace read", () => {
    expect(inventory.permissiveGrants(TABLE, "SELECT").map((policy) => policy.policy)).toEqual([
      `${TABLE}_member_read`,
    ]);
  });

  it("makes every write role-aware, so a viewer cannot publish anything", () => {
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      const grants = inventory.permissiveGrants(TABLE, command);
      expect(grants, `no permissive ${command} policy`).toHaveLength(1);
      // Role-AWARE, not merely workspace-scoped. Membership is not permission:
      // a viewer is a member. Without this, the restrictive gate installed for
      // the older tables would be the only thing standing between a read-only
      // account and a button that publishes parcel geometry.
      expect(classifyRoleAwareness(grants[0]).kind, `${command} policy is role-blind`).toBe("matched");
      expect(grants[0].body).toContain("workspace_member_can_write");
    }
  });

  it("gives anon nothing at all, so publication happens in one place only", () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.engagement_context_layers FROM PUBLIC, anon;/);

    // No anon policy, deliberately. The public portal reads through the service
    // role filtered on visible_to_participants; an anon SELECT policy would
    // additionally expose every published layer to anyone holding the
    // deployment's public key, with no campaign link involved, and would make
    // "is this layer public?" a question you answer by reading predicates.
    const anonPolicies = inventory
      .forTable(TABLE)
      .filter((policy) => /\bTO\s+anon\b/i.test(policy.body) || /\bauth\.role\(\)\s*=\s*'anon'/i.test(policy.body));
    expect(anonPolicies).toEqual([]);
  });
});

describe("what the operator is told before publishing", () => {
  it("names the audience, the absence of a sign-in, and the data not to publish", () => {
    const warning = contextLayerPublicationWarning("Parcels");

    expect(warning).toContain("Parcels");
    expect(warning).toContain("public link");
    expect(warning).toContain("no sign-in");
    // The specific hazard, named. "This will be public" is true and useless;
    // the planner needs to think about the attribute table they just uploaded.
    expect(warning).toContain("parcels, addresses");
  });

  it("is stated in the schema too, where the next developer will find it", () => {
    expect(sql).toMatch(/COMMENT ON COLUMN public\.engagement_context_layers\.visible_to_participants/);
    expect(sql).toContain("world-readable");
  });
});
