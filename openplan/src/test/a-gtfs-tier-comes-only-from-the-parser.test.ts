/**
 * A GTFS SERVICE-LEVEL TIER IS DECIDED BY THE PARSER AND IS UNREACHABLE FROM ANY
 * PAYLOAD — BY CONSTRUCTION, NOT BY CONVENTION.
 *
 * TWO COLUMNS, AND THEY ARE THE HONEST HALF OF EVERY HEADWAY THIS PRODUCT
 * PRODUCES.
 *
 *   `median_headway_basis` (20260805000007) is a closed CHECK vocabulary of
 *   three values, TWO of which are refusals. A stop with one bus at 06:10 and
 *   one at 18:40 has two served hours in a thirteen-hour span; a median taken
 *   over served hours alone reads "60 minutes", which is a claim of hourly
 *   service the schedule flatly contradicts. `not_determined_span_mostly_
 *   unserved` is the product declining to answer. Promoting it to
 *   `hourly_average_over_span` turns "we cannot say" into a number — on a figure
 *   that gets lifted into a regional transportation plan, a Title VI service-
 *   equity finding, or a transit-priority determination.
 *
 *   `peak_headway_is_lower_bound` is the same rule as a boolean, and it fails in
 *   the more dangerous direction because it fails SILENTLY. Its default is
 *   `true` — the weaker claim — so a row that forgets it under-claims, which is
 *   safe. A row that sets it `false` when the peak hour held one departure turns
 *   a once-a-day stop into "60 minute headway", which reads as hourly service to
 *   every downstream consumer and to every reader of the table it lands in.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE SHARED TIER GUARD.
 * `an-agent-may-not-promote-a-tier.test.ts` now knows about
 * `median_headway_basis` — `GTFS_MEDIAN_HEADWAY_BASES` was added to its
 * `TIER_VOCABULARIES` on 2026-08-06 — but that guard answers one question: can a
 * REGISTERED ASSISTANT ACTION reach a tier write. Today the transit lane has no
 * registered action at all, so the answer is trivially yes-it-is-safe, and it
 * would stay trivially yes right up until the moment someone registers
 * `refresh_gtfs_feed`.
 *
 * The property that actually holds today is stronger and worth pinning while it
 * is still true: THERE IS NO PARAMETER ANYWHERE THROUGH WHICH A BASIS COULD BE
 * SUPPLIED. `writeParsedFeedVersion` takes a `ParsedGtfsFeed` and copies both
 * values off the parser's own derivation. Not "no caller does"; no caller CAN.
 * `persist.ts`'s own header states this in prose ("there is no parameter
 * anywhere in this file through which a caller … could supply either"). Prose is
 * a suggestion a capable successor may reasonably override. This is the fact it
 * has to engage with instead.
 *
 * `peak_headway_is_lower_bound` has no CHECK constraint — it is a boolean — so
 * the shared guard's CHECK-vocabulary derivation cannot see it and never will.
 * That is the general shape of this file's argument: a tier does not stop being
 * a tier because its vocabulary happens to have two values instead of three.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { GTFS_MEDIAN_HEADWAY_BASES } from "@/lib/gtfs/types";

const REPO_ROOT = process.cwd();

/**
 * The two honesty columns, in both spellings.
 *
 * The snake_case names are the columns; the camelCase names are what a request
 * body or a zod schema would call them, because that is the convention every
 * payload in this repository follows. Both are checked, because a field named
 * `medianHeadwayBasis` mapped to `median_headway_basis` one line later is the
 * same breach wearing the other spelling.
 */
const TIER_COLUMNS = ["median_headway_basis", "peak_headway_is_lower_bound"] as const;
const TIER_FIELD_NAMES = [
  ...TIER_COLUMNS,
  ...TIER_COLUMNS.map((column) => column.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase())),
];

/** The value the derivation may reach, per column, and nothing else. */
const ONLY_LEGITIMATE_SOURCE: Record<string, string> = {
  median_headway_basis: "level.medianHeadwayBasis",
  peak_headway_is_lower_bound: "level.peakHeadwayIsLowerBound",
};

/* -------------------------------------------------------------------------- */

function collectSourceFiles(relativeRoot: string): string[] {
  const absolute = path.join(REPO_ROOT, relativeRoot);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const relative = path.join(relativeRoot, entry);
    if (statSync(path.join(REPO_ROOT, relative)).isDirectory()) return collectSourceFiles(relative);
    return /\.tsx?$/.test(entry) ? [relative] : [];
  });
}

