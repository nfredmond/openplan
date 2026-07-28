import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EngagementPublicLinkCompact } from "@/components/engagement/engagement-public-link-compact";

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    share_token: "abcdef0123456789abcdef01",
    public_description: "Tell us about downtown.",
    allow_public_submissions: true,
    submissions_closed_at: null,
    ...overrides,
  };
}

describe("EngagementPublicLinkCompact", () => {
  it("shows the live portal URL with copy and open actions plus the moderation explainer", () => {
    render(<EngagementPublicLinkCompact campaign={campaign()} />);

    expect(screen.getByText("Public link")).toBeInTheDocument();
    expect(screen.getByText(/Portal · Live/)).toBeInTheDocument();
    expect(screen.getByText(/\/engage\/abcdef0123456789abcdef01/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    const openLink = screen.getByRole("link", { name: /Open/ });
    expect(openLink).toHaveAttribute("href", "/engage/abcdef0123456789abcdef01");
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(
      screen.getByText(/Share this URL publicly; every submission lands in this console's moderation queue\./)
    ).toBeInTheDocument();
  });

  it("shows Private with no URL when no share token exists", () => {
    render(<EngagementPublicLinkCompact campaign={campaign({ share_token: null })} />);

    expect(screen.getByText(/Portal · Private/)).toBeInTheDocument();
    expect(screen.queryByText(/\/engage\//)).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
    expect(screen.getByText(/public engagement page is offline/)).toBeInTheDocument();
  });

  it("never renders a copyable URL for a staged link and says why it is not live", () => {
    render(<EngagementPublicLinkCompact campaign={campaign({ status: "draft" })} />);

    expect(screen.getByText(/Portal · Staged/)).toBeInTheDocument();
    expect(screen.queryByText(/\/engage\//)).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.getByText(/only resolves when the campaign status is Active/)).toBeInTheDocument();
  });

  it("links down to the full share controls for detail work", () => {
    render(<EngagementPublicLinkCompact campaign={campaign()} />);

    expect(screen.getByRole("link", { name: /Manage sharing/ })).toHaveAttribute("href", "#public-share-controls");
  });
});
