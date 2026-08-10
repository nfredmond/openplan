import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page names its own browser tab, and none of them restates the product.
 *
 * Two live defects motivated this, both invisible from inside the app and both
 * shipped:
 *
 * 1. 28 of the 32 signed-in pages declared no `metadata` at all, so every tab
 *    fell back to the root layout's default — "OpenPlan | Free, open-source
 *    planning software". A planner with a project, its grant, and the report
 *    being drafted about it open at once saw three identical tabs.
 *
 * 2. Every page that DID set a title spelled the product name into it, while
 *    the root layout ALSO appends it through `title.template: "%s · OpenPlan"`.
 *    The result rendered as "Command Center · OpenPlan · OpenPlan", and on the
 *    four public pages — privacy, terms, contact, legal — the doubled name was
 *    shown to anyone who visited, not just to signed-in staff.
 *
 * The second is the reason this guard reads titles rather than merely counting
 * them: a page can satisfy "has a title" and still be wrong in a way nobody
 * notices, because a tab is the one part of a page its own author never looks
 * at.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

function collectPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectPageFiles(full));
    } else if (entry === "page.tsx") {
      found.push(full);
    }
  }
  return found;
}

const ALL_PAGES = collectPageFiles(APP_DIR);

function relative(file: string) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

/**
 * A page that only redirects renders no document, so it has no tab to name.
 * `/billing` is the standing example: it forwards saved deep links to
 * `/invoicing` and returns nothing. The test is structural — the module's
 * default export must call `redirect(...)` and the file must render no JSX —
 * rather than an allowlist of paths, so a redirect stub that later grows a real
 * page falls back under the rule automatically.
 */
function isRedirectOnlyPage(source: string) {
  return /\bredirect\(/.test(source) && !/return\s*\(?\s*</.test(source);
}

function declaresTitle(source: string) {
  return (
    /export\s+const\s+metadata\b/.test(source) ||
    /export\s+(async\s+)?function\s+generateMetadata\b/.test(source)
  );
}

/**
 * A record's title lives in the `layout.tsx` of the segment that owns its id,
 * not in `page.tsx` — every page beneath `projects/[projectId]` is about the
 * same project, and Next.js lets a nested page add its own section on top.
 *
 * The walk stops BELOW `src/app/(app)`, deliberately. The group layout wraps
 * every signed-in page, so a title declared there would satisfy this test for
 * all thirty of them at once and put the original defect straight back.
 */
function anAncestorSegmentDeclaresTitle(pageFile: string) {
  const groupRoot = path.join(APP_DIR, "(app)");
  let dir = path.dirname(pageFile);

  while (dir.startsWith(groupRoot) && dir !== groupRoot) {
    const layout = path.join(dir, "layout.tsx");
    if (existsSync(layout) && declaresTitle(readFileSync(layout, "utf8"))) return true;
    dir = path.dirname(dir);
  }

  return false;
}

describe("every page titles its own tab", () => {
  it("finds the app router pages (a broken walk would pass everything else vacuously)", () => {
    expect(ALL_PAGES.length).toBeGreaterThan(30);
    expect(ALL_PAGES.map(relative)).toContain("src/app/(app)/projects/page.tsx");
    expect(ALL_PAGES.map(relative)).toContain("src/app/(public)/privacy/page.tsx");
  });

  it("declares a title on every signed-in page", () => {
    const untitled: string[] = [];

    for (const file of ALL_PAGES) {
      const rel = relative(file);
      if (!rel.includes("/(app)/")) continue;

      const source = readFileSync(file, "utf8");
      if (isRedirectOnlyPage(source)) continue;

      if (!declaresTitle(source) && !anAncestorSegmentDeclaresTitle(file)) {
        untitled.push(rel);
      }
    }

    expect(
      untitled,
      `These pages fall back to the root layout's default title, so their browser tab is indistinguishable from every other tab. ` +
        `Add \`export const metadata = moduleMetadata("<Module>")\` (or \`generateMetadata\` with \`recordMetadata\` for a record page) from @/lib/ui/page-title:\n` +
        untitled.map((f) => `  - ${f}`).join("\n")
    ).toEqual([]);
  });

  it("never spells the product name into a page title", () => {
    const offenders: string[] = [];

    for (const file of ALL_PAGES) {
      const source = readFileSync(file, "utf8");

      // Only the `title:` property, and only its literal value. A page is free
      // to say "OpenPlan" in its description, its body, or a comment.
      for (const match of source.matchAll(/\btitle:\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) {
        if (/openplan/i.test(match[2])) {
          offenders.push(`${relative(file)} — title: "${match[2]}"`);
        }
      }
    }

    expect(
      offenders,
      `The root layout appends the product name through \`title.template: "%s · OpenPlan"\`, so a title that also contains it renders doubled — ` +
        `"Command Center · OpenPlan · OpenPlan". Drop the product name from the title itself:\n` +
        offenders.map((f) => `  - ${f}`).join("\n")
    ).toEqual([]);
  });

  it("keeps the root layout's title template, which every page above depends on", () => {
    const layout = readFileSync(path.join(APP_DIR, "layout.tsx"), "utf8");

    // If this template is removed or renamed, every page title in the app
    // silently loses the product name instead of failing anywhere visible.
    expect(layout).toMatch(/template:\s*["'`]%s · OpenPlan["'`]/);
  });
});
