import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT } from "@/lib/assistant/chat-tools";
import { MAP_FEATURE_LAYER_LIMIT, POSTGREST_MAX_ROWS_PER_REQUEST } from "@/lib/cartographic/layer-disclosure";
import { MODERATION_MAX_ITEMS } from "@/lib/engagement/ai-moderation";
import { SYNTHESIS_MAX_ITEMS } from "@/lib/engagement/ai-synthesis";

/**
 * EVERY READ OF PUBLIC INPUT PAGES, COUNTS, OR STATES A BOUND BELOW THE CAP.
 *
 * PostgREST stops a response at `max_rows` (1,000 here) and reports no error.
 * A read of engagement comments that neither pages nor counts therefore
 * undercounts any campaign above 1,000 comments with nothing looking wrong, and
 * a `.limit()` above 1,000 is cut to 1,000 just as silently. Both shipped: the
 * plan, program, report and RTP pages counted from one request, the
 * representativeness screen asked for 2,000 and the dashboard for 5,000.
 *
 * This reads each `.from("<table>")` chain for the tables below as source text
 * and classifies it. A chain must page (`.range`), count (`head: true`), read
 * one row (`.maybeSingle` / `.single`), write, or carry a `.limit()` whose value
 * is at most 1,000. Anything else must be listed in `BUILT_ELSEWHERE` with the
 * reason it is safe, and every listed entry must still exist.
 *
 * BLIND CATEGORIES. It sees only literal `.from("<table>")` chains in `src/`
 * outside tests: set-returning RPCs, embedded selects and table names held in
 * variables are not read. A chain assembled across statements (`let query =
 * ...; return query.range(...)`) looks unbounded here, which is why the
 * exception list exists. A `.limit()` below 1,000 can still truncate; this
 * guard checks only that the server cap does not truncate it further.
 */

const TABLES = [
  "engagement_items",
  "engagement_closeloop_entries",
  "engagement_item_votes",
  "engagement_subscriptions",
] as const;

/** Named limits a chain may use, by value. An unknown name fails until it is declared here. */
const KNOWN_LIMITS: Record<string, number> = {
  ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT,
  MAP_FEATURE_LAYER_LIMIT,
  MODERATION_MAX_ITEMS,
  SYNTHESIS_MAX_ITEMS,
};

/**
 * Chains that read as unbounded here and are not, keyed `file|table`, with the
 * number of such chains in the file.
 */
const BUILT_ELSEWHERE: Record<string, { count: number; reason: string }> = {
  "src/app/api/engagement/campaigns/[campaignId]/export/route.ts|engagement_items": {
    count: 1,
    reason: "the query is assigned, filtered, then ordered and ranged inside readEveryPage",
  },
  "src/app/api/engage/[shareToken]/submit/route.ts|engagement_items": {
    count: 1,
    reason: "the duplicate-submission check is assigned, filtered, then returned with a small .limit(limit)",
  },
  "src/lib/notifications/engagement.ts|engagement_subscriptions": {
    count: 1,
    reason:
      "enqueueCampaignSubscriberEmails has no production caller since subscriber broadcast moved into SQL (20261014000003)",
  },
};

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * The chain that starts at `start`: up to the bracket that closes its enclosing
 * call, or a `;`, `,` or `:` at its own depth. Comments and string and template
 * literals are skipped whole, so a projection's parentheses and a comment's
 * apostrophes or colons do not count.
 */
function chainAt(source: string, start: number): string {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const close = source.indexOf(char, index + 1);
      index = close < 0 ? source.length : close + 1;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      depth -= 1;
      if (depth < 0) break;
    } else if (depth === 0 && (char === ";" || char === "," || char === ":")) break;
    index += 1;
  }
  return source.slice(start, index);
}

type Verdict = "paged" | "counted" | "single" | "write" | "limited" | "unbounded";

