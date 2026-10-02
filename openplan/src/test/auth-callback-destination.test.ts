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

  it("falls back to the dashboard for a missing, absolute or protocol-relative `next`", () => {
    for (const hostile of [null, "", "https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "dashboard"]) {
      expect(safeNextPath(hostile)).toBe("/dashboard");
      expect(resolveCallbackDestination(hostile, ORIGIN).toString()).toBe("https://openplan.example/dashboard");
    }
  });
});