function readSource(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function parseSource(relative: string): ts.SourceFile {
  return ts.createSourceFile(
    relative,
    readSource(relative),
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** Every product source file. Tests are excluded; a fixture may say anything. */
const PRODUCT_FILES = collectSourceFiles("src").filter((file) => !file.startsWith("src/test"));

const ROUTE_FILES = PRODUCT_FILES.filter((file) => file.startsWith("src/app/api/"));

/* -------------------------------------------------------------------------- */
/* Every zod shape in the product                                               */
/* -------------------------------------------------------------------------- */

export type ZodShape = { file: string; line: number; keys: string[] };

/**
 * The property names of every `z.object({…})` and `.extend({…})` in the product.
 *
 * WHY ZOD AND NOT "the request body". A route reads its body through a schema in
 * this codebase — every one of them — and zod STRIPS unknown keys, which is the
 * detail that made an earlier guard in this repository vacuous: it asserted an
 * import payload could not set `status`, and passed with the guard removed,
 * because the field never reached the code under test at all. The consequence
 * runs the other way too, and it is the useful one: a field that is not in a
 * schema cannot reach a route no matter what a caller sends. So the schemas ARE
 * the payload surface, and enumerating them is enumerating what any caller — a
 * planner, a script, an assistant action — can supply.
 *
 * `z.discriminatedUnion` and `z.union` are composed of `z.object` calls, so they
 * are covered by construction. A schema built from a computed key would not be,
 * and nothing in this repository builds one.
 */
function collectZodShapes(): ZodShape[] {
  const shapes: ZodShape[] = [];

  for (const file of PRODUCT_FILES) {
    const source = parseSource(file);
    if (!/\bz\./.test(source.text)) continue;

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "object" || node.expression.name.text === "extend") &&
        node.arguments.length >= 1 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const keys: string[] = [];
        for (const property of node.arguments[0].properties) {
          if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
            keys.push(property.name.text);
          }
        }
        shapes.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          keys,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return shapes;
}

const ZOD_SHAPES = collectZodShapes();

/* -------------------------------------------------------------------------- */
/* Every place either column is assigned                                        */
/* -------------------------------------------------------------------------- */

export type TierAssignment = { file: string; line: number; column: string; initializer: string };

/**
 * Every object property in the product whose key is one of the two columns,
 * together with the SOURCE TEXT of what it is being set to.
 *
 * The initializer text is the whole point. A guard that only checked "which
 * files mention the column" would be satisfied by `median_headway_basis:
 * body.basis` sitting in the same row builder it is satisfied by today.
 */
function collectTierAssignments(): TierAssignment[] {
  const assignments: TierAssignment[] = [];

  for (const file of PRODUCT_FILES) {
    const source = parseSource(file);
    if (!TIER_FIELD_NAMES.some((name) => source.text.includes(name))) continue;

    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        (TIER_COLUMNS as readonly string[]).includes(node.name.text)
      ) {
        assignments.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          column: node.name.text,
          initializer: node.initializer.getText(source).trim(),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return assignments;
}

const TIER_ASSIGNMENTS = collectTierAssignments();

/* -------------------------------------------------------------------------- */

describe("the scanners this guard rests on", () => {
  it("finds the product's zod schemas", () => {
    // An empty shape list would make the payload assertion below forbid nothing,
    // which is indistinguishable from a product with no payloads at all.
    expect(ZOD_SHAPES.length).toBeGreaterThan(50);
    expect(ZOD_SHAPES.some((shape) => shape.keys.includes("workspaceId"))).toBe(true);

    // And it reads the transit lane's own schemas specifically, which is where a
    // basis field would most plausibly be added.
    expect(ZOD_SHAPES.some((shape) => shape.file.startsWith("src/app/api/gtfs/"))).toBe(true);
  });

  it("finds the assignments it is about to make claims over", () => {
    // Four: two columns × the route row builder and the stop row builder. Zero
    // is what a broken walk, a renamed column and a wrong root all produce, and
    // every assertion below would pass on zero.
    expect(TIER_ASSIGNMENTS.length).toBe(4);
    for (const column of TIER_COLUMNS) {
      expect(TIER_ASSIGNMENTS.filter((assignment) => assignment.column === column)).toHaveLength(2);
    }
  });
});

describe("no payload anywhere can name a GTFS service-level tier", () => {
  it.each(TIER_FIELD_NAMES)("no zod schema declares %s", (field) => {
    const offenders = ZOD_SHAPES.filter((shape) => shape.keys.includes(field)).map(
      (shape) => `${shape.file}:${shape.line}`
    );

    expect(
      offenders,
      `a request schema accepts "${field}". Both of these columns say HOW STRONG a headway claim is, and both ` +
        "have a weaker value that means the product is declining to answer. A caller that can send one can " +
        "delete that refusal — and the row it lands in is indistinguishable from one the parser derived. " +
        "Evidence decides a tier; a payload may not carry one."
    ).toEqual([]);
  });

  it.each(TIER_FIELD_NAMES)("no API route so much as mentions %s", (field) => {
    /**
     * BROADER THAN THE SCHEMA CHECK, DELIBERATELY.
     *
     * A route could pass a basis to a library without ever putting it in a
     * schema — read off a query string, defaulted from a constant, or threaded
     * through an options object. The route layer has no legitimate business
     * naming either column at all: it hands `runGtfsIngest` a source and gets a
     * result back. So the honest rule at this layer is absence, and absence is
     * cheap to state and impossible to satisfy by accident.
     */
    const offenders = ROUTE_FILES.filter((file) => readSource(file).includes(field));

    expect(
      offenders,
      `an API route names "${field}". Nothing in the route layer decides how strong a headway claim is; the ` +
        "parser does, from the feed. A route that can name it is a route that can eventually set it."
    ).toEqual([]);
  });

  it("keeps the basis vocabulary inside the derivation", () => {
    /**
     * The values, not just the field names. A field called `confidence` whose
     * enum is the basis vocabulary is the same promotion with the label filed
     * off — which is exactly the hole `an-agent-may-not-promote-a-tier.test.ts`
     * closes with its own value scan.
     *
     * Two files may hold these strings: `types.ts`, which IS the vocabulary, and
     * `service-levels.ts`, which is the derivation that chooses between them.
     */
    const allowed = new Set(["src/lib/gtfs/types.ts", "src/lib/gtfs/service-levels.ts"]);

    const offenders: string[] = [];
    for (const file of PRODUCT_FILES) {
      if (allowed.has(file)) continue;
      const source = parseSource(file);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node) && (GTFS_MEDIAN_HEADWAY_BASES as readonly string[]).includes(node.text)) {
          offenders.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} "${node.text}"`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(
      offenders,
      "a basis value is written outside the vocabulary that defines it and the derivation that chooses it. " +
        "The two `not_determined_*` values are the product refusing to state a median headway; a literal " +
        "elsewhere is somebody deciding that refusal from outside the evidence."
    ).toEqual([]);

    // Non-vacuity: the derivation really does contain them, so an empty offender
    // list above means "nowhere else", not "nowhere at all".
    const derivation = readSource("src/lib/gtfs/service-levels.ts");
    for (const basis of GTFS_MEDIAN_HEADWAY_BASES) {
      expect(derivation).toContain(`"${basis}"`);
    }
  });
});

describe("persist writes both columns only from the parsed level", () => {
  it.each(TIER_ASSIGNMENTS)("$file:$line sets $column from the derivation", (assignment) => {
    expect(
      assignment.file,
      `${assignment.column} is written outside src/lib/gtfs/persist.ts. There is exactly one place a derived ` +
        "service level becomes a row, and keeping it that way is what makes the claim below checkable."
    ).toBe("src/lib/gtfs/persist.ts");

    expect(
      assignment.initializer,
      `${assignment.file}:${assignment.line} sets ${assignment.column} to \`${assignment.initializer}\` rather ` +
        `than to \`${ONLY_LEGITIMATE_SOURCE[assignment.column]}\`. A literal, a parameter, or a fallback ` +
        "expression all mean the same thing here: something other than the feed decided how strong this " +
        "claim is. `writeParsedFeedVersion` takes a ParsedGtfsFeed and copies the parser's own answer — that " +
        "is the whole reason a route cannot promote a headway, and it is one edit away from not being true."
    ).toBe(ONLY_LEGITIMATE_SOURCE[assignment.column]);
  });

  it("exposes no parameter through which a caller could supply either", () => {
    /**
     * THE PROPERTY THAT ACTUALLY HOLDS TODAY, asserted at the only place it
     * could stop holding.
     *
     * Every mention of either camelCase name in `persist.ts` must be a read off
     * `level` — the parsed service level being mapped. A third mention is, by
     * elimination, either a new parameter on `WriteParsedFeedVersionParams`, a
     * field on a type a caller constructs, or a local that shadows the
     * derivation. All three are the same breach: a way in.
     */
    const source = parseSource("src/lib/gtfs/persist.ts");

    for (const column of TIER_COLUMNS) {
      const camel = ONLY_LEGITIMATE_SOURCE[column].split(".")[1];
      // The camelCase name really is one of the field names this guard forbids
      // in a payload — otherwise the scan below is looking for the wrong word.
      expect(TIER_FIELD_NAMES).toContain(camel);

      const mentions: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === camel) {
          mentions.push(node.parent.getText(source).replace(/\s+/g, " ").slice(0, 80));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);

      // Two, and both are `level.<name>`. Comments are not identifiers, so the
      // module header's prose about this rule does not count itself.
      expect(mentions, `persist.ts mentions ${camel} in an unexpected place`).toEqual([
        ONLY_LEGITIMATE_SOURCE[column],
        ONLY_LEGITIMATE_SOURCE[column],
      ]);
    }
  });
});
