import { describe, expect, it } from "vitest";
import { buildBillingReadinessSummary } from "@/lib/billing/readiness";

const readyEnv = {
  OPENPLAN_STRIPE_SECRET_KEY: "sk_live_do_not_leak",
  OPENPLAN_STRIPE_PRICE_ID_STARTER: "price_starter_do_not_leak",
  OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL: "price_professional_do_not_leak",
  OPENPLAN_STRIPE_WEBHOOK_SECRET: "whsec_do_not_leak",
  OPENPLAN_BILLING_READINESS_SECRET: "readiness_secret_do_not_leak",
  OPENPLAN_BILLING_USAGE_FLUSH_SECRET: "flush_secret_do_not_leak",
  OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS: "openplan_runs_do_not_leak",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_do_not_leak",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_do_not_leak",
};

describe("buildBillingReadinessSummary", () => {
  it("passes when env, ledgers, workspace, and dry-run facts are ready without leaking secret values", () => {
    const summary = buildBillingReadinessSummary({
      env: readyEnv,
      generatedAt: new Date("2026-04-24T12:00:00.000Z"),
      facts: {
        subscriptionLedger: {
          accessible: true,
          rowCount: 101,
          activeLikeCount: 1,
        },
        usageLedger: {
          accessible: true,
          unreportedEventCount: 2,
          unreportedWeight: 6,
        },
        workspace: {
          requested: true,
          workspaceId: "11111111-1111-4111-8111-111111111111",
          found: true,
          name: "NCTC Demo",
          subscriptionStatus: "pilot",
          subscriptionPlan: "starter",
          stripeCustomerIdPresent: true,
          stripeSubscriptionIdPresent: false,
        },
        usageDryRun: {
          attempted: true,
          ok: true,
          closedBefore: "2026-05-01T00:00:00.000Z",
          scannedSubscriptions: 1,
          scannedEvents: 2,
          dryRunGroups: 1,
          skippedGroups: 0,
          failedGroups: 0,
          markFailedGroups: 0,
        },
      },
    });

    expect(summary).toMatchObject({
      generatedAt: "2026-04-24T12:00:00.000Z",
      status: "ready",
      readyForPaidCanary: true,
      blockers: [],
      warnings: [],
    });
    expect(summary.checks.every((check) => check.status === "pass")).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("do_not_leak");
  });

  it("blocks when required paid-access configuration or ledgers are missing", () => {
    const summary = buildBillingReadinessSummary({
      env: {
        OPENPLAN_STRIPE_PRICE_ID_STARTER: "price_starter",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      },
      facts: {
        subscriptionLedger: {
          accessible: false,
          error: 'relation "public.subscriptions" does not exist',
          missingSchema: true,
        },
        usageLedger: {
          accessible: false,
          error: "permission denied",
        },
        workspace: {
          requested: true,
          workspaceId: "11111111-1111-4111-8111-111111111111",
          found: false,
          error: "not found",
        },
        usageDryRun: {
          attempted: true,
          ok: false,
          error: "usage lookup failed",
        },
      },
    });

    expect(summary.status).toBe("blocked");
    expect(summary.readyForPaidCanary).toBe(false);
    expect(summary.blockers.join(" ")).toContain("Stripe API key");
    expect(summary.blockers.join(" ")).toContain("Stripe runs meter event");
    expect(summary.blockers.join(" ")).toContain("Subscription ledger");
    expect(summary.blockers.join(" ")).toContain("Usage flush dry run");
  });

  it("keeps optional professional price and dry-run omissions as warnings rather than blockers", () => {
    const summary = buildBillingReadinessSummary({
      env: {
        ...readyEnv,
        OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL: "",
      },
      facts: {
        subscriptionLedger: {
          accessible: true,
          rowCount: 101,
          activeLikeCount: 0,
        },
        usageLedger: {
          accessible: true,
          unreportedEventCount: 0,
          unreportedWeight: 0,
        },
      },
    });

    expect(summary.status).toBe("ready");
    expect(summary.readyForPaidCanary).toBe(true);
    expect(summary.blockers).toEqual([]);
    expect(summary.warnings.join(" ")).toContain("Professional checkout price");
    expect(summary.warnings.join(" ")).toContain("Workspace billing snapshot");
    expect(summary.warnings.join(" ")).toContain("Usage flush dry run");
  });
});
