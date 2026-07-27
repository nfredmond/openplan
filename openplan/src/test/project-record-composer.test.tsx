import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { ProjectRecordComposer } from "@/components/projects/project-record-composer";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function activateDeliverableTab() {
  const trigger = screen.getByRole("tab", { name: /deliverable/i });
  // Radix tab triggers activate on pointer-down, not click.
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

describe("ProjectRecordComposer — deliverable budget fields", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ recordType: "deliverable", record: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends budgetAmount and percentComplete when entered", async () => {
    render(<ProjectRecordComposer projectId={PROJECT_ID} />);
    activateDeliverableTab();

    fireEvent.change(screen.getByLabelText("Deliverable title"), {
      target: { value: "Draft board-ready safety memo" },
    });
    fireEvent.change(screen.getByLabelText("Budget (not to exceed)"), {
      target: { value: "25000" },
    });
    fireEvent.change(screen.getByLabelText("Percent complete"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add deliverable" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/records`);
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      recordType: "deliverable",
      title: "Draft board-ready safety memo",
      budgetAmount: 25000,
      percentComplete: 40,
    });

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("omits the fields entirely when left blank — never sends 0", async () => {
    render(<ProjectRecordComposer projectId={PROJECT_ID} />);
    activateDeliverableTab();

    fireEvent.change(screen.getByLabelText("Deliverable title"), {
      target: { value: "Draft board-ready safety memo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add deliverable" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect("budgetAmount" in payload).toBe(false);
    expect("percentComplete" in payload).toBe(false);
  });
});
