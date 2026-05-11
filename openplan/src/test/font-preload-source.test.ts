import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync("src/app/layout.tsx", "utf8");
const globalsSource = readFileSync("src/app/globals.css", "utf8");

function rootTokenBlock(source: string) {
  const match = source.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/);
  return match?.groups?.body ?? "";
}

describe("font preload source wiring", () => {
  it("uses one Space Grotesk next/font variable for both display and body text", () => {
    expect(layoutSource.match(/Space_Grotesk\(/g) ?? []).toHaveLength(1);
    expect(layoutSource).toContain('variable: "--font-display"');
    expect(layoutSource).not.toContain('variable: "--font-body"');

    const rootTokens = rootTokenBlock(globalsSource);
    expect(rootTokens).not.toMatch(/--font-display:\s*["']/);
    expect(rootTokens).toContain("--font-body: var(--font-display);");
  });
});
