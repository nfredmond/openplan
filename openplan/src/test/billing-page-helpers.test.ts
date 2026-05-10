import { describe, expect, it } from "vitest";
import { summarizeBillingStatusFreshness } from "@/app/(app)/billing/_components/billing-page-helpers";

describe("summarizeBillingStatusFreshness", () => {
  const now = new Date("2026-05-09T12:00:00.000Z");

  it("flags active-like subscriptions when the recorded period has ended", () => {
    expect(
      summarizeBillingStatusFreshness({
        status: "active",
        ledgerUpdatedAt: "2026-05-09T08:00:00.000Z",
        currentPeriodEnd: "2026-05-01T00:00:00.000Z",
        now,
      })
    ).toMatchObject({
      tone: "danger",
      label: "Period stale",
    });
  });

  it("flags checkout pending states that have been stale for more than three days", () => {
    expect(
      summarizeBillingStatusFreshness({
        status: "checkout_pending",
        ledgerUpdatedAt: "2026-05-05T11:59:59.000Z",
        currentPeriodEnd: null,
        now,
      })
    ).toMatchObject({
      tone: "warning",
      label: "Pending over 3 days",
    });
  });

  it("treats current active-like ledgers as access-current", () => {
    expect(
      summarizeBillingStatusFreshness({
        status: "pilot",
        ledgerUpdatedAt: "2026-05-09T08:00:00.000Z",
        currentPeriodEnd: null,
        now,
      })
    ).toMatchObject({
      tone: "success",
      label: "Access current",
    });
  });
});
