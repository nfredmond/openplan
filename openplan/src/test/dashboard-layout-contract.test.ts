import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function balancedBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  expect(open).toBeGreaterThan(start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`unclosed CSS block for ${marker}`);
}

function balancedBlocks(source: string, marker: string): string[] {
  const blocks: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    const relativeStart = source.slice(offset).indexOf(marker);
    if (relativeStart < 0) break;
    const start = offset + relativeStart;
    const block = balancedBlock(source.slice(start), marker);
    blocks.push(block);
    offset = start + marker.length + block.length;
  }
  return blocks;
}

describe("dashboard layout contracts", () => {
  const cartographic = read("src/app/cartographic.css");
  const globals = read("src/app/globals.css");
  const header = read("src/components/cartographic/cartographic-header.tsx");
  const dashboard = read("src/app/(app)/dashboard/page.tsx");

  it("keeps the wide header in workspace, spacer, search, appearance order", () => {
    expect(ruleBody(cartographic, ".op-cart-hdr")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*22rem\)\s+minmax\(0,\s*1fr\)\s+minmax\(200px,\s*520px\)\s+auto/
    );
    expect(ruleBody(cartographic, ".op-cart-hdr > .op-cart-pill:first-child")).toMatch(
      /max-width:\s*22rem/
    );

    const workspace = header.indexOf('<div className="op-cart-pill">');
    const spacer = header.indexOf('<div className="op-cart-hdr__spacer"');
    const search = header.indexOf('className="op-cart-pill op-cart-search"');
    const appearance = header.indexOf('className="op-cart-hdr__actions"');
    expect([workspace, spacer, search, appearance].every((index) => index >= 0)).toBe(true);
    expect(workspace).toBeLessThan(spacer);
    expect(spacer).toBeLessThan(search);
    expect(search).toBeLessThan(appearance);
  });

  it("preserves the condensed three-column header below 1120px", () => {
    const condensed = balancedBlock(cartographic, "@media (max-width: 1120px)");
    expect(ruleBody(condensed, ".op-cart-hdr")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*0\.7fr\)\s+minmax\(160px,\s*1fr\)\s+auto/
    );
    expect(ruleBody(condensed, ".op-cart-hdr__spacer")).toMatch(/display:\s*none/);
  });

  it("puts Needs you and Coming up side by side on wide screens, top-aligned", () => {
    // October 10, 2026 (docs/reviews/2026-10-10-ui-overhaul/PLAN.md, section 3):
    // the two lists that answer "what do I owe" lead the page together.
    expect(dashboard).toContain('className="dashboard-lead"');
    expect(dashboard.indexOf("<NeedsYouList")).toBeLessThan(dashboard.indexOf("<ComingUpRail"));
    expect(dashboard.indexOf("<ComingUpRail")).toBeLessThan(dashboard.indexOf("<DashboardInsights"));
    const wide = balancedBlocks(globals, "@media (min-width: 1024px)").find((block) =>
      block.includes(".dashboard-lead")
    );
    expect(wide, "missing the wide dashboard-lead rule").toBeDefined();
    const lead = ruleBody(wide ?? "", ".dashboard-lead");
    expect(lead).toMatch(/grid-template-columns:/);
    expect(lead).toMatch(/align-items:\s*start/);
  });

});
