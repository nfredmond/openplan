import { describe, expect, it } from "vitest";
import {
  buildInvoicingDirectionHref,
  describeAwardSubstantiation,
  normalizeInvoicingDirection,
  substantiationReadinessLabel,
  toneForSubstantiationReadiness,
} from "@/app/(app)/invoicing/_components/invoicing-page-helpers";

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

describe("invoicing direction lane split", () => {
  it("defaults to the reimbursement direction and only recognizes receivables", () => {
    expect(normalizeInvoicingDirection(undefined)).toBe("reimbursement");
    expect(normalizeInvoicingDirection("reimbursement")).toBe("reimbursement");
    expect(normalizeInvoicingDirection("receivables")).toBe("receivables");
    expect(normalizeInvoicingDirection("payables")).toBe("reimbursement");
    expect(normalizeInvoicingDirection(["receivables"])).toBe("reimbursement");
  });

  it("preserves other params when switching direction and omits the default direction", () => {
    const params = {
      workspaceId: "ws-1",
      linkage: "unlinked",
      overdue: "overdue",
      direction: "receivables",
    };

    expect(buildInvoicingDirectionHref(params, "receivables")).toBe(
      "/invoicing?workspaceId=ws-1&linkage=unlinked&overdue=overdue&direction=receivables"
    );
    // Switching back to the default direction drops the param entirely.
    expect(buildInvoicingDirectionHref(params, "reimbursement")).toBe(
      "/invoicing?workspaceId=ws-1&linkage=unlinked&overdue=overdue"
    );
    expect(buildInvoicingDirectionHref({}, "reimbursement")).toBe("/invoicing");
    expect(buildInvoicingDirectionHref({}, "receivables")).toBe("/invoicing?direction=receivables");
  });
});
