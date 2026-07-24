import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSessionMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchangeCodeForSessionMock } }),
}));

import { GET } from "@/app/auth/callback/route";

function callback(query: string) {
  return new NextRequest(`http://localhost/auth/callback${query}`);
}

/**
 * The app previously had NO auth callback route, so nothing ever called
 * exchangeCodeForSession. Every emailed link — password reset, email
 * confirmation, magic link — arrived with a code that nothing redeemed, making a
 * forgotten password a permanent lockout.
 */
describe("auth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
  });

  it("redeems the code and forwards to the requested path", async () => {
    const res = await GET(callback("?code=abc123&next=/reset-password"));
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/reset-password");
  });

  it("defaults to the dashboard when no next path is given", async () => {
    const res = await GET(callback("?code=abc123"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("refuses to be used as an open redirect", async () => {
    // A `next` of //evil.com or an absolute URL must not escape the origin.
    for (const hostile of ["//evil.com", "https://evil.com/x", "http:/evil.com"]) {
      const res = await GET(callback(`?code=abc123&next=${encodeURIComponent(hostile)}`));
      const location = new URL(res.headers.get("location")!);
      expect(location.origin).toBe("http://localhost");
      expect(location.pathname).toBe("/dashboard");
    }
  });

  it("explains an expired or already-used link instead of silently bouncing", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: "Email link is invalid or has expired" } });
    const res = await GET(callback("?code=stale&next=/reset-password"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("auth_error")).toMatch(/expired/i);
  });

  it("forwards a provider error without attempting an exchange", async () => {
    const res = await GET(callback("?error_description=Token+has+expired"));
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("auth_error")).toMatch(/expired/i);
  });

  it("reports a missing code rather than pretending it worked", async () => {
    const res = await GET(callback(""));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("auth_error")).toBeTruthy();
  });
});

describe("password recovery surface", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

  it("offers a forgot-password route from sign-in", () => {
    expect(read("src/app/(auth)/sign-in/page.tsx")).toContain("/forgot-password");
  });

  it("sends the reset link through the callback so the code is redeemed", () => {
    const source = read("src/app/(auth)/forgot-password/page.tsx");
    expect(source).toContain("resetPasswordForEmail");
    expect(source).toContain("/auth/callback?next=/reset-password");
  });

  it("does not leak whether an email address has an account", () => {
    // A different visible outcome for a real vs unknown address would make this
    // form an account-enumeration oracle.
    const source = read("src/app/(auth)/forgot-password/page.tsx");
    expect(source).toContain("If an account exists");
  });

  it("sets the new password and handles a dead link explicitly", () => {
    const source = read("src/app/(auth)/reset-password/page.tsx");
    expect(source).toContain("updateUser");
    expect(source).toMatch(/no longer valid/i);
  });
});
