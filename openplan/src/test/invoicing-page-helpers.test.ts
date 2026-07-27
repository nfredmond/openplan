import { describe, expect, it } from "vitest";
import {
  describeAwardSubstantiation,
  substantiationReadinessLabel,
  summarizeBillingStatusFreshness,
  toneForSubstantiationReadiness,
} from "@/app/(app)/invoicing/_components/invoicing-page-helpers";

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

describe("award substantiation presentation helpers", () => {
  it("maps readiness to badge tone and label", () => {
    expect(toneForSubstantiationReadiness("substantiated")).toBe("success");
    expect(toneForSubstantiationReadiness("partial")).toBe("warning");
    expect(toneForSubstantiationReadiness("none")).toBe("danger");
    expect(substantiationReadinessLabel("substantiated")).toBe("Substantiated");
    expect(substantiationReadinessLabel("partial")).toBe("Partially substantiated");
    expect(substantiationReadinessLabel("none")).toBe("No substantiation on record");
  });

  it("describes obligation milestone posture, milestone count, and submittal count", () => {
    expect(
      describeAwardSubstantiation({
        obligationMilestoneStatus: "in_progress",
        milestoneCount: 2,
        submittalCount: 3,
        latestSubmittalAt: "2026-04-20T10:00:00.000Z",
        readiness: "substantiated",
      })
    ).toBe("Obligation milestone in progress · 2 award milestones · 3 project submittals (latest submitted 2026-04-20)");

    expect(
      describeAwardSubstantiation({
        obligationMilestoneStatus: null,
        milestoneCount: 1,
        submittalCount: 0,
        latestSubmittalAt: null,
        readiness: "partial",
      })
    ).toBe("No obligation milestone yet · 1 award milestone · 0 project submittals");
  });
});
