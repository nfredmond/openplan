import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtpMock = vi.fn();
const exchangeCodeForSessionMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp: verifyOtpMock, exchangeCodeForSession: exchangeCodeForSessionMock },
  }),
}));

import { GET as confirm } from "@/app/auth/confirm/route";
import { GET as callback } from "@/app/auth/callback/route";
import { isAuthLinkError } from "@/lib/auth/link-errors";
import { recoveryErrorLooksLikeSuccess } from "@/lib/auth/recovery-reply";

const ORIGIN = "https://openplan.example";

function get(route: string, query: Record<string, string>) {
  const url = new URL(route, ORIGIN);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

function landing(response: Response) {
  return new URL(response.headers.get("location")!);
}

/**
 * M-1 of the hosted review: a PKCE code only redeems in the browser that asked
 * for the email, so a reset requested on a desktop failed on a phone. The email
 * templates link to /auth/confirm with a token hash, which any browser can
 * verify on the server.
 */
describe("/auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyOtpMock.mockResolvedValue({ error: null });
  });

  it("verifies the token hash on the server and lands on the path inside the old callback URL", async () => {
    const response = await confirm(
      get("/auth/confirm", {
        token_hash: "pkce_abc",
        type: "recovery",
        next: `${ORIGIN}/auth/callback?next=/reset-password`,
      }),
    );
    expect(verifyOtpMock).toHaveBeenCalledWith({ type: "recovery", token_hash: "pkce_abc" });
    expect(landing(response).href).toBe(`${ORIGIN}/reset-password`);
  });

  it("keeps a query string on the destination path", async () => {
    const response = await confirm(
      get("/auth/confirm", {
        token_hash: "h",
        type: "signup",
        next: `${ORIGIN}/auth/callback?next=${encodeURIComponent("/dashboard?intent=modeling")}`,
      }),
    );
    expect(landing(response).href).toBe(`${ORIGIN}/dashboard?intent=modeling`);
  });

  it("accepts a plain same-origin path as next", async () => {
    const response = await confirm(get("/auth/confirm", { token_hash: "h", type: "email", next: "/projects" }));
    expect(landing(response).href).toBe(`${ORIGIN}/projects`);
  });

  it("refuses to leave the site, even when wrapped in a callback URL", async () => {
    for (const hostile of [
      "https://evil.example/dashboard",
      "//evil.example",
      `${ORIGIN}/auth/callback?next=${encodeURIComponent("//evil.example")}`,
      `${ORIGIN}/auth/callback?next=${encodeURIComponent("/\t/evil.example")}`,
      `https://evil.example/auth/callback?next=/reset-password`,
    ]) {
      const response = await confirm(get("/auth/confirm", { token_hash: "h", type: "signup", next: hostile }));
      expect(landing(response).href).toBe(`${ORIGIN}/dashboard`);
    }
  });

  it("does not call the provider for a missing token or an unknown type", async () => {
    const queries: Record<string, string>[] = [{ type: "signup" }, { token_hash: "h" }, { token_hash: "h", type: "phone_change" }];
    for (const query of queries) {
      const response = await confirm(get("/auth/confirm", query));
      expect(landing(response).pathname).toBe("/sign-in");
      expect(landing(response).searchParams.get("auth_error")).toBe("incomplete");
    }
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("reports an expired or used link with a fixed code", async () => {
    verifyOtpMock.mockResolvedValue({ error: { code: "otp_expired", message: "Email link is invalid or has expired" } });
    const response = await confirm(get("/auth/confirm", { token_hash: "h", type: "signup" }));
    expect(landing(response).pathname).toBe("/sign-in");
    expect(landing(response).searchParams.get("auth_error")).toBe("expired");
  });
});

/** L-1: the callback forwards a fixed code, never the provider's words. */
describe("/auth/callback error codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turns provider text into a known code", async () => {
    const response = await callback(
      get("/auth/callback", { error: "access_denied", error_description: "Call 555-0100 now", next: "/dashboard" }),
    );
    const code = landing(response).searchParams.get("auth_error");
    expect(isAuthLinkError(code)).toBe(true);
    expect(landing(response).href).not.toContain("555");
  });

  it("reads otp_expired from the redirect as expired", async () => {
    const response = await callback(
      get("/auth/callback", { error: "access_denied", error_code: "otp_expired", error_description: "x" }),
    );
    expect(landing(response).searchParams.get("auth_error")).toBe("expired");
  });

  it("names a link opened in another browser", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      error: { code: "pkce_code_verifier_not_found", message: "PKCE code verifier not found in storage." },
    });
    const response = await callback(get("/auth/callback", { code: "abc" }));
    expect(landing(response).searchParams.get("auth_error")).toBe("other-browser");
  });
});

/**
 * M-2: for a real account, a second reset request inside the mail interval is
 * refused with HTTP 429; for an unknown address Supabase replies with success.
 * The page must show both the same way.
 */
describe("password reset reply", () => {
  it("treats a rate-limit refusal like success", () => {
    expect(
      recoveryErrorLooksLikeSuccess({
        status: 429,
        code: "over_email_send_rate_limit",
        message: "For security purposes, you can only request this after 59 seconds.",
      }),
    ).toBe(true);
    expect(recoveryErrorLooksLikeSuccess({ message: "User not found" })).toBe(true);
  });

  it("still shows a real failure", () => {
    expect(recoveryErrorLooksLikeSuccess({ status: 500, message: "Error sending recovery email" })).toBe(false);
    expect(recoveryErrorLooksLikeSuccess({ message: "Failed to fetch" })).toBe(false);
  });
});
