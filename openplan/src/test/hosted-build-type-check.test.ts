import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts as Record<string, string>;
const ci = readFileSync(path.join(root, "../.github/workflows/ci.yml"), "utf8");

describe("type checking when the hosted builder skips it", () => {
  it("skips Next's type check only on Vercel's builder", () => {
    const setting = config.match(/ignoreBuildErrors:\s*([^,\n]+)/)?.[1]?.trim();
    expect(setting).toBe('process.env.VERCEL === "1"');
  });

  it("keeps the full type check in the CI gate that Vercel waits for", () => {
    // The QA gate's only TypeScript check is `next build`; CI is not Vercel,
    // so its build still type-checks. If either link breaks, a type error
    // could reach production unchecked.
    expect(scripts["qa:gate"]).toMatch(/npm run build$/);
    expect(scripts.build).toMatch(/next build/);
    expect(ci).toContain("npm run qa:gate");
    expect(ci).not.toMatch(/^\s*VERCEL:\s*["']?1/m);
  });
});
