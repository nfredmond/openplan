import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync("src/app/layout.tsx", "utf8");
const globalsSource = readFileSync("src/app/globals.css", "utf8");

function rootTokenBlock(source: string) {
  const match = source.match(/:root\s*\{([\s\S]*?)\n\}/);
  return match?.[1] ?? "";
}

/*
  Body text is Public Sans and titles are Space Grotesk (decision D7, October 1,
  2026, built October 10). Each face is loaded exactly once through
  next/font/local, so the build never fetches fonts and never preloads a file
  twice; the body token reads the next/font variable, never a bare family name
  that would fall back silently if the file stopped loading.
*/
describe("font preload source wiring", () => {
  it("loads each face once from local files and points body text at Public Sans", () => {
    expect(layoutSource.match(/const\s+publicSans\s*=\s*localFont\(/g) ?? []).toHaveLength(1);
    expect(layoutSource.match(/const\s+spaceGrotesk\s*=\s*localFont\(/g) ?? []).toHaveLength(1);
    expect(layoutSource.match(/const\s+jetBrainsMono\s*=\s*localFont\(/g) ?? []).toHaveLength(1);
    expect(layoutSource).toContain('from "next/font/local"');
    expect(layoutSource).not.toContain("next/font/google");
    expect(layoutSource).toContain('src: "./fonts/publicsans/PublicSans[wght].ttf"');
    expect(layoutSource).toContain('variable: "--font-body-sys"');
    expect(layoutSource).toContain('variable: "--font-display"');
    expect(layoutSource).toContain("${publicSans.variable}");

    const rootTokens = rootTokenBlock(globalsSource);
    expect(rootTokens).not.toMatch(/--font-display:\s*["']/);
    expect(rootTokens).toMatch(/--font-body:\s*var\(--font-body-sys\)/);
  });
});
