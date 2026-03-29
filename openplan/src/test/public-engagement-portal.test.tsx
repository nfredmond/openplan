import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";

describe("PublicEngagementPortal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
