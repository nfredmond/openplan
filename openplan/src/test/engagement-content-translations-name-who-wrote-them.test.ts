import { describe, expect, it } from "vitest";

import { readMigration } from "./migrations/read-migrations";
import { classifyRoleAwareness, loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { PORTAL_TRANSLATABLE_ENTITIES } from "@/lib/engagement/portal-i18n/operator-text";

/**
 * A translation of an agency's own words carries who wrote it, and the database
 * is where that is made non-optional.
 *
 * WHY THIS TABLE NEEDS ITS OWN GUARD. Everything the participant portal renders
 * from it is read by members of the public with no sign-in, in the context Title
 * VI language-access obligations are about, and the whole design rests on ONE
 * column: `source`. `'operator'` means a person at the agency wrote or approved
 * this Spanish, so it renders with no caveat and the agency can be held to it;
 * `'machine'` means a model produced it, so every surface must label it. A row
 * that reaches the portal without that distinction — nullable, defaulted, or
 * carrying some third value the resolver does not know — publishes a machine's
 * wording as the agency's own statement, silently. Four things have to hold for
 * that to be impossible, and none of them is visible from a route:
 *
 *   1. `source` is NOT NULL, has no default, and admits exactly two values;
 *   2. the entity_type domain is the SAME set the resolver knows, in both
 *      directions — a value the schema allows and the code ignores is inert, but
 *      a value the code resolves and the schema rejects is a write that fails in
 *      front of an operator;
 *   3. one translation per (entity, field, locale), so a resident is not shown a
 *      different official sentence on refresh;
 *   4. a viewer cannot write one, at the database and not merely at the route.
 *
 * Asserted structurally against the migration rather than against a live
 * database, like every other guard in this tree, so it holds in CI and in the
 * window before the migration is applied.
 */

const MIGRATION = "20260729000004_engagement_content_translations.sql";
const TABLE = "engagement_content_translations";

const sql = readMigration(MIGRATION);
const inventory = loadPolicyInventory();
const schema = loadSchemaInventory();

describe("the engagement_content_translations table", () => {
  it("declares every column the portal's one translation read names", () => {
    const columns = schema.columns(TABLE);
    expect(columns).toBeDefined();

    for (const column of [
      // The query key: one read per campaign per locale.
      "campaign_id",
      "locale",
      // The polymorphic address the resolver looks a string up by.
      "entity_type",
      "entity_id",
      "field",
      // What is rendered, and what must be said about it.
      "translated_text",
      "source",
      "machine_model",
      // Whose data this is — every policy below keys off it.
      "workspace_id",
      // Provenance an agency can still answer for years later.
      "source_text_hash",
      "created_by",
      "created_at",
      "updated_at",
    ]) {
      expect(columns?.has(column), `missing column ${column}`).toBe(true);
    }
  });

  it("will not accept a translation that does not say who wrote it", () => {
    // NOT NULL and no DEFAULT, both. A default would mean a row whose origin
    // nobody recorded still rendering as somebody's — and the safe-looking
    // default ('operator') is the one that publishes model output as the
    // agency's own words.
    expect(sql).toMatch(/source TEXT NOT NULL CHECK \(source IN \('operator', 'machine'\)\)/);
    expect(sql).not.toMatch(/source TEXT[^,]*DEFAULT/);
  });

  it("keeps its entity_type domain and the resolver's in step, in both directions", () => {
    // The schema and PORTAL_TRANSLATABLE_ENTITIES are two statements of one set.
    // A value in the CHECK that the resolver does not know is inert; a value the
    // resolver renders that the CHECK rejects is a write that fails in front of
    // an operator with a constraint-violation message.
    const check = sql.match(/entity_type TEXT NOT NULL CHECK \(entity_type IN \(([\s\S]*?)\)\)/);
    expect(check, "the entity_type CHECK is no longer where this test looks").not.toBeNull();

    const declared = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect([...declared].sort()).toEqual([...PORTAL_TRANSLATABLE_ENTITIES].sort());
  });

  it("labels a machine translation with the model, and only a machine translation", () => {
    // An operator row with a model name attached would be a row whose two
    // provenance fields disagree, and the resolver would have to pick one.
    expect(sql).toContain("(source = 'machine') OR (machine_model IS NULL)");
  });

  it("refuses an empty translation, which is worse than none", () => {
    // A blank string replaces text a resident could read with nothing, and
    // reports success doing it.
    expect(sql).toMatch(/translated_text TEXT NOT NULL CHECK \(btrim\(translated_text\) <> ''\)/);
    expect(sql).toMatch(/field TEXT NOT NULL CHECK \(btrim\(field\) <> ''\)/);
  });

  it("holds one translation per field per language", () => {
    // Two rows would mean the portal picking one arbitrarily, so a resident is
    // shown a different official sentence on refresh — and an agency cannot say
    // which one it published.
    expect(sql).toMatch(/UNIQUE \(entity_type, entity_id, field, locale\)/);
  });

  it("constrains the SHAPE of a language tag without freezing the language list", () => {
    // The supported set lives in TRANSLATION_LANGUAGES. A copy of it here would
    // be a second taxonomy, and a schema migration standing between this product
    // and its next country.
    expect(sql).toMatch(/locale TEXT NOT NULL CHECK \(locale ~ '\^\[a-z\]\{2,3\}/);
    expect(sql).not.toMatch(/locale TEXT NOT NULL CHECK \(locale IN \(/);
  });

  it("enables row-level security", () => {
    expect(schema.rlsEnabled(TABLE)).toBe(true);
  });
});

describe("who the database lets publish an agency's other-language wording", () => {
  it("lets any member of the owning workspace read", () => {
    // Viewers included: a viewer must be able to see what their own agency has
    // published in every language.
    expect(inventory.permissiveGrants(TABLE, "SELECT").map((policy) => policy.policy)).toEqual([
      `${TABLE}_member_read`,
    ]);
  });

  it("makes every write role-aware, so a viewer cannot publish official wording", () => {
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      const grants = inventory.permissiveGrants(TABLE, command);
      expect(grants, `no permissive ${command} policy`).toHaveLength(1);
      // Role-AWARE, not merely workspace-scoped. Membership is not permission: a
      // viewer is a member. Without this, the restrictive gate retrofitted onto
      // the older tables would be the only thing between a read-only account and
      // a row that renders as the agency's own Spanish with no caveat.
      expect(classifyRoleAwareness(grants[0]).kind, `${command} policy is role-blind`).toBe("matched");
      expect(grants[0].body).toContain("workspace_member_can_write");
    }
  });

  it("needs no restrictive writer gate, because it asks the role itself", () => {
    // The counterpart of the assertion above, and the reason the restrictive
    // count in viewer-write-denial-guard.test.ts did not move for this
    // migration. Stated so that removing the role check from a policy above
    // fails HERE too rather than quietly relying on a gate this table never had.
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      expect(inventory.restrictiveGates(TABLE, command)).toEqual([]);
    }
  });

  it("gives anon nothing at all, so publication happens in one place only", () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.engagement_content_translations FROM PUBLIC, anon;/);

    // No anon policy, deliberately — the same posture as
    // engagement_context_layers. The public portal reads through the service
    // role behind the campaign's share_token AND status = 'active'; that route
    // IS the publication rule. An anon SELECT policy would additionally expose
    // every DRAFT campaign's translations to anyone holding the deployment's
    // public key, and would make "what can the public see?" a question you
    // answer by reading policy predicates instead of by reading one query.
    const anonPolicies = inventory
      .forTable(TABLE)
      .filter((policy) => /\bTO\s+anon\b/i.test(policy.body) || /\bauth\.role\(\)\s*=\s*'anon'/i.test(policy.body));
    expect(anonPolicies).toEqual([]);
  });
});

describe("what happens to a translation when the thing it translates is deleted", () => {
  it("cleans up after each child entity the address cannot reference", () => {
    // `entity_id` cannot carry a foreign key, because it points at four tables.
    // Without these triggers a deleted category leaves its translations behind,
    // and the resolver would keep answering with them if a later row ever
    // reused the id. One trigger per translatable child, all four.
    for (const [table, entity] of [
      ["engagement_categories", "category"],
      ["engagement_survey_questions", "survey_question"],
      ["engagement_survey_question_options", "survey_question_option"],
      ["engagement_closeloop_entries", "close_loop_entry"],
    ] as const) {
      expect(sql).toMatch(
        new RegExp(`AFTER DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.delete_engagement_content_translations\\('${entity}'\\)`)
      );
      // The trigger has to fire on a table that exists and is keyed by `id`,
      // which is what the trigger function matches `entity_id` against.
      expect(schema.hasColumn(table, "id"), `${table}.id`).toBe(true);
    }

    // The fifth entity — the campaign itself — is covered by a real foreign key
    // instead, which is why it has no trigger.
    expect(sql).toMatch(/campaign_id UUID NOT NULL REFERENCES public\.engagement_campaigns\(id\) ON DELETE CASCADE/);
  });
});

describe("the language a campaign was written in", () => {
  it("is nullable with no default, so nobody's silence becomes a claim", () => {
    // Defaulting it to 'en' would bake "agencies write in English" into the
    // schema of a product whose stated target is worldwide, and would make the
    // portal say "shown in English" about a campaign an agency wrote in Spanish.
    // Left null, the resolver presumes the portal default and DISCLOSES the
    // presumption — "shown as the project team wrote it", which claims nothing
    // nobody established.
    expect(schema.hasColumn("engagement_campaigns", "default_content_locale")).toBe(true);
    const added = sql.match(/ADD COLUMN IF NOT EXISTS default_content_locale TEXT[\s\S]*?;/);
    expect(added, "the default_content_locale column is no longer added here").not.toBeNull();
    expect(added?.[0]).not.toMatch(/DEFAULT/);
    expect(added?.[0]).not.toMatch(/NOT NULL/);
  });
});
