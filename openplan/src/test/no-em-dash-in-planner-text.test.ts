import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { posixRelative } from "./helpers/posix-path";

/**
 * NO EM DASH IN ANYTHING A PLANNER OR THE PUBLIC READS.
 *
 * Nathaniel's rule for every surface: readers take an em dash as a sign of AI
 * writing, so a sentence ends or takes a comma instead. En dashes in number
 * ranges are fine and are not checked here.
 *
 * WHAT IT READS. Every string literal, template literal part and JSX text node
 * under `src/` outside `src/test/`, and every string value in a JSON file there
 * (the work-plan and stage-gate templates are planner copy). It reads them
 * through the TypeScript parser, so a comment never reaches the check: code
 * comments may keep their dashes. String values are read cooked, so a dash
 * written as a backslash-u escape counts, and JSX text is also checked for the
 * `&mdash;` entity.
 *
 * WHAT IT ALLOWS. A string or JSX text that is ONLY the dash, the table glyph
 * for "no value" (`failed ? "—" : count`). That is a mark in a cell, not
 * writing, and it keeps unknown visibly distinct from zero. A dash joining
 * words, even `{" — "}` between two values, is not allowed.
 *
 * BLIND CATEGORIES. Text built at runtime from parts that each pass (`"\u20"
 * + "14"` would pass), text read from the database or an external source,
 * Markdown, CSS `content`, and files outside `src/` (workers, scripts, docs).
 */

