import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
import type { CloseLoopEntryRow } from "@/lib/engagement/close-loop";

const CATEGORIES = [{ id: "cat-safety", label: "Safety" }];

function entry(overrides: Partial<CloseLoopEntryRow> = {}): CloseLoopEntryRow {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    campaign_id: "10000000-0000-4000-8000-000000000001",
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

beforeEach(() => sessionStorage.clear());

function acknowledged(row: CloseLoopEntryRow, init?: RequestInit) {
  const body = JSON.parse(String(init?.body));
  return jsonResponse({ entry: row, entryId: row.id, requestId: body.requestId, removed: false, replayed: false, becamePublished: row.status === "published", broadcast: null, broadcastStatus: row.status === "published" ? "unknown" : "not_required" });
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

describe("EngagementCloseLoopBuilder", () => {
  afterEach(() => vi.restoreAllMocks());

  it("links a manual reviewed response to selected contributions without AI",async()=>{
    const fetchSpy=vi.spyOn(global,"fetch").mockImplementation(async (_url, init) => acknowledged(entry({id:"20000000-0000-4000-8000-000000000003",source_item_ids:["30000000-0000-4000-8000-000000000001"]}), init));
    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={[]} initialEntries={[]} sourceItems={[{id:"30000000-0000-4000-8000-000000000001",title:"Safer crossing"}]}/>);
    fireEvent.change(screen.getByPlaceholderText(/Safer crossings downtown/i),{target:{value:"Reviewed crossing response"}});
    const select=screen.getByLabelText("Contributions addressed") as HTMLSelectElement;
    select.options[0].selected=true;fireEvent.change(select);
    fireEvent.click(screen.getByRole("button",{name:/add entry/i}));
    await waitFor(()=>expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({sourceItemIds:["30000000-0000-4000-8000-000000000001"]});
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/engagement/campaigns/10000000-0000-4000-8000-000000000001/closeloop");
  });

  it("posts a retained request and appends only its confirmed response", async () => {
    const created = entry({ id: "20000000-0000-4000-8000-000000000002", theme_title: "Transit gaps" });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => acknowledged(created, init));

    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={CATEGORIES} initialEntries={[]} />);

    fireEvent.change(screen.getByPlaceholderText(/Safer crossings downtown/i), { target: { value: "Transit gaps" } });
    fireEvent.click(screen.getByRole("button", { name: /add entry/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engagement/campaigns/10000000-0000-4000-8000-000000000001/closeloop");
    expect((init as RequestInit).method).toBe("POST");
    await screen.findByText("Transit gaps");
  });

  it("publishes a draft via PATCH and reflects the returned status", async () => {
    const published = entry({ status: "published", published_at: "2026-07-22T01:00:00Z" });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => acknowledged(published, init));

    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={CATEGORIES} initialEntries={[entry()]} />);

    fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Reviewed for publication" } });
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engagement/campaigns/10000000-0000-4000-8000-000000000001/closeloop/20000000-0000-4000-8000-000000000001");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ status: "published", requestId: expect.any(String), expectedUpdatedAt: entry().updated_at, reason: "Reviewed for publication" });
    await screen.findByText("Published");
    // Now the toggle offers Unpublish.
    await screen.findByRole("button", { name: /unpublish/i });
  });

  it("labels an offline AI draft honestly and can add it as a draft entry", async () => {
    const created = entry({ id: "20000000-0000-4000-8000-000000000004", theme_title: "Crossings", ai_assisted: true });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/closeloop/draft")) {
        return Promise.resolve(
          jsonResponse({
            drafts: [{ themeTitle: "Crossings", youSaid: "Safer crossings please.", sourceItemIds: ["30000000-0000-4000-8000-000000000001"] }],
            source: "deterministic-fallback",
            model: null,
            fallbackReason: "missing_api_key",
            itemCount: 4,
            caveat: "AI offline.",
          })
        );
      }
      return Promise.resolve(acknowledged(created, init));
    });

    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={CATEGORIES} initialEntries={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /generate drafts/i }));

    // Honest offline labelling.
    await screen.findByText(/AI is offline/i);
    await screen.findByText("Crossings");

    fireEvent.click(screen.getByRole("button", { name: /add as draft entry/i }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/engagement/campaigns/10000000-0000-4000-8000-000000000001/closeloop")).toBe(true));
    // The created entry carries the AI-assisted badge.
    await screen.findByText("AI-assisted draft");
  });
});


describe("staff response read recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("withholds empty counts and writes until the failed read recovers", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ entries: [entry()] }));
    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={[]} initialEntries={[]} initialReadError />);
    expect(screen.getByRole("alert")).toHaveTextContent("Saved staff responses could not be loaded");
    expect(screen.queryByText(/No entries yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 published, 0 total/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add entry/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Generate drafts/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading responses" }));
    await screen.findByText("Safer crossings");
    expect(fetchSpy).toHaveBeenCalledWith("/api/engagement/campaigns/10000000-0000-4000-8000-000000000001/closeloop", expect.objectContaining({ method: "GET" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Generate drafts/i })).toBeEnabled();
  });

  it("recognizes a recovered empty result as empty", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ entries: [] }));
    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={[]} initialEntries={[]} initialReadError />);
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
    render(<EngagementCloseLoopBuilder workspaceId="50000000-0000-4000-8000-000000000005" userId="staff-1" campaignId="10000000-0000-4000-8000-000000000001" categories={[]} initialEntries={[entry()]} initialReadError />);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading responses" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry loading responses" })).toBeEnabled());
    expect(screen.getByText("Safer crossings")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Saved staff responses could not be loaded");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.queryByText("SYNTHETIC unavailable")).not.toBeInTheDocument();
  });
});
