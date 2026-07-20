import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicEngagementPortal, groupApprovedItems } from "@/components/engagement/public-engagement-portal";

const mkItem = (id: string, createdAt: string, parentItemId: string | null = null) => ({
  id,
  categoryId: null,
  title: null,
  body: `body ${id}`,
  submittedBy: null,
  latitude: null,
  longitude: null,
  geometry: null,
  votesCount: 0,
  parentItemId,
  photoUrl: null,
  createdAt,
});

describe("groupApprovedItems (E6 threaded replies)", () => {
  it("nests replies under their parent, oldest-first, preserving top-level order", () => {
    const items = [
      mkItem("p1", "2026-07-03T00:00:00Z"),
      mkItem("p2", "2026-07-02T00:00:00Z"),
      mkItem("r-late", "2026-07-05T00:00:00Z", "p1"),
      mkItem("r-early", "2026-07-04T00:00:00Z", "p1"),
    ];
    const { topLevel, repliesByParent } = groupApprovedItems(items);
    expect(topLevel.map((i) => i.id)).toEqual(["p1", "p2"]); // input order kept
    expect(repliesByParent.get("p1")?.map((i) => i.id)).toEqual(["r-early", "r-late"]); // chronological
    expect(repliesByParent.has("p2")).toBe(false);
  });

  it("drops an orphaned reply whose parent is not an approved top-level item", () => {
    const items = [mkItem("p1", "2026-07-03T00:00:00Z"), mkItem("orphan", "2026-07-04T00:00:00Z", "gone")];
    const { topLevel, repliesByParent } = groupApprovedItems(items);
    expect(topLevel.map((i) => i.id)).toEqual(["p1"]);
    expect([...repliesByParent.values()].flat()).toHaveLength(0); // orphan hidden, not shown as top-level
  });
});

const APPROVED_ITEMS = [
  {
    id: "aaaaaaa1-0000-4000-8000-000000000001",
    categoryId: null,
    title: "Crosswalk request",
    body: "A crosswalk is needed at Main and First.",
    submittedBy: null,
    latitude: 39.22,
    longitude: -121.06,
    geometry: { type: "Point" as const, coordinates: [-121.06, 39.22] },
    votesCount: 1,
    photoUrl: null,
    createdAt: "2026-07-02T12:00:00.000Z",
  },
  {
    id: "aaaaaaa1-0000-4000-8000-000000000002",
    categoryId: null,
    title: "Bike route gap",
    body: "The drawn line marks a missing bike connection.",
    submittedBy: null,
    latitude: 39.21,
    longitude: -121.05,
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [-121.06, 39.2],
        [-121.04, 39.22],
      ],
    },
    votesCount: 5,
    photoUrl: "https://example.supabase.co/storage/v1/object/sign/engagement-photos/signed.jpg",
    createdAt: "2026-07-01T12:00:00.000Z",
  },
];

describe("PublicEngagementPortal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("renders clearer submission guidance and optionality cues", () => {
    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions
        engagementType="map_feedback"
        categories={[{ id: "safety", label: "Safety", description: "Crossings and traffic safety" }]}
        approvedItems={[]}
      />
    );

    expect(screen.getByRole("heading", { name: "Share your input" })).toBeInTheDocument();
    expect(screen.getByText(/Takes about 2–3 minutes\. One main response is required\./i)).toBeInTheDocument();
    expect(screen.getByText("Your input (required)")).toBeInTheDocument();
    expect(screen.getByText("Helpful context (optional)")).toBeInTheDocument();
    expect(screen.getByText("Follow-up (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText(/What would you like us to know\?/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Input may be categorized and included in engagement summaries or project reporting\./i)
    ).toBeInTheDocument();
  });

  it("shows the richer confirmation state after a successful submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, submissionId: "submission-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions
        engagementType="map_feedback"
        categories={[]}
        approvedItems={[]}
      />
    );

    fireEvent.change(screen.getByLabelText(/What would you like us to know\?/i), {
      target: { value: "The crosswalk near Main Street needs a shorter crossing distance." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit feedback/i }));

    await waitFor(() => {
      expect(screen.getByText("Your input has been received")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/engage/share-token-123/submit",
      expect.objectContaining({ method: "POST" })
    );
    expect(
      screen.getByText(/It may be reviewed, categorized, and included in engagement summaries or project reporting\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Direct follow-up is not guaranteed unless the team chooses to reach back out\./i)
    ).toBeInTheDocument();
  });

  it("offers point, line, and area drawing plus a photo input on the submit form", () => {
    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions
        engagementType="map_feedback"
        categories={[]}
        approvedItems={[]}
      />
    );

    // Without a Mapbox token the picker renders its fallback, but the photo
    // input and the drawing guidance copy are part of the form itself.
    expect(screen.getByLabelText(/Photo/)).toBeInTheDocument();
    expect(screen.getByText(/Attach one JPEG, PNG, or WebP photo up to 5 MB\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/Drop a pin, trace a street or route as a line, or outline an area/i)
    ).toBeInTheDocument();
  });

  it("shows support controls with counts, geometry labels, and attached photos on the feedback list", () => {
    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions={false}
        engagementType="map_feedback"
        categories={[]}
        approvedItems={APPROVED_ITEMS}
      />
    );

    expect(screen.getByRole("button", { name: "▲ Support · 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▲ Support · 5" })).toBeInTheDocument();
    expect(screen.getByText("Line drawn")).toBeInTheDocument();
    expect(screen.getByText("Located")).toBeInTheDocument();
    expect(screen.getByAltText("Photo attached to this community comment")).toBeInTheDocument();
  });

  it("sorts the feedback list by most supported when selected", () => {
    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions={false}
        engagementType="map_feedback"
        categories={[]}
        approvedItems={APPROVED_ITEMS}
      />
    );

    const headingsBefore = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(headingsBefore.indexOf("Crosswalk request")).toBeLessThan(headingsBefore.indexOf("Bike route gap"));

    fireEvent.change(screen.getByLabelText(/Sort by/i), { target: { value: "most_supported" } });

    const headingsAfter = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(headingsAfter.indexOf("Bike route gap")).toBeLessThan(headingsAfter.indexOf("Crosswalk request"));
  });

  it("supports an item optimistically, posts the vote, and remembers it locally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, alreadyVoted: false, votesCount: 2 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions={false}
        engagementType="map_feedback"
        categories={[]}
        approvedItems={APPROVED_ITEMS}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "▲ Support · 1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "▲ Supported · 2" })).toBeDisabled();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/engage/share-token-123/items/aaaaaaa1-0000-4000-8000-000000000001/vote",
      expect.objectContaining({ method: "POST" })
    );

    const stored = JSON.parse(
      window.localStorage.getItem("openplan-engagement-supported-share-token-123") ?? "[]"
    ) as string[];
    expect(stored).toContain("aaaaaaa1-0000-4000-8000-000000000001");
  });

  it("keeps previously supported items disabled from localStorage memory", () => {
    window.localStorage.setItem(
      "openplan-engagement-supported-share-token-123",
      JSON.stringify(["aaaaaaa1-0000-4000-8000-000000000002"])
    );

    render(
      <PublicEngagementPortal
        shareToken="share-token-123"
        acceptingSubmissions={false}
        engagementType="map_feedback"
        categories={[]}
        approvedItems={APPROVED_ITEMS}
      />
    );

    const supportedButton = screen.getByRole("button", { name: "▲ Supported · 5" });
    expect(supportedButton).toBeDisabled();
    expect(within(supportedButton).getByText(/Supported/)).toBeInTheDocument();
  });
});
