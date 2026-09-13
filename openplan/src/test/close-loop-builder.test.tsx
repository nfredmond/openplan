import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeBroadcast, EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
import type { CloseLoopEntryRow } from "@/lib/engagement/close-loop";

const CATEGORIES = [{ id: "cat-safety", label: "Safety" }];

function entry(overrides: Partial<CloseLoopEntryRow> = {}): CloseLoopEntryRow {
  return {
    id: "e1",
    campaign_id: "camp-1",
    category_id: null,
    theme_title: "Safer crossings",
    you_said: "Add a crosswalk.",
    we_did: "",
    status: "draft",
    ai_assisted: false,
    source_item_ids: [],
    sort_order: 0,
    published_at: null,
    created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

describe("EngagementCloseLoopBuilder", () => {
  afterEach(() => vi.restoreAllMocks());

  it("links a manual reviewed response to selected contributions without AI",async()=>{
    const fetchSpy=vi.spyOn(global,"fetch").mockResolvedValue(jsonResponse({entry:entry({id:"manual",source_item_ids:["published-item"]})}));
    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={[]} initialEntries={[]} sourceItems={[{id:"published-item",title:"Safer crossing"}]}/>);
    fireEvent.change(screen.getByPlaceholderText(/Safer crossings downtown/i),{target:{value:"Reviewed crossing response"}});
    const select=screen.getByLabelText("Contributions addressed") as HTMLSelectElement;
    select.options[0].selected=true;fireEvent.change(select);
    fireEvent.click(screen.getByRole("button",{name:/add entry/i}));
    await waitFor(()=>expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({sourceItemIds:["published-item"]});
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/engagement/campaigns/camp-1/closeloop");
  });

  it("posts a new entry and appends it optimistically", async () => {
    const created = entry({ id: "e-new", theme_title: "Transit gaps" });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ entryId: "e-new", entry: created }));

    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={CATEGORIES} initialEntries={[]} />);

    fireEvent.change(screen.getByPlaceholderText(/Safer crossings downtown/i), { target: { value: "Transit gaps" } });
    fireEvent.click(screen.getByRole("button", { name: /add entry/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engagement/campaigns/camp-1/closeloop");
    expect((init as RequestInit).method).toBe("POST");
    await screen.findByText("Transit gaps");
  });

  it("publishes a draft via PATCH and reflects the returned status", async () => {
    const published = entry({ status: "published", published_at: "2026-07-22T01:00:00Z" });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ entry: published }));

    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={CATEGORIES} initialEntries={[entry()]} />);

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engagement/campaigns/camp-1/closeloop/e1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "published" });
    await screen.findByText("Published");
    // Now the toggle offers Unpublish.
    await screen.findByRole("button", { name: /unpublish/i });
  });

  it("labels an offline AI draft honestly and can add it as a draft entry", async () => {
    const created = entry({ id: "e-ai", theme_title: "Crossings", ai_assisted: true });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/closeloop/draft")) {
        return Promise.resolve(
          jsonResponse({
            drafts: [{ themeTitle: "Crossings", youSaid: "Safer crossings please.", sourceItemIds: ["a1"] }],
            source: "deterministic-fallback",
            model: null,
            fallbackReason: "missing_api_key",
            itemCount: 4,
            caveat: "AI offline.",
          })
        );
      }
      return Promise.resolve(jsonResponse({ entryId: "e-ai", entry: created }));
    });

    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={CATEGORIES} initialEntries={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /generate drafts/i }));

    // Honest offline labelling.
    await screen.findByText(/AI is offline/i);
    await screen.findByText("Crossings");

    fireEvent.click(screen.getByRole("button", { name: /add as draft entry/i }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/engagement/campaigns/camp-1/closeloop")).toBe(true));
    // The created entry carries the AI-assisted badge.
    await screen.findByText("AI-assisted draft");
  });
});


describe("staff response read recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("withholds empty counts and writes until the failed read recovers", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ entries: [entry()] }));
    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={[]} initialEntries={[]} initialReadError />);
    expect(screen.getByRole("alert")).toHaveTextContent("Saved staff responses could not be loaded");
    expect(screen.queryByText(/No entries yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 published, 0 total/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add entry/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Generate drafts/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading responses" }));
    await screen.findByText("Safer crossings");
    expect(fetchSpy).toHaveBeenCalledWith("/api/engagement/campaigns/camp-1/closeloop", expect.objectContaining({ method: "GET" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Generate drafts/i })).toBeEnabled();
  });

  it("recognizes a recovered empty result as empty", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ entries: [] }));
    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={[]} initialEntries={[]} initialReadError />);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading responses" }));
    await screen.findByText(/No entries yet/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["failed HTTP", { error: "SYNTHETIC unavailable" }, false],
    ["missing entries", {}, true],
    ["malformed entry", { entries: [{ ...entry(), status: "unreadable" }] }, true],
    ["foreign campaign", { entries: [entry({ campaign_id: "other" })] }, true],
    ["duplicate identity", { entries: [entry(), entry()] }, true],
  ])("keeps known responses and the retry control after %s", async (_name, payload, ok) => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(payload, ok));
    render(<EngagementCloseLoopBuilder campaignId="camp-1" categories={[]} initialEntries={[entry()]} initialReadError />);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading responses" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry loading responses" })).toBeEnabled());
    expect(screen.getByText("Safer crossings")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Saved staff responses could not be loaded");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.queryByText("SYNTHETIC unavailable")).not.toBeInTheDocument();
  });
});


describe("outbox persistence notices", () => {
  it("does not call failed outbox writes an empty subscriber list", () => {
    const notice = describeBroadcast({ outcome: "attempted", result: { enqueued: 0, unrecorded: 2, delivered: 0, skipped: 0, failed: 0, transport: "none" } });
    expect(notice?.tone).toBe("warning");
    expect(notice?.lines.join(" ")).toContain("2 update emails could not be saved");
    expect(notice?.lines.join(" ")).toContain("Delivery was not attempted");
    expect(notice?.lines.join(" ")).not.toMatch(/no confirmed email subscriptions/);
  });

  it("keeps partial delivery and unsaved emails distinct", () => {
    const notice = describeBroadcast({ outcome: "attempted", result: { enqueued: 1, unrecorded: 1, delivered: 1, skipped: 0, failed: 0, transport: "resend" } });
    expect(notice?.tone).toBe("warning");
    expect(notice?.lines.join(" ")).toContain("1 update email could not be saved");
    expect(notice?.lines.join(" ")).toContain("1 update email delivered");
  });
});
