import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/cron/sweep-deadlines — the door, not the sweep.
 *
 * Three facts live here and nowhere else, so if this file were absent they
 * would be unproven no matter how well the sweep itself is tested:
 *
 *   1. NO SECRET, NO SWEEP. An unauthenticated reminder endpoint is a way for a
 *      stranger to mail an agency's whole team, and a deployment that never set
 *      CRON_SECRET must be CLOSED rather than open.
 *   2. IT PASSES THE SERVICE-ROLE CLIENT. Four of the sweep's six sources have
 *      no workspace_id of their own and the cron has no session; the caller's
 *      client would read nothing at all.
 *   3. THE SCHEDULE IS DECLARED. A cron route nothing schedules is the
 *      shipped-invisible defect class with a timer attached — it would sit in
 *      the tree looking like a working reminder system.
 *
 * MUTATION-VERIFIED (each reverted after): making the route fall OPEN when no
 * CRON_SECRET is set, and deleting the vercel.json entry, each fail exactly one
 * assertion below.
 *
 * WHAT THESE TESTS DO NOT PROVE, STATED because a reader would otherwise assume
 * it: swapping `timingSafeSecretEquals` for `===` leaves every assertion here
 * GREEN. Measured, not guessed — the mutation was run. Both spellings refuse
 * the same requests; the difference is how long the refusal takes, which a unit
 * test cannot observe. The constant-time comparison is a deliberate choice
 * copied from `reap-gtfs-ingests` (the older `reap-model-runs` uses `===` and
 * leaks its secret a byte at a time to anyone who can measure a response) and
 * it is held by review, not by this file. Do not let this header be read as
 * coverage it does not have.
 */

const sweepMock = vi.fn();
const serviceClient = { serviceRole: true };
const createServiceRoleClientMock = vi.fn(() => serviceClient);

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

vi.mock("@/lib/notifications/work", () => ({
  sweepWorkDeadlines: (...args: unknown[]) => sweepMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import fs from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";

import { GET } from "@/app/api/cron/sweep-deadlines/route";

const SECRET = "a-long-cron-secret-value";

function request(headers: Record<string, string> = {}) {
  // A real NextRequest, not a cast Request: the route reads `nextUrl.origin`
  // to build the digest's link, and a plain Request has no `nextUrl` — the
  // cast would have made this suite green against a route that throws in
  // production. It did, until the 500 showed up here.
  return new NextRequest("https://plan.example.gov/api/cron/sweep-deadlines", { headers });
}

function emptyResult() {
  return {
    now: "2026-08-11T13:00:00.000Z",
    horizonDays: 7,
    perSource: {
      deliverable_due: { scanned: 0, candidates: 0, pending: false, failed: false, message: null, truncated: false },
      milestone_due: { scanned: 0, candidates: 0, pending: false, failed: true, message: "boom", truncated: false },
      submittal_due: { scanned: 0, candidates: 0, pending: true, failed: false, message: "no column", truncated: false },
      invoice_due: { scanned: 0, candidates: 0, pending: false, failed: false, message: null, truncated: true },
      grant_decision_due: { scanned: 0, candidates: 0, pending: false, failed: false, message: null, truncated: false },
      award_obligation_due: { scanned: 0, candidates: 0, pending: false, failed: false, message: null, truncated: false },
    },
    notificationsCreated: 4,
    digestsComposed: 2,
    emailsDelivered: 0,
    emailsSkipped: 2,
    emailsFailed: 0,
    emailUnavailable: 0,
    departedRecipients: 1,
    workspacesWithoutRoster: [],
    writeError: null,
  };
}

let savedSecret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  sweepMock.mockResolvedValue(emptyResult());
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("the deadline sweep cron route", () => {
  it("refuses a request with no bearer secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const response = await GET(request({ authorization: `Bearer ${SECRET}-nope` }));
    expect(response.status).toBe(401);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("is CLOSED, not open, when the deployment configured no secret", async () => {
    // The direction matters: an unset secret must deny, never allow. A route
    // that fell open here would let anyone on the internet mail every planner
    // in the deployment.
    delete process.env.CRON_SECRET;
    const response = await GET(request({ authorization: "Bearer " }));
    expect(response.status).toBe(401);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("sweeps with the service-role client and the request's own origin", async () => {
    const response = await GET(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(sweepMock.mock.calls[0][0]).toBe(serviceClient);
    expect(sweepMock.mock.calls[0][1]).toMatchObject({ appOrigin: "https://plan.example.gov" });
  });

  it("reports what could not be read, so a quiet sweep is not mistaken for a quiet week", async () => {
    const response = await GET(request({ authorization: `Bearer ${SECRET}` }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.notificationsCreated).toBe(4);
    expect(body.digestsComposed).toBe(2);
    expect(body.departedRecipients).toBe(1);
    expect(body.unreadableSources).toEqual(["milestone_due:failed", "submittal_due:pending_migration"]);
  });

  it("answers 500 rather than a cheerful 200 when the sweep throws", async () => {
    sweepMock.mockRejectedValue(new Error("the database went away"));
    const response = await GET(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(500);
  });

  it("is actually scheduled — daily, in vercel.json", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")
    ) as { crons?: Array<{ path: string; schedule: string }> };

    const entry = (config.crons ?? []).find((cron) => cron.path === "/api/cron/sweep-deadlines");
    expect(entry, "a sweep route nothing schedules is a reminder system that never runs").toBeDefined();
    // Once a day, at a fixed hour — not a */n frequency. A digest that arrived
    // every fifteen minutes would be the thing people turn off.
    expect(entry?.schedule).toBe("0 13 * * *");
  });
});
