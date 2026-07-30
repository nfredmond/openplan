import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { assistantApprovalActionSchema } from "@/lib/assistant/action-approval-server";
import { MODELING_CLAIM_STATUSES } from "@/lib/models/evidence-backbone";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";
import { resolveActionApiPaths, resolveRouteFile } from "./helpers/action-route-resolution";
import {
  collectAgentReachableSources,
  topLevelObjectKeys,
  writtenColumns,
} from "./helpers/reachable-write-surface";

/**
 * AN AGENT MAY NEVER PROMOTE A TIER. STRUCTURALLY.
 *
 * The honesty firewall is what makes OpenPlan defensible. A model run is
 * `screening_grade` until validation earns it something better; a machine
 * translation is labelled machine output until a person adopts it. Every one of
 * those tiers exists to stop a plausible-sounding number or sentence from being
 * presented as more established than it is — which is precisely the thing a
 * language model is best at producing.
 *
 * An agent that could set its own tier would not be cheating at the margin. It
 * would be deleting the mechanism that tells a planner, a board, or a court
 * whether the output is defensible. "Agent proposes, evidence decides" has to be
 * a property of the code, not a sentence in a design doc.
 *
 * TODAY THAT RULE HOLDS BY ABSENCE — no registered action happens to write a
 * tier. Absence is not a boundary: nothing stops the next action from being
 * `promote_claim_tier`, and every mechanism in the seam would carry it happily,
 * complete with an approval sheet and an audit row. This file is the boundary.
 *
 * THE VOCABULARY IS DERIVED, NOT LISTED. Both halves come from the codebase:
 * the tier VALUES from `MODELING_CLAIM_STATUSES`, and the tier COLUMNS from the
 * migrations, by finding every `CHECK (col IN (...))` whose vocabulary is a tier
 * vocabulary. A new tier or a new tier column is therefore covered the day it is
 * added, without anyone remembering to come back here.
 */

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");

/**
 * Tier vocabularies — a set of values that, appearing together as a column's
 * CHECK list, mark that column as recording HOW WELL ESTABLISHED something is.
 *
 * The modeling claim statuses are imported. The provenance pair is named here
 * because it has no code-side constant: `engagement_content_translations.source`
 * is `'operator' | 'machine'`, the difference between the agency's own words and
 * a model's, and promoting machine → operator deletes the disclosure a resident
 * was reading. That is the same rule wearing a different module's name.
 */
const TIER_VOCABULARIES: readonly (readonly string[])[] = [
  MODELING_CLAIM_STATUSES,
  ["operator", "machine"],
];

const TIER_VALUES = new Set(TIER_VOCABULARIES.flat());

function listSqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => path.join(MIGRATIONS_DIR, name));
}

/**
 * Every column in the schema whose CHECK vocabulary IS one of the tier
 * vocabularies (not merely overlapping it — a column listing one tier word among
 * unrelated states is not a tier column, and treating it as one would make the
 * guard cry wolf until someone deleted it).
 */
function deriveTierColumns(): Set<string> {
  const columns = new Set<string>();
  const checkPattern = /CHECK\s*\(\s*([a-z_][a-z0-9_]*)\s+IN\s*\(([^)]*)\)/gi;

  for (const file of listSqlFiles()) {
    const sql = readFileSync(file, "utf8");
    for (const match of sql.matchAll(checkPattern)) {
      const column = match[1].toLowerCase();
      const values = [...match[2].matchAll(/'([^']*)'/g)].map((entry) => entry[1]);
      if (values.length === 0) continue;
      const isTier = TIER_VOCABULARIES.some(
        (vocabulary) =>
          values.length > 1 && values.every((value) => (vocabulary as readonly string[]).includes(value))
      );
      if (isTier) columns.add(column);
    }
  }

  return columns;
}

const TIER_COLUMNS = deriveTierColumns();

/** camelCase spellings of the same columns, for the payload-side check. */
function camelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

const TIER_FIELD_NAMES = new Set(
  [...TIER_COLUMNS].flatMap((column) => [column, camelCase(column)])
);

// ---------------------------------------------------------------------------

const KINDS = Object.keys(ACTION_METADATA) as AssistantQuickLinkExecuteAction["kind"][];

describe("the tier vocabulary this guard is built from", () => {
  it("derives tier columns from the migrations rather than a hand-written list", () => {
    // If these stop being found, the derivation broke and every assertion below
    // became vacuous — a guard over an empty forbidden set forbids nothing.
    expect(TIER_COLUMNS.has("claim_status")).toBe(true);
    expect(TIER_COLUMNS.has("source")).toBe(true);
    expect(TIER_VALUES.has("calibrated_to_counts")).toBe(true);
    expect(TIER_VALUES.has("screening_grade")).toBe(true);
  });

  it("does not classify an unrelated status column as a tier column", () => {
    // `outcome IN ('succeeded','failed')` and friends must stay out, or the
    // guard fails on every route and gets deleted rather than heeded.
    expect(TIER_COLUMNS.has("outcome")).toBe(false);
    expect(TIER_COLUMNS.has("status")).toBe(false);
  });
});

