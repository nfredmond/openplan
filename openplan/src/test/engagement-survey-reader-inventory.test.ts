import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Governance guard (mirrors model-run-kpis-reader-inventory, hardened). The survey
// RESPONSE tables are sensitive + service-role-only. This guard enforces THREE
// invariants across all non-test source and fails CI on any violation:
//   1. CONFINEMENT — the tables may only be touched (via `.from("t")` OR a
//      PostgREST embed `t(...)` inside a .select) in the single reader module.
//   2. READS-ONLY  — inside the reader, every `.from("t")` chain must be a SELECT,
//      never a mutation (.insert/.update/.upsert/.delete).
//   3. SCOPE       — each read's chain (bounded at the next `.from(`/`;` so a
//      batched sibling query cannot lend its filter) must carry .eq("campaign_id").
// A new ad-hoc reader, an embedded read from a non-sensitive parent, a forgotten
// campaign_id filter, or a sensitive write all fail here.
const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set(["test"]);
const SENSITIVE_TABLES = ["engagement_survey_response_sessions", "engagement_survey_answers"] as const;
const ALLOWED_READER = "src/lib/engagement/survey-responses.ts";

const MUTATION_RE = /\.(insert|update|upsert|delete)\(/;
const SELECT_RE = /\.select\(/;
const CAMPAIGN_SCOPE_RE = /\.eq\(["']campaign_id["']\s*,/;

type Violation = { file: string; table: string; kind: "confinement" | "mutation" | "not-select" | "unscoped"; snippet: string };

function collectSourceFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return EXCLUDED_SEGMENTS.has(entry.name) ? [] : collectSourceFiles(fullPath);
      return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
    });
}

function fromMatches(content: string, table: string): number[] {
  return [...content.matchAll(new RegExp(`\\.from\\(["']${table}["']\\)`, "g"))].map((m) => m.index ?? 0);
}
// PostgREST resource embedding: `table(cols)` or `table!inner(cols)` in a select
// string. The `.from("table")` form is excluded (a `"` follows the name, not `(`).
function embedMatches(content: string, table: string): number[] {
  return [...content.matchAll(new RegExp(`\\b${table}\\s*(?:![a-z]+\\s*)?\\(`, "g"))].map((m) => m.index ?? 0);
}

// Chain window for a `.from(` occurrence: to the nearer of the next `;` or the
// next `.from(` — so a sibling query batched in the same statement (Promise.all)
// cannot lend its `.eq("campaign_id")` to an unscoped neighbour.
function forwardChain(content: string, start: number): string {
  const semi = content.indexOf(";", start + 1);
  const nextFrom = content.indexOf(".from(", start + 1);
  const ends = [semi, nextFrom].filter((i) => i !== -1);
  const end = ends.length ? Math.min(...ends) : content.length;
  return content.slice(start, end).replace(/\s+/g, " ");
}

/** Pure analysis of one source file's sensitive-table access. */
export function analyzeSensitiveAccess(file: string, content: string): { touched: Set<string>; violations: Violation[] } {
  const touched = new Set<string>();
  const violations: Violation[] = [];
  for (const table of SENSITIVE_TABLES) {
    const froms = fromMatches(content, table);
    const embeds = embedMatches(content, table);
    if (froms.length || embeds.length) touched.add(table);

    if (file !== ALLOWED_READER) {
      for (const idx of [...froms, ...embeds]) {
        violations.push({ file, table, kind: "confinement", snippet: content.slice(idx, idx + 60).replace(/\s+/g, " ") });
      }
      continue;
    }
    // Inside the reader: each direct .from() must be a campaign-scoped SELECT.
    // (Embeds are read-only and covered by their enclosing .from()'s scope check.)
    for (const idx of froms) {
      const chain = forwardChain(content, idx);
      if (MUTATION_RE.test(chain)) violations.push({ file, table, kind: "mutation", snippet: chain.slice(0, 80) });
      else if (!SELECT_RE.test(chain)) violations.push({ file, table, kind: "not-select", snippet: chain.slice(0, 80) });
      else if (!CAMPAIGN_SCOPE_RE.test(chain)) violations.push({ file, table, kind: "unscoped", snippet: chain.slice(0, 80) });
    }
  }
  return { touched, violations };
}

function analyzeRepo(): { violations: Violation[]; touchedByReader: Set<string> } {
  const violations: Violation[] = [];
  let touchedByReader = new Set<string>();
  for (const fullPath of collectSourceFiles(SOURCE_ROOT)) {
    const rel = path.relative(process.cwd(), fullPath);
    const result = analyzeSensitiveAccess(rel, fs.readFileSync(fullPath, "utf8"));
    violations.push(...result.violations);
    if (rel === ALLOWED_READER) touchedByReader = result.touched;
  }
  return { violations, touchedByReader };
}

describe("engagement survey response reader inventory", () => {
  it("enforces confinement + reads-only + campaign scope on the sensitive tables", () => {
    const { violations } = analyzeRepo();
    expect(violations).toEqual([]);
  });

  it("actually exercises both sensitive tables in the reader (no vacuous pass)", () => {
    const { touchedByReader } = analyzeRepo();
    expect([...touchedByReader].sort()).toEqual([...SENSITIVE_TABLES].sort());
  });

  // ── The guard must FAIL on each escape it exists to catch ──────────────────
  it("catches an embedded read from a non-sensitive parent in another file", () => {
    const { violations } = analyzeSensitiveAccess(
      "src/app/api/whatever/route.ts",
      `const r = await supabase.from("engagement_campaigns").select("id, engagement_survey_answers(answer_text)").eq("id", campaignId);`
    );
    expect(violations.some((v) => v.kind === "confinement" && v.table === "engagement_survey_answers")).toBe(true);
  });

  it("catches a batched read that omits its own campaign_id (no sibling-scope inheritance)", () => {
    const { violations } = analyzeSensitiveAccess(
      ALLOWED_READER,
      `const [a, b] = await Promise.all([
         supabase.from("engagement_survey_answers").select("*"),
         supabase.from("engagement_survey_response_sessions").select("*").eq("campaign_id", campaignId)
       ]);`
    );
    expect(violations.some((v) => v.kind === "unscoped" && v.table === "engagement_survey_answers")).toBe(true);
    // the scoped sibling is fine
    expect(violations.some((v) => v.table === "engagement_survey_response_sessions")).toBe(false);
  });

  it("catches a sensitive-table mutation even inside the reader", () => {
    const { violations } = analyzeSensitiveAccess(
      ALLOWED_READER,
      `await supabase.from("engagement_survey_response_sessions").update({ status: "approved" }).eq("campaign_id", campaignId);`
    );
    expect(violations.some((v) => v.kind === "mutation")).toBe(true);
  });
});
