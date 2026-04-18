import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkMonthlyRunQuota,
  currentUtcMonthStart,
  currentUtcMonthStartIso,
  isDevUnlimitedQuotaEnabled,
  isQuotaExceeded,
  isQuotaLookupError,
} from "@/lib/billing/quota";

type FakeSupabase = {
  from: ReturnType<typeof vi.fn>;
};

function makeCountClient(params: {
  count: number | null;
  error?: { message: string; code?: string } | null;
  captureRequest?: (req: { table: string; workspaceId?: string; gteIso?: string }) => void;
}): FakeSupabase {
  return {
    from: vi.fn((table: string) => {
      let workspaceId: string | undefined;
      let gteIso: string | undefined;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((_col: string, value: string) => {
          if (_col === "workspace_id") workspaceId = value;
          return builder;
        }),
        gte: vi.fn(async (_col: string, value: string) => {
          if (_col === "created_at") gteIso = value;
          params.captureRequest?.({ table, workspaceId, gteIso });
          return { count: params.count, error: params.error ?? null };
        }),
      };
      return builder;
    }),
  };
}

describe("currentUtcMonthStart", () => {
  it("returns YYYY-MM-01T00:00:00.000Z for any date in the month", () => {
    const now = new Date("2026-04-18T15:42:00Z");
    const start = currentUtcMonthStart(now);
    expect(start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(currentUtcMonthStartIso(now)).toBe("2026-04-01T00:00:00.000Z");
  });

  it("handles month rollover at UTC midnight-1", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(currentUtcMonthStartIso(now)).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("isDevUnlimitedQuotaEnabled", () => {
  it("is disabled in production regardless of flag", () => {
    expect(
      isDevUnlimitedQuotaEnabled({
        DEV_UNLIMITED_QUOTA: "1",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("is enabled only when flag=1 or true AND not production", () => {
    expect(
      isDevUnlimitedQuotaEnabled({
        DEV_UNLIMITED_QUOTA: "1",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isDevUnlimitedQuotaEnabled({
        DEV_UNLIMITED_QUOTA: "true",
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isDevUnlimitedQuotaEnabled({
        DEV_UNLIMITED_QUOTA: "0",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(isDevUnlimitedQuotaEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("checkMonthlyRunQuota", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      DEV_UNLIMITED_QUOTA: "0",
    } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = originalEnv as NodeJS.ProcessEnv;
  });

  it("reports unlimited when plan has no monthly limit (enterprise)", async () => {
    const supabase = makeCountClient({ count: 999 });
    const result = await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "enterprise",
      tableName: "runs",
    });
    expect(result).toMatchObject({ ok: true, unlimited: true, monthlyLimit: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns ok with remaining when workspace is below the limit", async () => {
    const supabase = makeCountClient({ count: 73 });
    const result = await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "starter",
      tableName: "runs",
      now: new Date("2026-04-18T00:00:00Z"),
    });
    expect(result).toEqual({
      ok: true,
      plan: "starter",
      monthlyLimit: 100,
      usedRuns: 73,
      remaining: 27,
      unlimited: false,
    });
  });

  it("rejects with 429-class result at the limit", async () => {
    const supabase = makeCountClient({ count: 100 });
    const result = await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "starter",
      tableName: "runs",
    });
    expect(isQuotaExceeded(result)).toBe(true);
    if (isQuotaExceeded(result)) {
      expect(result.usedRuns).toBe(100);
      expect(result.monthlyLimit).toBe(100);
      expect(result.message).toContain("100/100");
      expect(result.message).toContain("starter");
    }
  });

  it("rejects when usage exceeds the limit by any amount", async () => {
    const supabase = makeCountClient({ count: 250 });
    const result = await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "pilot",
      tableName: "model_runs",
    });
    expect(isQuotaExceeded(result)).toBe(true);
  });

  it("returns lookupError when the count query fails", async () => {
    const supabase = makeCountClient({
      count: null,
      error: { message: "relation \"runs\" does not exist", code: "42P01" },
    });
    const result = await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "starter",
      tableName: "runs",
    });
    expect(isQuotaLookupError(result)).toBe(true);
    if (isQuotaLookupError(result)) {
      expect(result.code).toBe("42P01");
    }
  });

  it("passes through the current-month start filter", async () => {
    const captured: { table: string; workspaceId?: string; gteIso?: string }[] = [];
    const supabase = makeCountClient({
      count: 10,
      captureRequest: (req) => captured.push(req),
    });
    await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "professional",
      tableName: "model_runs",
      now: new Date("2026-04-18T00:00:00Z"),
    });
    expect(captured[0]).toMatchObject({
      table: "model_runs",
      workspaceId: "w1",
      gteIso: "2026-04-01T00:00:00.000Z",
    });
  });

  it("bypasses enforcement when DEV_UNLIMITED_QUOTA=1 outside production", async () => {
    process.env.DEV_UNLIMITED_QUOTA = "1";
    (process.env as Record<string, string>).NODE_ENV = "development";
    const supabase = makeCountClient({ count: 9999 });
    const result = await checkMonthlyRunQuota(supabase as never, {
      workspaceId: "w1",
      plan: "starter",
      tableName: "runs",
    });
    expect(result).toMatchObject({ ok: true, unlimited: true });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
