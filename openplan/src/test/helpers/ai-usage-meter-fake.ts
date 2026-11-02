import { vi } from "vitest";

type MeterError = { message: string } | null;

/**
 * A stand-in for the AI limiter's service client, for route tests that run the
 * real `reserveAiUsage` (src/lib/runtime/ai-rate-limit.ts) instead of a mock of
 * it. `count` answers the window's usage count and `insert` the usage record;
 * set either to return an error to break the meter.
 *
 * Blind category: it does not prove the SQL count, the `usage_events` grants or
 * the hosted key resolution, and its count is whatever the test says it is.
 */
export function createAiUsageMeterFake() {
  const count = vi.fn(async (): Promise<{ count: number | null; error: MeterError }> => ({ count: 0, error: null }));
  const insert = vi.fn(async (_row: Record<string, unknown>): Promise<{ error: MeterError }> => ({ error: null }));
  const client = {
    from(table: string) {
      if (table !== "usage_events") throw new Error(`AI usage meter fake: unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ in: () => ({ gte: () => count() }) }) }),
        insert: (row: Record<string, unknown>) => insert(row),
      };
    },
  };
  return { client, count, insert };
}

type AiUsageMeterFake = ReturnType<typeof createAiUsageMeterFake>;

type ReserveParams = Parameters<typeof import("@/lib/runtime/ai-rate-limit").reserveAiUsage>[0];

/**
 * The real `reserveAiUsage`, with the fake meter's client in place of the
 * service-role client. Use it as the implementation of a mocked export so a
 * route test exercises the real refusal rules. Who pays comes from the real or
 * mocked `anthropicKeySource`.
 */
export async function reserveThroughFakeMeter(meter: AiUsageMeterFake) {
  const actual = await vi.importActual<typeof import("@/lib/runtime/ai-rate-limit")>("@/lib/runtime/ai-rate-limit");
  return (params: ReserveParams) =>
    actual.reserveAiUsage({ ...params, serviceSupabase: meter.client as unknown as ReserveParams["serviceSupabase"] });
}

type CheckOptions = NonNullable<Parameters<typeof import("@/lib/runtime/ai-rate-limit").checkAiUsageRateLimit>[1]>;

/** The real `checkAiUsageRateLimit`, counting from the same fake meter. */
export async function checkThroughFakeMeter(meter: AiUsageMeterFake) {
  const actual = await vi.importActual<typeof import("@/lib/runtime/ai-rate-limit")>("@/lib/runtime/ai-rate-limit");
  return (workspaceId: string, options?: CheckOptions) =>
    actual.checkAiUsageRateLimit(workspaceId, {
      ...options,
      serviceSupabase: meter.client as unknown as CheckOptions["serviceSupabase"],
    });
}
