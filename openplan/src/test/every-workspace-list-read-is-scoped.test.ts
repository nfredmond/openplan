import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectAgentReachableSources } from "./helpers/reachable-write-surface";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * Every read of a workspace-owned table reachable from an (app) page must
 * carry at least one filter. RLS is NOT scoping: the policies grant every
 * workspace the user belongs to, so a filter-free `.from(table).select().order()`
 * merges all of a multi-workspace member's workspaces into one list under a
 * header naming just one — found live on SIX pages at once (/models,
 * /scenarios, /programs, /engagement, /plans, /reports; 2026-08-03 review).
 *
 * Mechanics: workspace-owned tables are derived from the migrations (any
 * table declaring a workspace_id column — same inventory the RLS guards
 * trust), and each page's reachable source is walked through its CALLED
 * imports (the loader-in-a-lib pattern that defeated a file-only guard
 * before), then every `.from("<table>")` method chain is parsed with a
 * balanced-delimiter scan and must include a filter method.
 *
 * Honest limits, so nobody believes this proves more than it does:
 * - "Any filter" is the bar, not ".eq(workspace_id)" specifically — detail
 *   pages legitimately scope by `.eq("id", …)` and children by parent-id
 *   sets. A read filtered ONLY by e.g. status would pass; that shape has
 *   never appeared in the defect class (all six offenders were filter-free).
 * - Queries inside JSX-rendered child server components are NOT walked
 *   (imports are followed only when CALLED as functions). Page-level loading
 *   is the repo convention; if a child component ever grows its own query,
 *   extend the walk before trusting this guard for it.
 * - Builder-variable chains (`let q = …; q = q.eq(…)`) would false-positive;
 *   none exist under (app) today — allowlist with a reason if one appears.
 */

const APP_DIR = path.join(process.cwd(), "src", "app", "(app)");

/**
 * Chains that may stay unscoped, each with its reason. Staleness-checked so
 * the list can only shrink.
 */
const KNOWN_UNSCOPED: ReadonlyArray<{ chain: string; reason: string }> = [
  {
    chain: 'src/app/api/assistant-activity/summary.ts#loadAssistantActivityRows -> .from("assistant_action_executions")',
    reason:
      "builder pattern the scanner cannot follow: `const table = supabase.from(...)` then every query applies " +
      ".eq('workspace_id', params.workspaceId) at summary.ts:87-92 — verified scoped by reading, 2026-08-04",
  },
];

const FILTER_METHODS = new Set([
  "eq",
  "neq",
  "in",
  "is",
  "not",
  "match",
  "filter",
  "or",
  "contains",
  "containedBy",
  "overlaps",
  "like",
  "ilike",
  "likeAllOf",
  "likeAnyOf",
  "textSearch",
  "gt",
  "gte",
  "lt",
  "lte",
]);

function walkDir(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walkDir(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

/** The text of a balanced (...) starting at `openIndex`, or null. */
function balancedParens(source: string, openIndex: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

type FromChain = { table: string; methods: string[] };

/**
 * Position after any run of whitespace and // or block comments. Several
 * real chains carry an explanatory comment BETWEEN `.from()` and `.select()`
 * (the projection-guard note on the projects pickers); a scanner that stops
 * at a comment reports those chains as filter-free — four false positives on
 * this guard's first run.
 */
function skipTrivia(source: string, index: number): number {
  let i = index;
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source.startsWith("//", i)) {
      const newline = source.indexOf("\n", i);
      if (newline === -1) return source.length;
      i = newline + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return source.length;
      i = end + 2;
      continue;
    }
    return i;
  }
}

/** Every `.from("table")` method chain in a source chunk. */
export function extractFromChains(source: string): FromChain[] {
  const chains: FromChain[] = [];
  for (const match of source.matchAll(/\.from\(\s*["'](\w+)["']\s*\)/g)) {
    const methods: string[] = [];
    let cursor = (match.index ?? 0) + match[0].length;
    for (;;) {
      const j = skipTrivia(source, cursor);
      const segment = /^\.\s*(\w+)\s*\(/.exec(source.slice(j));
      if (!segment) break;
      const openIndex = j + segment[0].length - 1;
      const args = balancedParens(source, openIndex);
      if (args === null) break;
      methods.push(segment[1]);
      cursor = openIndex + args.length;
    }
    chains.push({ table: match[1], methods });
  }
  return chains;
}

describe("every workspace-owned list read reachable from an (app) page is scoped", () => {
  const inventory = loadSchemaInventory();
  const workspaceTables = new Set(
    inventory.tables().filter((table) => inventory.hasColumn(table, "workspace_id"))
  );
  const pages = walkDir(APP_DIR);

  it("derives a real table set and a real page set (guard is not vacuous)", () => {
    expect(workspaceTables.size).toBeGreaterThan(30);
    expect(pages.length).toBeGreaterThan(10);
  });

  it("chain extraction parses the shapes it must catch (positive controls)", () => {
    const unscoped = extractFromChains(`supabase.from("plans").select("id, name").order("updated_at", { ascending: false })`);
    expect(unscoped).toEqual([{ table: "plans", methods: ["select", "order"] }]);

    const scoped = extractFromChains(
      `supabase.from("plans").select("id").eq("workspace_id", membership.workspace_id).order("updated_at", { ascending: false })`
    );
    expect(scoped[0].methods).toContain("eq");

    // Parens and quotes inside arguments must not derail the scan.
    const tricky = extractFromChains(
      `client.from("reports").select("id, projects(id, name)").in("campaign_id", ids.map((x) => x.id))`
    );
    expect(tricky[0].methods).toEqual(["select", "in"]);

    // A comment between chain segments must not truncate the chain — this
    // exact shape (the projection-guard note between .from and .select)
    // produced four false positives on this guard's first run.
    const commented = extractFromChains(
      `supabase
        .from("projects")
        // Spelled out rather than interpolating PROJECT_PLACE_COLUMNS: see
        // reference-count-projection-guard.test.ts.
        .select("id, name")
        .eq("workspace_id", workspaceId)`
    );
    expect(commented[0].methods).toEqual(["select", "eq"]);
  });

  it("no filter-free read of a workspace-owned table is reachable from a page", () => {
    const known = new Set(KNOWN_UNSCOPED.map((entry) => entry.chain));
    const offenders = new Set<string>();

    for (const page of pages) {
      for (const chunk of collectAgentReachableSources(page, 3)) {
        for (const { table, methods } of extractFromChains(chunk.source)) {
          if (!workspaceTables.has(table)) continue;
          if (methods.some((method) => FILTER_METHODS.has(method))) continue;
          const label = `${chunk.label} -> .from("${table}")`;
          if (!known.has(label)) offenders.add(label);
        }
      }
    }

    expect([...offenders].sort()).toEqual([]);
  });

  it("every KNOWN_UNSCOPED entry is still real (ratchet: the list only shrinks)", () => {
    const stillPresent = new Set<string>();
    for (const page of pages) {
      for (const chunk of collectAgentReachableSources(page, 3)) {
        for (const { table, methods } of extractFromChains(chunk.source)) {
          if (!workspaceTables.has(table)) continue;
          if (methods.some((method) => FILTER_METHODS.has(method))) continue;
          stillPresent.add(`${chunk.label} -> .from("${table}")`);
        }
      }
    }
    const stale = KNOWN_UNSCOPED.filter((entry) => !stillPresent.has(entry.chain)).map(
      (entry) => entry.chain
    );
    expect(stale).toEqual([]);
  });
});
