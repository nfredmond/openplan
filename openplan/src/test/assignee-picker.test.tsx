import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "@/components/workspaces/assignee-picker";
import { DEPARTED_ASSIGNEE_SENTENCE } from "@/lib/workspaces/roster";

/**
 * The assignee picker is the one control through which a planner points work
 * at a teammate. Its honesty rules:
 * - a failed roster load renders as a FAILURE with a retry, never as an empty
 *   team (an empty select claims "you have no teammates");
 * - a recorded assignee who left the workspace renders the shared departed
 *   sentence, never a stale name and never a blank;
 * - it reports the id the planner actually chose — bindings varied below so a
 *   hardcoded first-member (or self) implementation fails.
 */

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const DEPARTED = "99999999-9999-4999-8999-999999999999";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      members: [
        { userId: FIRST, email: "first@agency.gov", role: "member" },
        { userId: SECOND, email: "second@agency.gov", role: "admin" },
      ],
      callerUserId: FIRST,
    }),
  });
});

describe("AssigneePicker", () => {
  it("asks the roster route for THIS workspace and reports the chosen teammate's id", async () => {
    const onChange = vi.fn();
    render(<AssigneePicker workspaceId={WORKSPACE} value={null} onChange={onChange} />);

    const select = await screen.findByRole("combobox", { name: "Assignee" });
    await waitFor(() => expect(screen.getByText(/second@agency\.gov/)).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/roster?workspaceId=${encodeURIComponent(WORKSPACE)}`
    );

    // The SECOND member, so a picker hardcoding the first (or the caller)
    // cannot pass.
    fireEvent.change(select, { target: { value: SECOND } });
    expect(onChange).toHaveBeenCalledWith(SECOND);
  });

  it("reports clearing as null, and offers Unassigned explicitly", async () => {
    const onChange = vi.fn();
    render(<AssigneePicker workspaceId={WORKSPACE} value={SECOND} onChange={onChange} />);

    const select = await screen.findByRole("combobox", { name: "Assignee" });
    await waitFor(() => expect(screen.getByText("Unassigned")).toBeTruthy());

    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders a failed roster load as a failure with retry — never as an empty team", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Failed to load the workspace roster" }),
    });

    render(<AssigneePicker workspaceId={WORKSPACE} value={null} onChange={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("not an empty team");
    expect(alert.textContent).toContain("Failed to load the workspace roster");
    // No select pretending the roster is an empty (or any) team.
    expect(screen.queryByRole("combobox")).toBeNull();

    // Retry refetches and renders the real roster.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("combobox", { name: "Assignee" });
    expect(screen.getByText(/first@agency\.gov/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders a departed assignee as the shared sentence, keeping the value selectable", async () => {
    render(<AssigneePicker workspaceId={WORKSPACE} value={DEPARTED} onChange={vi.fn()} />);

    const select = (await screen.findByRole("combobox", {
      name: "Assignee",
    })) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByText(DEPARTED_ASSIGNEE_SENTENCE)).toBeTruthy());

    // The record's value is preserved — rendering the form must not silently
    // rewrite the assignment — and what the planner SEES is the honest
    // sentence, not a blank and not a stale name.
    expect(select.value).toBe(DEPARTED);
    expect(select.selectedOptions[0]?.textContent).toBe(DEPARTED_ASSIGNEE_SENTENCE);
    // The live roster is still offered alongside it.
    expect(screen.getByText(/second@agency\.gov/)).toBeTruthy();
  });

  it("names a member whose email lookup failed honestly instead of a blank option", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        members: [{ userId: FIRST, email: null, role: "member" }],
        callerUserId: FIRST,
      }),
    });

    render(<AssigneePicker workspaceId={WORKSPACE} value={null} onChange={vi.fn()} />);
    await screen.findByRole("combobox", { name: "Assignee" });
    expect(screen.getByText(/Member \(email unavailable\)/)).toBeTruthy();
  });
});
