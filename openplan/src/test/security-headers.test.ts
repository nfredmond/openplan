import nextConfig from "../../next.config";
import { describe, expect, it } from "vitest";

describe("security headers", () => {
  it("ships CSP in enforce mode while preserving violation reporting", async () => {
    const headers = await nextConfig.headers?.();
    const rootHeaders = headers?.find((entry) => entry.source === "/:path*")?.headers ?? [];
    const byKey = new Map(rootHeaders.map((header) => [header.key, header.value]));

    expect(byKey.has("Content-Security-Policy-Report-Only")).toBe(false);
    expect(byKey.get("Content-Security-Policy")).toContain("report-uri /api/csp-report");
  });
});
