import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

/**
 * /robots.txt returned 404 (OPS-37 of the October 12 review). Crawlers may read
 * the public pages and are asked to stay out of the app, the API and the
 * account pages.
 *
 * Blind spot, stated: robots rules are a request. This proves what is asked,
 * not that a crawler obeys; sign-in and row level security guard the app.
 */

function disallowed(): string[] {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  return list.flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []));
}

function blocks(pathname: string): boolean {
  return disallowed().some((prefix) => pathname.startsWith(prefix));
}

describe("robots.txt", () => {
  it("asks crawlers to stay out of every signed-in app module", () => {
    const appDir = path.join(process.cwd(), "src/app/(app)");
    const modules = readdirSync(appDir).filter((name) => statSync(path.join(appDir, name)).isDirectory());
    expect(modules.length).toBeGreaterThan(20);
    for (const name of modules) expect(blocks(`/${name}`), name).toBe(true);
  });

  it("asks crawlers to stay out of the API and account pages", () => {
    for (const pathname of ["/api/health", "/auth/callback", "/invitations/abc", "/reset-password", "/forgot-password"]) {
      expect(blocks(pathname), pathname).toBe(true);
    }
  });

  it("leaves the public pages open", () => {
    for (const pathname of ["/", "/examples", "/contact", "/legal", "/privacy", "/terms", "/sign-in", "/engage/abc", "/plan/abc", "/measure/abc", "/published-plans/abc"]) {
      expect(blocks(pathname), pathname).toBe(false);
    }
  });
});
