import nextConfig from "../../next.config";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(general.get("Content-Security-Policy")).toContain("report-uri /api/csp-report");
    // The report-only header carries a stricter candidate beside the enforced
    // policy; it must never replace it.
    expect(general.get("Content-Security-Policy-Report-Only")).toContain("report-uri /api/csp-report");
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

/**
 * L-2 of the hosted review: connect-src and img-src allowed every
 * *.supabase.co project, so injected script could post data to an attacker's
 * own project. Only the configured project may be reached.
 */
describe("Supabase sources in the CSP", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("name the configured project and no wildcard", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    const headers = (await config.headers?.()) ?? [];
    const policy = headers.flatMap((block) => block.headers).find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    const directive = (name: string) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";
    expect(policy).not.toContain("*.supabase.co");
    expect(directive("connect-src")).toContain("https://abcdefghijklmnopqrst.supabase.co");
    expect(directive("connect-src")).toContain("wss://abcdefghijklmnopqrst.supabase.co");
    expect(directive("img-src")).toContain("https://abcdefghijklmnopqrst.supabase.co");
  });
});

/**
 * The enforced policy allows 'unsafe-eval'. Production Next.js does not need
 * it and no map library documents it, but no browser journey has proved every
 * map works without it, so the stricter policy ships report-only: browsers
 * report what it would block to /api/csp-report and block nothing.
 *
 * Blind spot, stated: this proves the headers sent, not what a browser reports.
 */
describe("the report-only candidate policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function productionHeaders() {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    const blocks = (await config.headers?.()) ?? [];
    return blocks.map((block) => new Map(block.headers.map((h) => [h.key, h.value])));
  }

  const directive = (policy: string, name: string) =>
    policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";

  it("drops only 'unsafe-eval' in production, on normal and embed pages", async () => {
    const blocks = await productionHeaders();
    expect(blocks).toHaveLength(2);
    for (const headers of blocks) {
      const enforced = headers.get("Content-Security-Policy") ?? "";
      const candidate = headers.get("Content-Security-Policy-Report-Only") ?? "";
      expect(directive(enforced, "script-src")).toContain("'unsafe-eval'");
      expect(directive(candidate, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
      // Everything a map needs (workers, tiles, styles) is the same in both.
      const strip = (policy: string) => policy.replace(/script-src [^;]+;\s*/, "");
      expect(strip(candidate)).toBe(strip(enforced));
      expect(directive(candidate, "worker-src")).toBe("worker-src 'self' blob:");
    }
  });
});
