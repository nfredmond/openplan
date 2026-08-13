import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { ProjectRecordComposer } from "@/components/projects/project-record-composer";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * The seven always-open forms became seven buttons, each opening a guided flow.
 * Getting to the money fields now means doing what a planner does: press "Add a
 * deliverable", name it, and walk to the second step. Deliberately not a
 * shortcut past the flow — the whole point of these assertions is that a real
 * planner's answers reach the request.
 */
function openDeliverableFlow(title = "Draft board-ready safety memo") {
  fireEvent.click(screen.getByTestId("project-record-open-deliverable"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

/**
 * The composer now makes TWO kinds of request: the record POST, and the
 * assignee picker's roster GET (one per mounted tab). So every assertion below
 * selects the record call by URL rather than by call index — `calls[0]` would
 * have silently become the roster read, and the payload assertions would then
 * be about a request the test never meant to make.
 */
function recordCalls(fetchMock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) =>
    url.endsWith("/records")
  );
}

describe("ProjectRecordComposer — deliverable budget fields", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/workspaces/roster")) {
        return {
          ok: true,
          json: async () => ({ members: [{ userId: "user-2", email: "priya@example.gov", role: "member" }] }),
        };
      }
      return { ok: true, json: async () => ({ recordType: "deliverable", record: {} }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends budgetAmount and percentComplete when entered", async () => {
    render(<ProjectRecordComposer projectId={PROJECT_ID} workspaceId={WORKSPACE_ID} />);
    openDeliverableFlow();

    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText("How far along is it?"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the deliverable" }));

    await waitFor(() => expect(recordCalls(fetchMock)).toHaveLength(1));

    const [url, init] = recordCalls(fetchMock)[0];
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

  /**
   * THE PICKER HAS TO BE ON THE FORM, AND ITS CHOICE HAS TO REACH THE REQUEST.
   *
   * This repository's signature defect is a capability that is complete,
   * tested and unreachable — a write path with no control wired to it. The
   * route tests prove the API accepts an assignee; only this proves a planner
   * can send one.
   */
  it("offers the roster on the deliverable form and sends the chosen teammate", async () => {
    render(<ProjectRecordComposer projectId={PROJECT_ID} workspaceId={WORKSPACE_ID} />);
    // A second flow with its own picker, opened first, so the assertion below
    // is over MORE THAN ONE roster call — one form pointing at the wrong
    // workspace is the bug, and a single call cannot show it.
    fireEvent.click(screen.getByTestId("project-record-open-milestone"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A milestone" } });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    await waitFor(() => expect(screen.getByLabelText("Assign it to someone")).toBeInTheDocument());
    // Abandoning it asks first, because there is typed work in it.
    fireEvent.click(screen.getByRole("button", { name: /Close without saving/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Throw it away/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    openDeliverableFlow();

    // EVERY picker asks for THIS project's workspace, not a current-workspace
    // guess: a member of two workspaces would otherwise be offered the wrong
    // team. Asserted over ALL roster calls rather than "at least one", because
    // one form pointing elsewhere is exactly the bug — a `some()` here passed a
    // mutation that broke a single form. A picker only mounts while its flow is
    // open now, so the milestone flow is opened as well to get a second one.
    const rosterCalls = () =>
      (fetchMock.mock.calls as Array<[string, RequestInit?]>).filter(([url]) =>
        String(url).startsWith("/api/workspaces/roster")
      );
    await waitFor(() => expect(rosterCalls().length).toBeGreaterThan(1));
    for (const [url] of rosterCalls()) {
      expect(String(url)).toBe(`/api/workspaces/roster?workspaceId=${WORKSPACE_ID}`);
    }

    const picker = await screen.findByLabelText("Assign it to someone");
    await waitFor(() => expect(within(picker).queryByText(/priya@example.gov/)).not.toBeNull());

    // The free-text owner lane stays usable at the same time — they are not
    // alternatives, and a planner may well need both.
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Consultant" } });
    fireEvent.change(picker, { target: { value: "user-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the deliverable" }));

    await waitFor(() => expect(recordCalls(fetchMock)).toHaveLength(1));

    const payload = JSON.parse(String(recordCalls(fetchMock)[0][1].body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      recordType: "deliverable",
      ownerLabel: "Consultant",
      assigneeUserId: "user-2",
    });
  });

  it("sends no assignee at all when the planner picked nobody", async () => {
    // Without this the test above would pass on a composer that always sent a
    // value, and "Unassigned" would be unreachable.
    render(<ProjectRecordComposer projectId={PROJECT_ID} workspaceId={WORKSPACE_ID} />);
    openDeliverableFlow();

    fireEvent.click(screen.getByRole("button", { name: "Add the deliverable" }));

    await waitFor(() => expect(recordCalls(fetchMock)).toHaveLength(1));

    const payload = JSON.parse(String(recordCalls(fetchMock)[0][1].body)) as Record<string, unknown>;
    expect("assigneeUserId" in payload).toBe(false);
  });

  it("omits the fields entirely when left blank — never sends 0", async () => {
    render(<ProjectRecordComposer projectId={PROJECT_ID} workspaceId={WORKSPACE_ID} />);
    openDeliverableFlow();

    fireEvent.click(screen.getByRole("button", { name: "Add the deliverable" }));

    await waitFor(() => expect(recordCalls(fetchMock)).toHaveLength(1));

    const [, init] = recordCalls(fetchMock)[0];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect("budgetAmount" in payload).toBe(false);
    expect("percentComplete" in payload).toBe(false);
  });
});
