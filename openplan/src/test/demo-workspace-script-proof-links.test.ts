import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");
const demoScriptPath = path.join(repoRoot, "docs/sales/2026-05-01-openplan-demo-workspace-script.md");
const demoScript = readFileSync(demoScriptPath, "utf8");

function numberedDemoSections(markdown: string) {
  const headingPattern = /^###\s+(\d+)\.\s+(.+)$/gm;
  const matches = [...markdown.matchAll(headingPattern)];

  return matches.map((match, index) => {
    const nextMatch = matches[index + 1];
    const start = match.index ?? 0;
    const end = nextMatch?.index ?? markdown.length;

    return {
      index: Number(match[1]),
      title: match[2],
      body: markdown.slice(start, end),
    };
  });
}

describe("demo workspace script proof links", () => {
  it("names a proof artifact and caveat boundary for every demo step", () => {
    const sections = numberedDemoSections(demoScript);

    expect(sections.map((section) => section.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (const section of sections) {
      expect(section.body, `${section.title} is missing a proof artifact block`).toMatch(/Proof artifact:\n\n- \[/);
      expect(section.body, `${section.title} is missing a caveat boundary block`).toMatch(/Caveat boundary:\n\n- /);
    }
  });

  it("keeps every local evidence link resolvable from the sales doc", () => {
    const links = [...demoScript.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);

    expect(links.length).toBeGreaterThanOrEqual(12);

    for (const link of links) {
      const target = link.split("#")[0];

      if (!target || /^https?:/i.test(target) || /^mailto:/i.test(target)) {
        continue;
      }

      const resolved = path.resolve(path.dirname(demoScriptPath), target);
      expect(existsSync(resolved), `${link} should resolve from demo script`).toBe(true);
    }
  });

  it("preserves buyer-safe product truth in the operator script", () => {
    expect(demoScript).toContain("Apache-2.0 open-source planning software");
    expect(demoScript).toContain("Nat Ford managed hosting, onboarding, implementation, support, and planning services");
    expect(demoScript).toContain("supervised planning workbench demo, not a fully self-serve municipal SaaS");
    expect(demoScript).toContain("Do not describe the demo as validated behavioral forecasting");
    expect(demoScript).toContain("no fresh same-cycle paid canary is claimed");
    expect(demoScript).toContain("not promised globally");
  });
});
