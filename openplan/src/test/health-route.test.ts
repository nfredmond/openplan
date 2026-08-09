import { GET, HEAD } from "@/app/api/health/route";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "@/lib/runtime/app-version";

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
        version: APP_VERSION,
      },
      checks: {
        app: "ok",
        database: "not_checked",
      },
    });
  });

  it("exposes only a sanitized short deployment commit when Vercel provides one", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "ABCDEF1234567890ABCDEF1234567890ABCDEF12");

    const response = GET();
    const payload = await response.json();

    expect(payload.deployment).toEqual({ commit: "abcdef123456", version: APP_VERSION });
  });

  /**
   * A SELF-HOSTED INSTANCE HAS TO BE ABLE TO NAME ITSELF.
   *
   * This route read `VERCEL_GIT_COMMIT_SHA` and nothing else, so every
   * deployment that is not on Vercel reported `commit: "unknown"` however
   * carefully its operator set `OPENPLAN_COMMIT_SHA` — and self-hosting is the
   * posture the product committed to for 1.0.
   *
   * It is not a cosmetic gap. On 2026-08-08 the always-on walkthrough instance
   * on :3000 was 174 commits behind `main`, a browser-testing pass mistook it
   * for the working tree, and half an hour went into diagnosing a bug that had
   * already been fixed. `/api/health` is the one question you can ask a running
   * instance without credentials; if it cannot answer "which build are you",
   * nobody can tell a stale deployment from a current one.
   */
  it("names the commit a self-hosted operator stamped, not just Vercel's", async () => {
    vi.stubEnv("OPENPLAN_COMMIT_SHA", "0E3D7D9FABCDEF1234567890ABCDEF1234567890");

    const response = GET();
    const payload = await response.json();

    expect(payload.deployment.commit).toBe("0e3d7d9fabcd");
  });

  it("reports the version so a forked instance is still identifiable", async () => {
    const payload = await GET().json();

    // Read from package.json rather than restated — a second copy of a version
    // is a second thing to forget, and the failure is an instance confidently
    // reporting a version it is not running.
    expect(payload.deployment.version).toBe(APP_VERSION);
    expect(payload.deployment.version).toMatch(/^\d+\.\d+\.\d+/);
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

    expect(payload.deployment).toEqual({ commit: "unknown", version: APP_VERSION });
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
