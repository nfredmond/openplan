import { describe, expect, it } from "vitest";
import {
  buildProjectFundingProfileScan,
  buildProjectFundingStackSummary,
  projectFundingProfileScanTone,
} from "@/lib/projects/funding";

describe("project funding profile scan", () => {
  it("surfaces target, match, obligation, reimbursement, closeout, and evidence lanes", () => {
    const summary = buildProjectFundingStackSummary(
      { funding_need_amount: 2_000_000, local_match_need_amount: 400_000 },
      [
        {
          awarded_amount: 900_000,
          match_amount: 150_000,
          risk_flag: "none",
          obligation_due_at: "2026-05-20T00:00:00.000Z",
        },
      ],
      [
        {
          decision_state: "pursue",
          opportunity_status: "open",
          expected_award_amount: 500_000,
        },
      ],
      [
        {
          status: "submitted",
          amount: 250_000,
          retention_percent: 0,
          retention_amount: 0,
          due_date: null,
        },
      ]
    );

    const scan = buildProjectFundingProfileScan({
      summary,
      hasComparisonEvidence: true,
      now: "2026-05-10T00:00:00.000Z",
    });

    expect(scan).toMatchObject({
      status: "attention",
      label: "Funding profile needs operator review",
    });
    expect(scan.lanes.map((lane) => lane.id)).toEqual([
      "funding_target",
      "local_match",
      "obligation",
      "reimbursement",
      "closeout",
      "evidence_support",
    ]);
    expect(scan.lanes.find((lane) => lane.id === "funding_target")).toMatchObject({
      status: "attention",
      amount: 600_000,
    });
    expect(scan.lanes.find((lane) => lane.id === "local_match")).toMatchObject({
      status: "attention",
      amount: 250_000,
    });
    expect(scan.lanes.find((lane) => lane.id === "obligation")).toMatchObject({
      status: "attention",
      statusLabel: "Due soon",
    });
    expect(scan.lanes.find((lane) => lane.id === "evidence_support")?.detail).toContain("not an award prediction");
    expect(projectFundingProfileScanTone(scan.status)).toBe("warning");
  });

  it("blocks profiles with no committed award reimbursement chain", () => {
    const summary = buildProjectFundingStackSummary(
      { funding_need_amount: 750_000, local_match_need_amount: 0 },
      [
        {
          awarded_amount: 300_000,
          match_amount: 0,
          risk_flag: "none",
          obligation_due_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      [],
      []
    );

    const scan = buildProjectFundingProfileScan({
      summary,
      now: "2026-05-10T00:00:00.000Z",
    });

    expect(scan.status).toBe("blocked");
    expect(scan.nextAction).toContain("obligation posture");
    expect(scan.lanes.find((lane) => lane.id === "obligation")).toMatchObject({
      status: "blocked",
      statusLabel: "Overdue",
    });
    expect(scan.lanes.find((lane) => lane.id === "reimbursement")).toMatchObject({
      status: "blocked",
      statusLabel: "No reimbursement requests yet",
    });
  });

  it("marks fully paid profiles ready while keeping formal closeout human-reviewed", () => {
    const summary = buildProjectFundingStackSummary(
      { funding_need_amount: 500_000, local_match_need_amount: 100_000 },
      [
        {
          awarded_amount: 500_000,
          match_amount: 100_000,
          risk_flag: "none",
          obligation_due_at: "2026-09-01T00:00:00.000Z",
        },
      ],
      [],
      [
        {
          status: "paid",
          amount: 500_000,
          retention_percent: 0,
          retention_amount: 0,
          due_date: null,
        },
      ]
    );

    const scan = buildProjectFundingProfileScan({
      summary,
      hasComparisonEvidence: true,
      now: "2026-05-10T00:00:00.000Z",
    });

    expect(scan.status).toBe("ready");
    expect(scan.lanes.find((lane) => lane.id === "closeout")).toMatchObject({
      status: "ready",
      statusLabel: "Closeout-ready posture",
    });
    expect(scan.lanes.find((lane) => lane.id === "closeout")?.nextAction).toContain("operator review");
  });
});
