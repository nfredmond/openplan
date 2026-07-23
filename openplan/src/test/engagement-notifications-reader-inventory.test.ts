import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Governance guard: engagement_subscriptions + engagement_email_outbox hold
// participant EMAIL ADDRESSES (sensitive PII) and are service-role-only (RLS on,
// zero policies, REVOKE). They may be touched — via `.from("t")` or a PostgREST
// embed `t(...)` in a .select — ONLY by the single notifications lib module. A
// new ad-hoc reader/writer or an embedded read from another module fails here.
const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXCLUDED_SEGMENTS = new Set(["test"]);
const SENSITIVE_TABLES = ["engagement_subscriptions", "engagement_email_outbox"] as const;
const ALLOWED_READER = "src/lib/notifications/engagement.ts";

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

function fromMatches(content: string, table: string): boolean {
  return new RegExp(`\\.from\\(["']${table}["']\\)`).test(content);
}
// PostgREST embed `table(cols)` / `table!inner(cols)`; the `.from("table")` form
// is excluded (a quote follows the name, not a paren).
function embedMatches(content: string, table: string): boolean {
  return new RegExp(`\\b${table}\\s*(?:![a-z]+\\s*)?\\(`).test(content.replace(new RegExp(`\\.from\\(["']${table}["']\\)`, "g"), ""));
}

export function analyzeSensitiveAccess() {
  const files = collectSourceFiles(SOURCE_ROOT);
  const offenders: { file: string; table: string }[] = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    if (rel === ALLOWED_READER) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const table of SENSITIVE_TABLES) {
      if (fromMatches(content, table) || embedMatches(content, table)) {
        offenders.push({ file: rel, table });
      }
    }
  }
  return offenders;
}

describe("engagement notifications reader-inventory (sensitive PII confinement)", () => {
  it("confines engagement_subscriptions + engagement_email_outbox to the notifications lib", () => {
    expect(analyzeSensitiveAccess()).toEqual([]);
  });

  it("the allowed reader actually exists and touches both tables", () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), ALLOWED_READER), "utf8");
    for (const table of SENSITIVE_TABLES) {
      expect(content.includes(`.from("${table}")`)).toBe(true);
    }
  });

  it("catches a synthetic escape (guard is not vacuous)", () => {
    const rogue = `const x = supabase.from("engagement_subscriptions").select("email");`;
    expect(fromMatches(rogue, "engagement_subscriptions")).toBe(true);
  });
});
