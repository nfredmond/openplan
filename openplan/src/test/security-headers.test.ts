import nextConfig from "../../next.config";
import { describe, expect, it } from "vitest";

async function headerBlocks() {
  const headers = (await nextConfig.headers?.()) ?? [];
  const general = headers.find((entry) => entry.source.includes("(?!embed"));
  const embed = headers.find((entry) => entry.source === "/embed/:path*");
  return {
    general: new Map((general?.headers ?? []).map((h) => [h.key, h.value])),
    embed: new Map((embed?.headers ?? []).map((h) => [h.key, h.value])),
    generalSource: general?.source ?? "",
  };
}

describe("security headers", () => {
  it("ships CSP in enforce mode while preserving violation reporting", async () => {
    const { general } = await headerBlocks();
    expect(general.has("Content-Security-Policy-Report-Only")).toBe(false);
    expect(general.get("Content-Security-Policy")).toContain("report-uri /api/csp-report");
  });

  it("locks framing everywhere except the embed segment", async () => {
    const { general, generalSource } = await headerBlocks();
    // The general block must NOT match /embed/* (so the embed CSP is the only one there).
    expect(generalSource).toContain("(?!embed");
    expect(general.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(general.get("X-Frame-Options")).toBe("DENY");
  });

  it("relaxes ONLY frame-ancestors on the embed segment, and drops X-Frame-Options there", async () => {
    const { embed } = await headerBlocks();
    const csp = embed.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors *");
    expect(csp).not.toContain("frame-ancestors 'none'");
    // X-Frame-Options: DENY would block framing regardless of CSP, so it must be absent here.
    expect(embed.has("X-Frame-Options")).toBe(false);
    // The rest of the policy stays locked down and reporting stays on.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
    // Still carries the shared hardening headers.
    expect(embed.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps the non-frame-ancestors CSP directives identical between the two blocks", async () => {
    const { general, embed } = await headerBlocks();
    const strip = (csp: string) => csp.replace(/frame-ancestors [^;]+;?\s*/, "");
    expect(strip(general.get("Content-Security-Policy") ?? "")).toBe(strip(embed.get("Content-Security-Policy") ?? ""));
  });
});
