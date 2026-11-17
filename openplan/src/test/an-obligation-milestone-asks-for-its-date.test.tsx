import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { RecordStatusAdvanceButton } from "@/components/projects/record-status-advance-button";

/** KI-2026-11-16-140: completing an obligation milestone asks for the date it was obligated. */
describe("the obligation milestone status control", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the date before completing, then sends it", async () => {
    render(<RecordStatusAdvanceButton projectId="p" recordId="m" recordType="milestone" currentStatus="in_progress" completeNeedsDate />);

    fireEvent.change(screen.getByLabelText("Set milestone status"), { target: { value: "complete" } });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Date obligated"), { target: { value: "2026-03-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save date and complete" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ recordType: "milestone", status: "complete", actualDate: "2026-03-15" });
  });

  it("completes any other milestone without asking", async () => {
    render(<RecordStatusAdvanceButton projectId="p" recordId="m" recordType="milestone" currentStatus="in_progress" />);

    fireEvent.change(screen.getByLabelText("Set milestone status"), { target: { value: "complete" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Date obligated")).toBeNull();
  });
});
