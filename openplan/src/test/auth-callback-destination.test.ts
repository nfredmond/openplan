import { describe, expect, it } from "vitest";

import { resolveCallbackDestination, safeNextPath } from "@/lib/auth/callback-destination";

const ORIGIN = "https://openplan.example";

describe("auth callback destination", () => {
  it("keeps a query string on `next` as a query string, not as part of the path", () => {
    const destination = resolveCallbackDestination("/dashboard?intent=modeling", ORIGIN);

    expect(destination.pathname).toBe("/dashboard");
    expect(destination.searchParams.get("intent")).toBe("modeling");
    expect(destination.toString()).toBe("https://openplan.example/dashboard?intent=modeling");
  });

  it("passes a plain path through unchanged", () => {
    expect(resolveCallbackDestination("/reset-password", ORIGIN).toString()).toBe(
      "https://openplan.example/reset-password"
    );
  });

  it("preserves a valid local query and fragment", () => {
    expect(resolveCallbackDestination("/dashboard?intent=modeling#start", ORIGIN).href).toBe(
      `${ORIGIN}/dashboard?intent=modeling#start`
    );
  });

  it.each(["/\n/[", "/\t/[", "/\r/[::1"])("falls back for a malformed destination %j", (next) => {
    expect(resolveCallbackDestination(next, ORIGIN).href).toBe(`${ORIGIN}/dashboard`);
  });

  it("rejects an origin change revealed by URL normalization", () => {
    expect(resolveCallbackDestination("/\n/elsewhere.example/x", ORIGIN).href).toBe(`${ORIGIN}/dashboard`);
  });

  it("falls back to the dashboard for a missing, absolute or protocol-relative `next`", () => {
    for (const hostile of [null, "", "https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "dashboard"]) {
      expect(safeNextPath(hostile)).toBe("/dashboard");
      expect(resolveCallbackDestination(hostile, ORIGIN).toString()).toBe("https://openplan.example/dashboard");
    }
  });
});
