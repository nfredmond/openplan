import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeActionMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/lib/runtime/action-registry", () => ({
  executeAction: (...args: unknown[]) => executeActionMock(...args),
}));

import { PilotWorkflowActionButton } from "@/components/operations/pilot-workflow-action-button";

type TestActionHost = {
  onCompleted: (context: { regrounding: string }) => Promise<void> | void;
};

describe("PilotWorkflowActionButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches the packet action and refreshes after completion", async () => {
    executeActionMock.mockImplementation(async (_action: unknown, host: TestActionHost) => {
      await host.onCompleted({ regrounding: "refresh_preview" });
    });

    render(
      <PilotWorkflowActionButton
        action={{ kind: "generate_report_artifact", reportId: "report-1" }}
        label="Generate packet"
        pendingLabel="Generating packet"
        successLabel="Packet refreshed"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate packet/i }));

    await waitFor(() => {
      expect(executeActionMock).toHaveBeenCalledWith(
        { kind: "generate_report_artifact", reportId: "report-1" },
        expect.objectContaining({
          onCompleted: expect.any(Function),
        })
      );
    });

    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Packet refreshed");
  });

  it("keeps action failures visible without refreshing the page", async () => {
    executeActionMock.mockRejectedValueOnce(new Error("Generation failed"));

    render(
      <PilotWorkflowActionButton
        action={{ kind: "generate_report_artifact", reportId: "report-1" }}
        label="Generate packet"
        pendingLabel="Generating packet"
        successLabel="Packet refreshed"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate packet/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Generation failed");
    });

    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});
