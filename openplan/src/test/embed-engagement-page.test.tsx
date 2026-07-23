import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPublicPortalBundle = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
vi.mock("@/lib/engagement/public-portal-data", () => ({
  loadPublicPortalBundle: (...args: unknown[]) => loadPublicPortalBundle(...args),
}));
vi.mock("@/components/engagement/public-engagement-portal", () => ({
  PublicEngagementPortal: (props: { shareToken: string }) => (
    <div data-testid="portal" data-share-token={props.shareToken} />
  ),
}));

import EmbedEngagementPage from "@/app/(embed)/embed/[shareToken]/page";

function bundle() {
  return {
    campaign: {
      id: "c1",
      project_id: null,
      title: "Downtown listening campaign",
      summary: null,
      public_description: "Tell us about downtown.",
      status: "active",
      engagement_type: "map_feedback",
      allow_public_submissions: true,
      submissions_closed_at: null,
      demographics_enabled: false,
      updated_at: "2026-07-22T00:00:00Z",
    },
    project: null,
    acceptingSubmissions: true,
    portalProps: {
      shareToken: "share-token-12345",
      acceptingSubmissions: true,
      categories: [],
      approvedItems: [],
      engagementType: "map_feedback",
      demographicsEnabled: false,
      projectContext: null,
      surveyQuestions: [],
      closeLoopEntries: [],
    },
  };
}

describe("EmbedEngagementPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the minimal-chrome portal for an active campaign", async () => {
    loadPublicPortalBundle.mockResolvedValue(bundle());
    const page = await EmbedEngagementPage({ params: Promise.resolve({ shareToken: "share-token-12345" }) });
    render(page);

    expect(screen.getByText("Downtown listening campaign")).toBeInTheDocument();
    expect(screen.getByText("Tell us about downtown.")).toBeInTheDocument();
    expect(screen.getByTestId("portal")).toBeInTheDocument();
    // Minimal chrome carries an honest attribution + a link back to the full page.
    expect(screen.getByText(/Powered by OpenPlan/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the full engagement page/i })).toHaveAttribute(
      "href",
      "/engage/share-token-12345"
    );
  });

  it("404s when there is no active campaign for the token", async () => {
    loadPublicPortalBundle.mockResolvedValue(null);
    await expect(
      EmbedEngagementPage({ params: Promise.resolve({ shareToken: "missing-token-000" }) })
    ).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