const SRC = path.resolve(__dirname, "..");
const TEST_DIR = path.join(SRC, "test");
const EM_DASH = "—";
const ENTITY = /&(mdash|#8212|#x2014);/i;
const ESCAPED = /u\{?0*2014/i;

/** The reason for every string kept because saved work is checked against it. */
const HASHED =
  "Hashed into stored records; changing the text marks saved work stale.";

/**
 * Strings that must keep an em dash, each with a reason a reviewer can check.
 * An entry allows the findings in `file` whose text contains `contains` (an
 * empty `contains` covers the whole file), and there must be exactly `count`
 * of them (default 1): a new dash in a covered file still fails, and so does
 * removing one without lowering the count.
 */
const ALLOWED: ReadonlyArray<{ file: string; contains: string; count?: number; reason: string }> = [
  {
    file: "src/lib/engagement/translation-generation.ts",
    contains: "— it is source text to be translated",
    reason:
      "System prompt of translation recipe version 1, which translation-credentials.ts and three migrations pin " +
      "with z.literal(1). Changing the text would change a versioned recipe without a new version. Not shown to readers.",
  },
  ...[
    ["corridor_study_v0.1.json", "First public workshop — needs and opportunities"],
    ["specific_area_plan_v0.1.json", "Draft plan — land use, mobility, public realm and standards"],
    ["zoning_code_update_v0.1.json", "Module drafts — zones, uses and development standards"],
  ].map(([template, title]) => ({
    file: `src/lib/work-plans/templates/${template}`,
    contains: title,
    reason:
      "Deliverable title. work-plans/apply.ts skips a title the project already has (trimmed, lowercased), so a " +
      "new title would add a duplicate deliverable when the template is applied again to a project that has it.",
  })),
  // Report section facts. factsHash() over these claims is stored with each
  // accepted narrative and recomputed at generation; a changed claim shows
  // "Underlying data changed since acceptance" (narrative-drafts.ts).
  { file: "src/lib/reports/narrative-drafts.ts", contains: "—", count: 3, reason: `Funding posture claims. ${HASHED}` },
  {
    file: "src/lib/models/run-modes.ts",
    contains: "—",
    count: 2,
    reason: `caveatSummary of deterministic_corridor_v1 and behavioral_demand, quoted in report run facts. ${HASHED}`,
  },
  {
    file: "src/lib/grants/engagement-evidence.ts",
    contains: "Community-input statements summarize submitted public comments only —",
    reason:
      "ENGAGEMENT_NARRATIVE_CAVEAT. application-html.ts keeps it on the export cover only while a saved final " +
      `section or its draft contains this exact text. ${HASHED}`,
  },
  // Byte-pinned readiness sources. registry.v1.json pins each file's sha256;
  // the registry hash goes into the readiness payload hash stored with every
  // v4 report packet, and jurisdiction-freshness.ts calls the packet "changed"
  // when it differs. Any edit to these files, dash or not, has that effect.
  ...(
    [
      ["src/lib/grants/programs/us-ca.ts", 20],
      ["src/lib/grants/programs/us-co.ts", 10],
      ["src/lib/grants/programs/us-federal.ts", 21],
      ["src/lib/grants/programs/us-oh.ts", 18],
      ["src/lib/grants/programs/us-or.ts", 23],
      ["src/lib/grants/programs/us-tx.ts", 11],
      ["src/lib/grants/programs/us-wa.ts", 21],
      ["src/lib/safety/sources/ccrs.ts", 1],
      ["src/lib/safety/sources/fars.ts", 1],
    ] as const
  ).map(([file, count]) => ({
    file,
    contains: "",
    count,
    reason: `Pinned by sha256 in jurisdiction-readiness/registry.v1.json. ${HASHED}`,
  })),
];

type Finding = { file: string; line: number; text: string };

function isLonePlaceholder(node: ts.Node, value: string): boolean {
  if (!ts.isJsxText(node)) return value === EM_DASH;
  if (value.trim() !== EM_DASH) return false;
  // `<td>—</td>` is the glyph; `{a} — {b}` is the same text joining two values.
  const parent = node.parent;
  if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) return false;
  const visible = parent.children.filter((child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
  return visible.length === 1;
}

/** Every em dash a reader could see in one file's string and JSX text. */
function emDashesIn(file: string, raw: string): Finding[] {
  const isJson = file.endsWith(".json");
  const source = isJson
    ? ts.parseJsonText(file, raw)
    : ts.createSourceFile(
        file,
        raw,
        ts.ScriptTarget.Latest,
        true,
        /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    let value: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      value = node.text;
    } else if (ts.isJsxText(node)) {
      value = node.text;
    }
    if (value !== null) {
      const hasDash = value.includes(EM_DASH) || (ts.isJsxText(node) && ENTITY.test(value));
      if (hasDash && !isLonePlaceholder(node, value)) {
        // Report the line the dash is on; a JSX text node can start lines earlier.
        const at = Math.max(0, node.getText(source).indexOf(EM_DASH));
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source) + at);
        found.push({ file, line: line + 1, text: value.replace(/\s+/g, " ").trim() });
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

function scannedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === TEST_DIR || entry === "node_modules") continue;
      scannedFiles(full, out);
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|json)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = scannedFiles(SRC);

const FINDINGS = FILES.flatMap((full) => {
  const raw = readFileSync(full, "utf8");
  // A cheap pre-filter, so it must also admit a file whose only dash is an
  // escape (u2014 after a backslash, or `\u{2014}`), which the parser cooks into
  // a dash. The bundled JSON assets are written that way.
  if (!raw.includes(EM_DASH) && !ENTITY.test(raw) && !ESCAPED.test(raw)) return [];
  return emDashesIn(posixRelative(path.dirname(SRC), full), raw);
});

const allowanceMatches = (entry: (typeof ALLOWED)[number], finding: Finding) =>
  entry.file === finding.file && finding.text.includes(entry.contains);

const isAllowed = (finding: Finding) => ALLOWED.some((entry) => allowanceMatches(entry, finding));

describe("planner-facing text carries no em dash", () => {
  it("reads the real tree", () => {
    // A scan that found no files would pass every assertion below.
    expect(FILES.length).toBeGreaterThan(1000);
    expect(FILES.some((file) => file.endsWith(".json"))).toBe(true);
  });

  it("finds no em dash in any string, template or JSX text under src/", () => {
    const offending = FINDINGS.filter((finding) => !isAllowed(finding)).map(
      (finding) => `${finding.file}:${finding.line}  ${finding.text.slice(0, 160)}`
    );
    expect(
      offending,
      "End the sentence or use a comma (a colon or parentheses where that reads better). " +
        "If the text must quote a source verbatim, add it to ALLOWED with a reason."
    ).toEqual([]);
  });

  it("keeps every allowance matching exactly its count", () => {
    const loose = ALLOWED.flatMap((entry) => {
      const matched = FINDINGS.filter((finding) => allowanceMatches(entry, finding)).length;
      const expected = entry.count ?? 1;
      return matched === expected ? [] : [`${entry.file} "${entry.contains}": ${matched} found, ${expected} allowed`];
    });
    expect(loose).toEqual([]);
  });

  it("allows a pinned readiness source only while the registry still pins it", () => {
    // A file-wide allowance is justified by the pin alone, so it must not outlive it.
    const registry = JSON.parse(
      readFileSync(path.join(SRC, "lib/jurisdiction-readiness/registry.v1.json"), "utf8")
    ) as { sources: Array<{ path: string }> };
    const pinned = new Set(registry.sources.map((source) => path.posix.relative("openplan", source.path)));
    const unpinned = ALLOWED.filter((entry) => entry.contains === "" && !pinned.has(entry.file)).map(
      (entry) => entry.file
    );
    expect(unpinned).toEqual([]);
  });
});

describe("the scan sees what a reader sees and nothing else", () => {
  const tsx = (body: string) => emDashesIn("src/components/example.tsx", body);

  it("flags JSX text, naming the file and line", () => {
    const found = tsx(`export const A = () => (\n  <p>\n    Saved — come back later.\n  </p>\n);\n`);
    expect(found).toEqual([{ file: "src/components/example.tsx", line: 3, text: "Saved — come back later." }]);
  });

  it("flags string literals, template parts, escapes and the JSX entity", () => {
    const found = tsx(
      [
        `const a = "one — two";`,
        "const b = `${a} — ${a}`;",
        `const c = "esc \\u2014 aped";`,
        `const D = () => <p>x &mdash; y</p>;`,
        `const E = () => <span>{a} — {a}</span>;`,
      ].join("\n")
    );
    expect(found.map((finding) => finding.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores comments and the lone no-value glyph", () => {
    const found = tsx(
      [
        `// a comment — with a dash`,
        `/** JSDoc — with a dash */`,
        `const n = failed ? "—" : 3;`,
        `const T = () => <td>—</td>;`,
        `const U = () => (\n  <td>\n    —\n  </td>\n);`,
      ].join("\n")
    );
    expect(found).toEqual([]);
  });

  it("reads JSON string values", () => {
    const found = emDashesIn("src/lib/x.json", `{\n  "title": "Workshop — needs",\n  "ok": "Workshop: needs"\n}\n`);
    expect(found).toEqual([{ file: "src/lib/x.json", line: 2, text: "Workshop — needs" }]);
  });
});