function classifyChain(chain: string): { verdict: Verdict; problem: string | null } {
  if (/\.(insert|update|upsert|delete)\s*\(/.test(chain)) return { verdict: "write", problem: null };
  if (/\.range\s*\(/.test(chain)) return { verdict: "paged", problem: null };
  if (/head:\s*true/.test(chain)) return { verdict: "counted", problem: null };
  if (/\.(maybeSingle|single)\s*\(/.test(chain)) return { verdict: "single", problem: null };
  const limit = chain.match(/\.limit\s*\(\s*([A-Za-z_][A-Za-z0-9_]*|\d+)\s*\)/);
  if (limit) {
    const argument = limit[1];
    const value = /^\d+$/.test(argument) ? Number(argument) : KNOWN_LIMITS[argument];
    if (value === undefined) return { verdict: "limited", problem: `.limit(${argument}) names an undeclared limit` };
    if (value > POSTGREST_MAX_ROWS_PER_REQUEST) {
      return { verdict: "limited", problem: `.limit(${argument}) = ${value} exceeds the 1,000-row server cap` };
    }
    return { verdict: "limited", problem: null };
  }
  return { verdict: "unbounded", problem: "neither pages, counts, reads one row, nor limits" };
}

function scan() {
  const findings: Array<{ key: string; line: number; verdict: Verdict; problem: string | null }> = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    for (const table of TABLES) {
      const needle = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g");
      for (const match of source.matchAll(needle)) {
        const { verdict, problem } = classifyChain(chainAt(source, match.index ?? 0));
        findings.push({
          key: `${relative}|${table}`,
          line: source.slice(0, match.index).split("\n").length,
          verdict,
          problem,
        });
      }
    }
  }
  return findings;
}

describe("engagement comment reads are bounded below the PostgREST row cap", () => {
  const findings = scan();

  it("finds the reads it claims to cover", () => {
    // A scanner that matched nothing would pass every assertion below.
    expect(findings.filter((finding) => finding.key.endsWith("|engagement_items")).length).toBeGreaterThan(30);
    expect(findings.some((finding) => finding.verdict === "paged")).toBe(true);
    expect(findings.some((finding) => finding.verdict === "counted")).toBe(true);
  });

  it("allows no limit above the cap and no undeclared limit", () => {
    const bad = findings.filter((finding) => finding.verdict === "limited" && finding.problem);
    expect(bad.map((finding) => `${finding.key}:${finding.line} ${finding.problem}`)).toEqual([]);
  });

  it("allows no unbounded read outside the listed exceptions, and no stale exception", () => {
    const unbounded = new Map<string, number[]>();
    for (const finding of findings.filter((item) => item.verdict === "unbounded")) {
      unbounded.set(finding.key, [...(unbounded.get(finding.key) ?? []), finding.line]);
    }
    const unexpected = [...unbounded.entries()]
      .filter(([key, lines]) => BUILT_ELSEWHERE[key]?.count !== lines.length)
      .map(([key, lines]) => `${key} lines ${lines.join(", ")}`);
    expect(unexpected).toEqual([]);
    const stale = Object.keys(BUILT_ELSEWHERE).filter((key) => !unbounded.has(key));
    expect(stale).toEqual([]);
  });
});

describe("the chain reader", () => {
  it("stops at the call that encloses the chain and skips projection parentheses", () => {
    const source = `readEveryPage((a, b) => db.from("engagement_items").select("id, x!inner(y)").range(a, b)); next.limit(5000);`;
    const chain = chainAt(source, source.indexOf(".from("));
    expect(chain).toBe(`.from("engagement_items").select("id, x!inner(y)").range(a, b)`);
    expect(classifyChain(chain).verdict).toBe("paged");
  });

  it("reads through comments that hold apostrophes and colons", () => {
    const source = `db.from("engagement_items").select("id")
  // the builder's order: total
  .order("id").range(a, b);`;
    expect(classifyChain(chainAt(source, source.indexOf(".from("))).verdict).toBe("paged");
  });

  it("separates the items of a Promise.all", () => {
    const source = `[ids.length ? db.from("engagement_items").select("campaign_id").in("c", ids) : none, db.from("x").range(0, 1)]`;
    expect(classifyChain(chainAt(source, source.indexOf(".from("))).verdict).toBe("unbounded");
  });

  it("refuses a limit above the server cap", () => {
    expect(classifyChain(`.from("engagement_items").select("id").limit(2000)`).problem).toMatch(/exceeds/);
    expect(classifyChain(`.from("engagement_items").select("id").limit(1000)`).problem).toBeNull();
    expect(classifyChain(`.from("engagement_items").select("id").limit(SOME_CAP)`).problem).toMatch(/undeclared/);
  });
});
