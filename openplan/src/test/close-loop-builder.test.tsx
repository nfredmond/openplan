import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
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
