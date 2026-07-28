import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { harnessTextFiles, locateHarnessDir } from "./qa-harness-location-helpers";

/**
 * REGRESSION GUARD — the QA harness must not write around the product.
 *
 * The harness holds a Supabase service-role key, which bypasses RLS entirely.
 * That is legitimate for reading and for cleanup, and it is a trap for setup:
 * the moment a smoke writes a row the product itself cannot write, the smoke
 * starts proving something the product cannot do.
 *
 * That is exactly what happened. Three cartographic-backdrop layers —
 * `project_corridors`, `projects.latitude/longitude`, and
 * `rtp_cycles.anchor_latitude/_longitude` — had no write route anywhere in the
 * product. Their only author was a demo seed. When the seed was deleted, the
 * honest thing happened first: the harness declared the gap in a required
 * argument instead of hiding it, which is how it became visible at all.
 *
 * Now the routes exist, so the declarations should be gone. This guard makes
 * their absence a tested property rather than a thing someone remembers.
 *
 * It is NOT a ban on the helpers. It bans SILENT use: if a genuine gap appears
 * again, add the call site here with a reason, and this test becomes the list
 * of everything the product still cannot do for itself.
 */

const HARNESS_DIR = locateHarnessDir();

/**
 * Call sites permitted to write with the service-role key, and why.
 *
 * Empty is the goal state and the current state. An entry here is a debt, not
 * a decision: it says the product cannot do something its own QA needs done.
 */
const DECLARED_SERVICE_ROLE_WRITES: Record<string, string> = {};

/** `restInsert(` / `restUpdate(` used as a call, not defined or documented. */
const WRITE_CALL_PATTERN = /(?<![\w.])(restInsert|restUpdate)\s*\(/g;

function isDefinitionOrDoc(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("async function") ||
    trimmed.startsWith("function") ||
    // Destructuring the helpers off the client is not a write.
    /^const\s*\{[^}]*\}\s*=\s*createRestClient/.test(trimmed)
  );
}

/**
 * Blank out string and template-literal contents before scanning.
 *
 * The helpers' own error messages read `restInsert("${table}") requires ...`,
 * which is text ABOUT a call, not a call. Without this the guard flags the
 * very code that enforces the rule — and the natural fix, exempting the file
 * that defines the helpers, would blind the scan to a real call inside it.
 */
function stripStringLiterals(line: string): string {
  return line.replace(/`[^`]*`|"[^"]*"|'[^']*'/g, '""');
}

function findWriteCallSites(): string[] {
  const sites: string[] = [];

  for (const file of harnessTextFiles()) {
    if (!file.endsWith(".js")) continue;
    const relative = path.relative(HARNESS_DIR, file);
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, index) => {
      if (isDefinitionOrDoc(line)) return;
      WRITE_CALL_PATTERN.lastIndex = 0;
      if (WRITE_CALL_PATTERN.test(stripStringLiterals(line))) {
        sites.push(`${relative}:${index + 1}`);
      }
    });
  }

  return sites.sort();
}

describe("the QA harness writes through the product, not around it", () => {
  it("has no undeclared service-role writes", () => {
    const undeclared = findWriteCallSites().filter(
      (site) => !(site.split(":")[0] in DECLARED_SERVICE_ROLE_WRITES)
    );
    expect(undeclared).toEqual([]);
  });

  /**
   * The three backdrop layers by name. Even if the helpers were renamed or the
   * call-site scan drifted, a smoke that goes back to writing these tables
   * directly fails here.
   */
  it("never writes the cartographic-backdrop columns directly — they have routes now", () => {
    const BACKDROP_WRITES: Array<{ pattern: RegExp; why: string }> = [
      {
        pattern: /rest\/v1\/project_corridors/,
        why: "project_corridors has POST /api/projects/{id}/corridors",
      },
      {
        pattern: /restInsert\(\s*['"]project_corridors['"]/,
        why: "project_corridors has POST /api/projects/{id}/corridors",
      },
      {
        pattern: /restUpdate\(\s*['"]projects['"][\s\S]{0,200}?latitude/,
        why: "projects.latitude/longitude has PATCH /api/projects/{id}/location",
      },
      {
        pattern: /restUpdate\(\s*['"]rtp_cycles['"][\s\S]{0,200}?anchor_latitude/,
        why: "rtp_cycles anchors have PATCH /api/rtp-cycles/{id}",
      },
    ];

    const offenders: string[] = [];
    for (const file of harnessTextFiles()) {
      if (!file.endsWith(".js")) continue;
      const source = readFileSync(file, "utf8");
      for (const { pattern, why } of BACKDROP_WRITES) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(HARNESS_DIR, file)} → ${why}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the declaration list honest — no stale entries", () => {
    const actualFiles = new Set(findWriteCallSites().map((site) => site.split(":")[0]));
    const stale = Object.keys(DECLARED_SERVICE_ROLE_WRITES).filter((file) => !actualFiles.has(file));
    expect(stale).toEqual([]);
  });

  it("guards the guard — the scan reads real harness scripts and can see a write", () => {
    const scripts = harnessTextFiles().filter((file) => file.endsWith(".js"));
    expect(scripts.length).toBeGreaterThanOrEqual(18);
    expect(scripts.some((file) => file.endsWith("local-spine-smoke.js"))).toBe(true);

    // The pattern must match a real call and ignore the definition and its docs.
    expect(isDefinitionOrDoc("   * Direct insert. Legitimate ONLY for a table")).toBe(true);
    expect(isDefinitionOrDoc("  async function restInsert(table, payload, reason) {")).toBe(true);

    // A real call is caught...
    WRITE_CALL_PATTERN.lastIndex = 0;
    expect(
      WRITE_CALL_PATTERN.test(stripStringLiterals("    const rows = await restInsert('project_corridors', [], 'why');"))
    ).toBe(true);

    // ...while the helper's own error message, which merely names the call, is not.
    WRITE_CALL_PATTERN.lastIndex = 0;
    expect(
      WRITE_CALL_PATTERN.test(
        stripStringLiterals('      `restInsert("${table}") requires an explicit reason naming the write route.`')
      )
    ).toBe(false);
  });
});
