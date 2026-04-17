import { describe, expect, it, vi } from "vitest";

const generateReportArtifactMock = vi.fn();
const createRtpPacketRecordMock = vi.fn();

vi.mock("@/lib/reports/client", () => ({
  generateReportArtifact: (...args: unknown[]) => generateReportArtifactMock(...args),
  createRtpPacketRecord: (...args: unknown[]) => createRtpPacketRecordMock(...args),
}));

import {
  ACTION_REGISTRY,
  executeAction,
  getActionRecord,
  MAX_REGROUNDING_DEPTH,
} from "@/lib/runtime/action-registry";

describe("action registry", () => {
  it("exposes every assistant quick-link execute action as a record", () => {
    const kinds = Object.keys(ACTION_REGISTRY).sort();
    expect(kinds).toEqual([
      "create_funding_opportunity",
      "create_project_funding_profile",
      "create_project_record",
      "create_rtp_packet_record",
      "generate_report_artifact",
      "link_billing_invoice_funding_award",
      "update_funding_opportunity_decision",
    ]);

    for (const kind of kinds) {
      const record = ACTION_REGISTRY[kind as keyof typeof ACTION_REGISTRY];
      expect(record.kind).toBe(kind);
      expect(["safe", "review", "approval_required"]).toContain(record.approval);
      expect(["refresh_preview", "none"]).toContain(record.regrounding);
      expect(record.auditEvent.startsWith("planner_agent.")).toBe(true);
      expect(typeof record.effect).toBe("function");
    }
  });

  it("getActionRecord returns the matching record by kind", () => {
    const record = getActionRecord("generate_report_artifact");
    expect(record.kind).toBe("generate_report_artifact");
    expect(record.regrounding).toBe("refresh_preview");
  });
});

describe("executeAction dispatcher", () => {
  it("runs the effect, then onCompleted, then refresh, then the post-action prompt", async () => {
    generateReportArtifactMock.mockResolvedValueOnce({});
    const onCompleted = vi.fn();
    const refreshAssistantPreview = vi.fn().mockResolvedValue({ quickLinks: ["link-1"] });
    const submitPostActionPrompt = vi.fn().mockResolvedValue(undefined);

    await executeAction(
      {
        kind: "generate_report_artifact",
        reportId: "report-1",
        postActionPrompt: "Follow up",
      },
      {
        onCompleted,
        refreshAssistantPreview,
        submitPostActionPrompt,
      }
    );

    expect(generateReportArtifactMock).toHaveBeenCalledWith("report-1");
    expect(onCompleted).toHaveBeenCalledWith({ regrounding: "refresh_preview" });
    expect(refreshAssistantPreview).toHaveBeenCalledTimes(1);
    expect(submitPostActionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        postActionPrompt: "Follow up",
        refreshedPreviewQuickLinks: ["link-1"],
      })
    );
  });

  it("skips refresh when regrounding is 'none' and skips prompt when not configured", async () => {
    const onCompleted = vi.fn();
    const refreshAssistantPreview = vi.fn();
    const submitPostActionPrompt = vi.fn();

    // fetch is used by patchJson; stub it to succeed
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await executeAction(
      {
        kind: "update_funding_opportunity_decision",
        opportunityId: "op-1",
        decisionState: "monitor",
      },
      {
        onCompleted,
        refreshAssistantPreview,
        submitPostActionPrompt,
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/funding-opportunities/op-1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(onCompleted).toHaveBeenCalledWith({ regrounding: "none" });
    expect(refreshAssistantPreview).not.toHaveBeenCalled();
    expect(submitPostActionPrompt).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("propagates effect errors to the caller (fail closed)", async () => {
    generateReportArtifactMock.mockRejectedValueOnce(new Error("boom"));
    const onCompleted = vi.fn();

    await expect(
      executeAction(
        { kind: "generate_report_artifact", reportId: "report-1" },
        { onCompleted }
      )
    ).rejects.toThrow("boom");
    expect(onCompleted).not.toHaveBeenCalled();
  });
});

describe("executeAction regrounding depth guard", () => {
  it("increments the depth passed to submitPostActionPrompt so chains can self-report", async () => {
    expect(MAX_REGROUNDING_DEPTH).toBe(2);

    generateReportArtifactMock.mockResolvedValueOnce({});
    const submitPostActionPrompt = vi.fn().mockResolvedValue(undefined);

    await executeAction(
      {
        kind: "generate_report_artifact",
        reportId: "report-1",
        postActionPrompt: "Follow up",
      },
      {
        onCompleted: vi.fn(),
        refreshAssistantPreview: vi.fn().mockResolvedValue({ quickLinks: [] }),
        submitPostActionPrompt,
      },
      { regroundingDepth: 1 }
    );

    expect(submitPostActionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ regroundingDepth: 2 })
    );
  });

  it("refuses to fire the post-action prompt once depth reaches the cap", async () => {
    generateReportArtifactMock.mockResolvedValueOnce({});
    const submitPostActionPrompt = vi.fn();
    const onPostActionPromptSkipped = vi.fn();

    await executeAction(
      {
        kind: "generate_report_artifact",
        reportId: "report-1",
        postActionPrompt: "Follow up",
      },
      {
        onCompleted: vi.fn(),
        refreshAssistantPreview: vi.fn().mockResolvedValue({ quickLinks: [] }),
        submitPostActionPrompt,
        onPostActionPromptSkipped,
      },
      { regroundingDepth: MAX_REGROUNDING_DEPTH }
    );

    expect(submitPostActionPrompt).not.toHaveBeenCalled();
    expect(onPostActionPromptSkipped).toHaveBeenCalledWith({
      reason: "depth_exceeded",
      depth: MAX_REGROUNDING_DEPTH,
      maxDepth: MAX_REGROUNDING_DEPTH,
    });
  });

  it("clamps negative depth to zero so the guard cannot be bypassed", async () => {
    generateReportArtifactMock.mockResolvedValueOnce({});
    const submitPostActionPrompt = vi.fn().mockResolvedValue(undefined);

    await executeAction(
      {
        kind: "generate_report_artifact",
        reportId: "report-1",
        postActionPrompt: "Follow up",
      },
      {
        onCompleted: vi.fn(),
        refreshAssistantPreview: vi.fn().mockResolvedValue({ quickLinks: [] }),
        submitPostActionPrompt,
      },
      { regroundingDepth: -5 }
    );

    expect(submitPostActionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ regroundingDepth: 1 })
    );
  });
});
