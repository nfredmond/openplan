import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { stripSourceComments } from "./helpers/source-text";

/**
 * SENSITIVE-PII CONFINEMENT — who may name `engagement_subscriptions` and
 * `engagement_email_outbox`.
 *
 * Both tables hold members of the public's EMAIL ADDRESSES. They are
 * service-role-only (RLS on, zero policies, REVOKEd from anon and authenticated
 * in 20260722000009), and the posture only holds if the set of modules that can
 * reach them stays small enough to review. This guard is that review, executed:
 * a `.from("t")` or a PostgREST embed `t(...)` anywhere outside the inventory
 * below fails the build.
 *
 * ================================ WHY THE INVENTORY IS A RECORD, NOT A CONST
 *
 * It was a single `const ALLOWED_READER = "src/lib/notifications/engagement.ts"`
 * until 2026-08-11, when the notifications lib gained a SECOND module — the
 * daily deadline sweep (`work.ts`), which sends a digest email and therefore
 * lives in the outbox lane. A single string cannot express two facts about two
 * modules, so the next person's cheapest move would have been to widen the
 * string and delete the reason with it.
 *
 * The record carries three things a string could not:
 *
 *   1. WHICH TABLES each path may name — not "is it allowed" but "allowed to
 *      touch what". `work.ts` may name NEITHER: it reaches the outbox through
 *      `engagement.ts`'s `enqueueEmail` export, and the test below pins that
 *      indirection. The moment it grows its own `.from("engagement_email_outbox")`
 *      this file fails, which is the whole point of listing a module that is
 *      allowed to name nothing.
 *   2. WHY, in a sentence, beside the permission rather than in a commit message.
 *   3. A STALENESS HALF. An entry that no longer describes the file fails, so
 *      the inventory can only shrink — the KNOWN_UNWIRED ratchet's shape,
 *      applied to a privilege instead of to a gap.
 *
 * ============================================= COMMENTS ARE STRIPPED FIRST
 *
 * The embed pattern is `name(` — and a comment reading "writes an
 * engagement_email_outbox (campaign_id NULL) row" matches it exactly. This
 * repo has broken five guards in both directions by letting prose reach a
 * matcher, which is why `stripSourceComments` exists and why it is used here:
 * a guard about the CODE must read the code. A module that explains the seam it
 * uses must not be punished for explaining it.
 */
const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set(["test"]);
const SENSITIVE_TABLES = ["engagement_subscriptions", "engagement_email_outbox"] as const;

type SensitiveTable = (typeof SENSITIVE_TABLES)[number];

type SensitiveAccessEntry = {
  /** The tables this path may name directly. Empty = it may name none. */
  mayName: readonly SensitiveTable[];
  /**
   * The export it must reach the lane through, when it may name nothing
   * itself. Null for the module that owns the tables.
   */
  reachesThrough: string | null;
  reason: string;
};

export const SENSITIVE_ACCESS_INVENTORY: Record<string, SensitiveAccessEntry> = {
  "src/lib/notifications/engagement.ts": {
    mayName: SENSITIVE_TABLES,
    reachesThrough: null,
    reason:
      "Owns both tables. Every read and write of a participant's email address happens here, " +
      "with the service role, so the confinement is reviewable by reading one file.",
  },
  "src/lib/notifications/work.ts": {
    mayName: [],
    reachesThrough: "enqueueEmail",
    reason:
      "The daily deadline digest. It sends email and so belongs to this lane, but it records " +
      "nothing itself: every message goes through engagement.ts's enqueueEmail, which writes the " +
      "outbox row before attempting delivery and marks it skipped when no transport is " +
      "configured. campaign_id is NULL — a deadline reminder is not a public-engagement " +
      "broadcast and must not be attributed to a campaign. Listed here so the INDIRECTION is " +
      "pinned rather than merely conventional.",
  },
};

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

