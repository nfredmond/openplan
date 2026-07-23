import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementNotificationsInbox } from "@/components/engagement/notifications-inbox";
import type { EngagementNotificationRow } from "@/lib/notifications/engagement";

function notif(overrides: Partial<EngagementNotificationRow> = {}): EngagementNotificationRow {
  return {
    id: "n1",
    workspace_id: "w1",
    campaign_id: "c1",
    type: "comment_submitted",
    title: "New public submission on “Downtown”",
    body: "Add a crosswalk",
    payload_json: {},
    is_read: false,
    read_at: null,
    created_at: "2026-07-22T00:00:00Z",
    ...overrides,
  };
}

describe("EngagementNotificationsInbox", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows an empty state when there is no activity", () => {
    render(<EngagementNotificationsInbox campaignId="c1" initialNotifications={[]} />);
    expect(screen.getByText("No activity yet.")).toBeTruthy();
  });

  it("renders notifications with an unread count and marks one read", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
    render(<EngagementNotificationsInbox campaignId="c1" initialNotifications={[notif()]} />);

    expect(screen.getByText(/1 unread/i)).toBeTruthy();
    expect(screen.getByText("New public submission on “Downtown”")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^mark read$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engagement/campaigns/c1/notifications");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ notificationId: "n1" });
  });

  it("mark-all-read posts markAllRead and clears the unread count", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
    render(<EngagementNotificationsInbox campaignId="c1" initialNotifications={[notif(), notif({ id: "n2" })]} />);

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ markAllRead: true });
    await screen.findByText(/All caught up/i);
  });
});
