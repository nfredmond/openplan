import { describe, expect, it } from "vitest";

import {
  classifyCronFreshness,
  readCronHeartbeatAt,
  recordCronHeartbeat,
} from "@/lib/notifications/cron-heartbeat";

/**
 * The heartbeat is what lets the My Work panel tell the truth about whether the
 * deadline sweep is actually running — replacing "is CRON_SECRET set?", which a
 * self-hoster answered yes for a different cron while reminders never fired.
 */

const NOW = new Date("2026-08-17T12:00:00.000Z");

describe("classifyCronFreshness", () => {
  it("is 'never' with no recorded success, or an unparseable stamp", () => {
    expect(classifyCronFreshness(null, NOW)).toBe("never");
    expect(classifyCronFreshness("not a date", NOW)).toBe("never");
  });

  it("is 'healthy' within the window and 'stale' past it", () => {
    // NOW is 2026-08-17T12:00Z; the default window is 48h. A daily cron gets a
    // full missed day of slack, so a run yesterday is healthy and one skip does
    // not cry wolf.
    expect(classifyCronFreshness("2026-08-16T12:00:00.000Z", NOW)).toBe("healthy"); // 24h
    expect(classifyCronFreshness("2026-08-15T13:00:00.000Z", NOW)).toBe("healthy"); // 47h
    // Older than 48h: the scheduler has likely stopped.
    expect(classifyCronFreshness("2026-08-15T11:00:00.000Z", NOW)).toBe("stale"); // 49h
    expect(classifyCronFreshness("2026-08-14T11:00:00.000Z", NOW)).toBe("stale"); // 73h
  });

  it("honours a custom window", () => {
    expect(classifyCronFreshness("2026-08-17T11:30:00.000Z", NOW, 1)).toBe("healthy"); // 30m
    expect(classifyCronFreshness("2026-08-17T10:00:00.000Z", NOW, 1)).toBe("stale"); // 2h
  });
});

describe("recordCronHeartbeat / readCronHeartbeatAt", () => {
  it("upserts on job_name and reads the stamp back", async () => {
    let stored: Record<string, unknown> | null = null;
    const client = {
      from: () => ({
        upsert: async (values: Record<string, unknown>, options?: { onConflict?: string }) => {
          expect(options?.onConflict).toBe("job_name");
          stored = values;
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: stored ? { last_succeeded_at: stored.last_succeeded_at as string } : null,
              error: null,
            }),
          }),
        }),
      }),
    };

    const write = await recordCronHeartbeat(client, "sweep-deadlines", { n: 3 }, NOW);
    expect(write.error).toBeNull();
    expect(stored).toMatchObject({ job_name: "sweep-deadlines", last_succeeded_at: NOW.toISOString() });

    expect(await readCronHeartbeatAt(client, "sweep-deadlines")).toBe(NOW.toISOString());
  });

  it("a read error or missing row reads as null, never as a fresh stamp", async () => {
    const erroring = {
      from: () => ({
        upsert: async () => ({ error: null }),
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "denied" } }) }),
        }),
      }),
    };
    expect(await readCronHeartbeatAt(erroring, "sweep-deadlines")).toBeNull();
    // And a null read classifies as 'never' — the honest default, so an
    // unreadable heartbeat never masquerades as a healthy sweep.
    expect(classifyCronFreshness(await readCronHeartbeatAt(erroring, "sweep-deadlines"), NOW)).toBe(
      "never"
    );
  });

  it("surfaces a write error rather than throwing, so it can never fail the job it reports on", async () => {
    const failing = {
      from: () => ({
        upsert: async () => ({ error: { message: "table missing" } }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    };
    const write = await recordCronHeartbeat(failing, "sweep-deadlines", {}, NOW);
    expect(write.error).toBe("table missing");
  });
});
