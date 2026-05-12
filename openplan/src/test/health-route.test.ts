import { GET, HEAD } from "@/app/api/health/route";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a public uptime-safe payload without dependency claims", async () => {
    const response = GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(payload).toEqual({
      status: "ok",
      service: "openplan",
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      deployment: {
        commit: "unknown",
      },
      checks: {
        app: "ok",
        database: "not_checked",
        billing: "not_checked",
      },
    });
  });

  it("exposes only a sanitized short deployment commit when Vercel provides one", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "ABCDEF1234567890ABCDEF1234567890ABCDEF12");

    const response = GET();
    const payload = await response.json();

    expect(payload.deployment).toEqual({ commit: "abcdef123456" });
  });

  it("does not expose configured secrets or unsafe environment values", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-secret");
    vi.stubEnv("OPENPLAN_BILLING_READINESS_SECRET", "readiness-secret");
    vi.stubEnv("OPENPLAN_WORKSPACE_PROVISIONING_SECRET", "provisioning-secret");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "https://example.com/not-a-commit?token=abc123");

    const response = GET();
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.deployment).toEqual({ commit: "unknown" });
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("anthropic-secret");
    expect(serialized).not.toContain("readiness-secret");
    expect(serialized).not.toContain("provisioning-secret");
    expect(serialized).not.toContain("https://example.com");
    expect(serialized).not.toMatch(/secret|token|key|password|supabase|anthropic|stripe/i);
  });

  it("supports HEAD checks with no body", async () => {
    const response = HEAD();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await response.text()).toBe("");
  });
});
