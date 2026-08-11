import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { WorkNotificationInboxPanel } from "@/components/my-work/notification-inbox";
import { loadWorkNotifications, type WorkNotificationInbox } from "@/lib/notifications/work";

import { FakeWorkDb } from "./helpers/fake-work-notification-tables";

/**
 * THE REMINDER PANEL, rendered from what the REAL loader produced.
 *
 * The props are never hand-written: a described fixture proves the renderer
 * against an inbox the product may not be able to produce, which is the
 * recorded reason a stage-gate offer shipped with a condition no board could
 * satisfy. Every case below goes through `loadWorkNotifications` over a fake
 * table.
 *
 * MUTATION-VERIFIED (each reverted after): rendering a failed read as an empty
 * panel, dropping the "reminders are switched off" notice when no CRON_SECRET
 * is configured, and reporting a refused mark-read as success.
 */

const ALICE = "aaaaaaaa-0000-4000-8000-00000000000a";

function rows() {
  return [
    {
      id: "n-overdue",
      recipient_user_id: ALICE,
      is_read: false,
      kind: "deliverable_due",
      title: "Public review draft",
      body: "Deliverable on Corridor study — was due Aug 1, 2026 and is now overdue.",
      due_on: "2026-08-01",
      project_id: null,
      created_at: "2026-08-11T13:00:00.000Z",
    },
    {
      id: "n-grant",
      recipient_user_id: ALICE,
      is_read: false,
      kind: "grant_decision_due",
      title: "Active transportation program",
      body: "Pursue-or-skip decision — due Aug 13, 2026. You recorded this opportunity; grant deadlines carry no assignee.",
      due_on: "2026-08-13",
      project_id: null,
      created_at: "2026-08-11T13:00:00.000Z",
    },
  ];
}

async function inboxFrom(tableRows: Array<Record<string, unknown>>, error?: { message: string }) {
  const db = new FakeWorkDb({
    tables: { work_notifications: tableRows },
    errors: error ? { work_notifications: error } : {},
  });
  return loadWorkNotifications(db, ALICE);
}

async function renderPanel(inbox: WorkNotificationInbox, sweepConfigured = true) {
  render(<WorkNotificationInboxPanel inbox={inbox} sweepConfigured={sweepConfigured} />);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the reminder panel", () => {
  it("lists what the sweep flagged, with the deadline and a plain-language kind", async () => {
    await renderPanel(await inboxFrom(rows()));

    expect(screen.getByText("Public review draft")).toBeTruthy();
    expect(screen.getByText("Deliverable")).toBeTruthy();
    expect(screen.getByText("Grant decision")).toBeTruthy();
    // The shared date rendering — Aug 1, not 2026-08-01 and not 7/31 in a
    // reader's own zone.
    expect(screen.getByText("Aug 1, 2026")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Reminders \(2\)/ })).toBeTruthy();
  });

  it("renders nothing at all when there is nothing to say", async () => {
    const { container } = render(
      <WorkNotificationInboxPanel inbox={await inboxFrom([])} sweepConfigured />
    );
    // An empty panel above a page that already lists every deadline is
    // furniture, and furniture is what makes people stop reading a page.
    expect(container.innerHTML).toBe("");
  });

  it("says reminders are switched off rather than implying nothing is due", async () => {
    await renderPanel(await inboxFrom([]), false);

    const text = document.body.textContent ?? "";
    expect(text).toContain("switched off");
    expect(text).toContain("CRON_SECRET");
    // And it names the deadlines are still listed, so nobody reads this as
    // "OpenPlan is not tracking my work".
    expect(text).toContain("listed below");
  });

  it("says a failed read could not be read, never that the inbox is empty", async () => {
    await renderPanel(await inboxFrom([], { message: "connection reset" }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("could not be read");
    expect(text).toContain("does not mean nothing is due");
    expect(text).toContain("connection reset");
  });

  it("names the migration when the deployment is behind it", async () => {
    await renderPanel(await inboxFrom([], { message: 'relation "public.work_notifications" does not exist' }));

    const text = document.body.textContent ?? "";
    expect(text).toContain("20260811000007");
    expect(text).toContain("pending migrations");
  });

  it("marks one read through the route, then re-reads the page", async () => {
    await renderPanel(await inboxFrom(rows()));

    fireEvent.click(screen.getAllByRole("button", { name: "Mark read" })[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/work-notifications/read");
    expect(JSON.parse(String(init.body))).toEqual({ notificationId: "n-overdue" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("marks all read with a single request", async () => {
    await renderPanel(await inboxFrom(rows()));

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ markAll: true });
  });

  it("says so when the route refuses, and leaves the reminder where it is", async () => {
    // The viewer case, and the gone case, and the policy case: all arrive here
    // as a non-ok response, and none of them may look like success.
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "The reminder was not saved" }),
    });
    await renderPanel(await inboxFrom(rows()));

    fireEvent.click(screen.getAllByRole("button", { name: "Mark read" })[0]);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("was not saved"));
    expect(refreshMock).not.toHaveBeenCalled();
    // Still on screen. A row that vanished on a refused write would be the
    // product lying about what it saved.
    expect(screen.getByText("Public review draft")).toBeTruthy();
  });
});
