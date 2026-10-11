/**
 * Transit service claims come from timetable derivation, not request fields.
 * A sparse timetable must keep its lower-bound and undetermined-headway labels.
 * The private saved-parser decoder also names those fields so a worker can
 * recover verified parser output. Its schema is not a user input contract.
 *
 * This source guard scans literal schemas, API references and row assignments.
 * It is not a complete data-flow proof. Parser, artifact custody and publication
 * tests separately check the saved bytes and their use by the worker.
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

export type ZodShape = { file: string; line: number; keys: string[]; binding: string | null };

/**
 * The property names of every `z.object({…})` and `.extend({…})` in the product.
 *
 * Request schemas may strip unknown fields, so a payload test can pass without
 * exercising the intended refusal. Scan schema declarations as well. Saved
 * parser output has one explicit private-schema exception, checked below;
 * these declarations alone do not prove where all runtime values originate.
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
        let owner: ts.Node | undefined = node;
        while (owner && !ts.isVariableDeclaration(owner)) owner = owner.parent;
        shapes.push({
          file,
          binding: owner && ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) ? owner.name.text : null,
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

const PARSER_ARTIFACT = "src/lib/gtfs/parsed-artifact.ts";

describe("user payloads cannot name a GTFS service-level tier", () => {
  it("keeps the saved-parser schema private and its decoder in the publication worker", () => {
    const consumers = PRODUCT_FILES.filter(file => file !== PARSER_ARTIFACT && readSource(file).includes("parsed-artifact"));
    expect(consumers).toEqual(["src/lib/gtfs/managed-worker-publication.ts"]);
    const exported = parseSource(PARSER_ARTIFACT).statements.filter(node =>
      ts.isExportDeclaration(node) || (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)));
    expect(exported.map(node => ts.isFunctionDeclaration(node) ? node.name?.text : "other export")).toEqual(["decodeGtfsParsedArtifact"]);
    const levels = ZOD_SHAPES.filter(shape => shape.file === PARSER_ARTIFACT && shape.binding === "level");
    expect(levels).toHaveLength(1);
    expect(levels[0].keys).toContain("medianHeadwayBasis");
    expect(levels[0].keys).toContain("peakHeadwayIsLowerBound");
  });
  it.each(TIER_FIELD_NAMES)("no request-capable zod schema declares %s", (field) => {
    const offenders = ZOD_SHAPES.filter((shape) => shape.keys.includes(field)
      && !(shape.file === PARSER_ARTIFACT && shape.binding === "level")).map(
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