describe("no registered action can carry a tier in its payload", () => {
  for (const kind of KINDS) {
    it(`${kind} declares no tier field and no tier value`, () => {
      const branch = assistantApprovalActionSchema.options.find(
        (option) => (option as { shape?: Record<string, unknown> }).shape?.kind !== undefined &&
          (option as { shape: { kind: { safeParse(v: unknown): { success: boolean } } } }).shape.kind.safeParse(kind).success
      );
      expect(branch, `${kind} has no approval schema branch`).toBeDefined();

      const shape = (branch as unknown as { shape: Record<string, unknown> }).shape;
      for (const field of Object.keys(shape)) {
        expect(
          TIER_FIELD_NAMES.has(field) || TIER_FIELD_NAMES.has(field.toLowerCase()),
          `${kind}.${field} names a claim/provenance tier column. An agent may propose evidence, never the grade of it.`
        ).toBe(false);
      }

      // A field could carry a tier value without naming a tier column — an
      // innocuously-named enum whose members are the tier vocabulary.
      const branchSource = JSON.stringify(
        (branch as unknown as { _def?: unknown })._def ?? {},
        (_key, value) => (typeof value === "function" ? undefined : value)
      );
      for (const value of TIER_VALUES) {
        // 'operator' and 'machine' are common English words; only the modeling
        // tiers are distinctive enough to match on the serialized schema without
        // false positives, and they are the ones with an enum to hide in.
        if (!(MODELING_CLAIM_STATUSES as readonly string[]).includes(value)) continue;
        expect(
          branchSource.includes(`"${value}"`),
          `${kind} accepts the tier value "${value}". Evidence decides a claim tier; an agent may not send one.`
        ).toBe(false);
      }
    });
  }
});

describe("no registered action's execution path can write a tier", () => {
  for (const kind of KINDS) {
    it(`${kind} reaches nothing that writes a tier column`, () => {
      const apiPaths = resolveActionApiPaths(kind);
      expect(apiPaths.length, `could not resolve any API path for ${kind}`).toBeGreaterThan(0);

      for (const apiPath of apiPaths) {
        const routeFile = resolveRouteFile(apiPath);
        expect(routeFile, `no route file matched ${apiPath} (for ${kind})`).not.toBeNull();

        /**
         * THE SURFACE IS THE ROUTE PLUS WHAT IT CALLS.
         *
         * Reading `route.ts` alone forbade nothing: every route in this codebase
         * delegates its writes to a lib, so moving `claim_status` one function
         * away — an ordinary refactor — moved it out of the guard entirely.
         * Proven by mutation: making this route call
         * `refreshCountyRunModelingEvidence`, which inserts `claim_status`, left
         * the file-only guard green.
         */
        const chunks = collectAgentReachableSources(routeFile as string);
        expect(
          chunks.length,
          `${routeFile} resolved to no reachable source at all — the walk broke and this guard is vacuous.`
        ).toBeGreaterThan(0);

        for (const chunk of chunks) {
          // RULE 1 — every column name handed to `.insert` / `.update` /
          // `.upsert`, whatever value it is given. Nested keys are inside a jsonb
          // value, not columns: `metadata: { source: … }` is not a provenance
          // tier. Depth is counted character by character, because an
          // indentation-based version silently exempted the FIRST key of every
          // object, and the identifier form (`const row = {…}; …upsert(row)`) is
          // resolved, because that is how a tier assignment escapes a rule that
          // only reads literals.
          for (const column of writtenColumns(chunk.source)) {
            expect(
              TIER_COLUMNS.has(column.toLowerCase()),
              `${chunk.label} writes the tier column "${column}", and ${kind} reaches it. ` +
                "A registered action may not reach anything that can promote a claim or provenance tier."
            ).toBe(false);
          }

          // RULE 2 — anywhere in the reachable source, a tier column assigned one
          // of ITS OWN tier values. This catches a write shape rule 1 cannot see
          // at all, such as an `.rpc()` argument or a row handed through a
          // helper.
          //
          // The value must belong to that column's vocabulary, which is what
          // keeps `metadata: { source: "api.stage_gates.decisions" }` out of it.
          // A `source:` key is only a provenance promotion when it is set to
          // "operator" or "machine".
          for (const match of chunk.source.matchAll(/\b([a-z_][a-z0-9_]*)\s*:\s*["']([^"']+)["']/g)) {
            const column = match[1].toLowerCase();
            if (!TIER_COLUMNS.has(column)) continue;
            const vocabulary = TIER_VOCABULARIES.find((entry) =>
              (entry as readonly string[]).includes(match[2])
            );
            expect(
              Boolean(vocabulary),
              `${chunk.label} assigns the tier column "${column}" the tier value "${match[2]}", and ${kind} ` +
                "reaches it. Evidence decides a tier; nothing an agent can reach may set one."
            ).toBe(false);
          }
        }
      }
    });
  }
});

/**
 * The extraction this guard rests on, exercised on the shapes that defeated the
 * previous version. Without these, a broken walk or a broken key scan would make
 * every assertion above pass by finding nothing.
 */
describe("the write-surface extraction this guard rests on", () => {
  it("reads the first key of an object, not just its siblings", () => {
    expect(topLevelObjectKeys("{\n  claim_status: x,\n  other: y,\n}")).toEqual(["claim_status", "other"]);
  });

  it("ignores keys nested inside a jsonb value", () => {
    expect(topLevelObjectKeys("{\n  metadata: { source: 'api.x' },\n  id: 1,\n}")).toEqual(["metadata", "id"]);
  });

  it("reads a single-line insert", () => {
    expect(writtenColumns('.insert({ claim_status: nextTier })')).toContain("claim_status");
  });

  it("reads an array-of-rows insert", () => {
    expect(writtenColumns('.insert([{ claim_status: "x" }])')).toContain("claim_status");
  });

  it("resolves a row builder handed in by identifier", () => {
    const source = 'const row = { workspace_id: w, claim_status: nextTier };\nawait db.from("t").upsert(row);';
    expect(writtenColumns(source)).toContain("claim_status");
  });

  it("follows a call out of the file it starts in", () => {
    const chunks = collectAgentReachableSources(
      path.join(REPO_ROOT, "src/app/api/stage-gates/decisions/route.ts")
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.label.includes("#"))).toBe(true);
  });
});