export function fromMatches(content: string, table: string): boolean {
  return new RegExp(`\\.from\\(["']${table}["']\\)`).test(content);
}
// PostgREST embed `table(cols)` / `table!inner(cols)`; the `.from("table")` form
// is excluded (a quote follows the name, not a paren).
export function embedMatches(content: string, table: string): boolean {
  return new RegExp(`\\b${table}\\s*(?:![a-z]+\\s*)?\\(`).test(content.replace(new RegExp(`\\.from\\(["']${table}["']\\)`, "g"), ""));
}

/** Does this source NAME the table — in code, ignoring anything written about it. */
export function namesTable(source: string, table: string): boolean {
  const code = stripSourceComments(source);
  return fromMatches(code, table) || embedMatches(code, table);
}

export function analyzeSensitiveAccess() {
  const files = collectSourceFiles(SOURCE_ROOT);
  const offenders: { file: string; table: string }[] = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    const allowed = SENSITIVE_ACCESS_INVENTORY[rel]?.mayName ?? [];
    const content = fs.readFileSync(file, "utf8");
    for (const table of SENSITIVE_TABLES) {
      if (allowed.includes(table)) continue;
      if (namesTable(content, table)) offenders.push({ file: rel, table });
    }
  }
  return offenders;
}

function readEntry(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("engagement notifications reader-inventory (sensitive PII confinement)", () => {
  it("confines engagement_subscriptions + engagement_email_outbox to the inventory", () => {
    expect(analyzeSensitiveAccess()).toEqual([]);
  });

  it("every inventory entry still describes the file it names", () => {
    // The ratchet's staleness half. A privilege granted for a reason that no
    // longer exists is exactly the kind of allowance nobody re-reads.
    const stale: string[] = [];
    for (const [rel, entry] of Object.entries(SENSITIVE_ACCESS_INVENTORY)) {
      const source = readEntry(rel);
      for (const table of entry.mayName) {
        if (!namesTable(source, table)) stale.push(`${rel} no longer names ${table}`);
      }
      if (entry.mayName.length === 0) {
        // A module allowed to name NOTHING earns its place by using the seam.
        // Without this, the entry would be an unexplained line nobody could
        // date — and, worse, a free pass waiting to be widened.
        if (!entry.reachesThrough) {
          stale.push(`${rel} names no table and declares no seam it reaches the lane through`);
        } else if (!stripSourceComments(source).includes(`${entry.reachesThrough}(`)) {
          stale.push(`${rel} no longer calls ${entry.reachesThrough}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it("the owning module is the only one that may name either table", () => {
    const owners = Object.entries(SENSITIVE_ACCESS_INVENTORY)
      .filter(([, entry]) => entry.mayName.length > 0)
      .map(([rel]) => rel);
    expect(owners).toEqual(["src/lib/notifications/engagement.ts"]);
  });

  it("catches a synthetic escape (guard is not vacuous)", () => {
    const rogue = `const x = supabase.from("engagement_subscriptions").select("email");`;
    expect(namesTable(rogue, "engagement_subscriptions")).toBe(true);
    // The embed form, which is how a JOIN would leak the same addresses.
    expect(namesTable(`select("id, engagement_email_outbox(to_email)")`, "engagement_email_outbox")).toBe(true);
  });

  it("reads code, not prose — in both directions", () => {
    // A comment naming the table must NOT flag the file …
    expect(namesTable(`// writes an engagement_email_outbox (campaign_id NULL) row\n`, "engagement_email_outbox")).toBe(
      false
    );
    expect(
      namesTable(`/* .from("engagement_subscriptions") is forbidden here */\n`, "engagement_subscriptions")
    ).toBe(false);
    // … and a comment must not EXCUSE one either: real code on the next line
    // is still found.
    expect(
      namesTable(
        `// never do this:\nconst x = supabase.from("engagement_subscriptions").select("email");`,
        "engagement_subscriptions"
      )
    ).toBe(true);
  });
});
