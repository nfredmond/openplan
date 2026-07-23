import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    title: "Downtown listening",
    status: "active",
    share_token: "abcdef0123456789abcdef01",
    public_description: "Tell us about downtown.",
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
    ...overrides,
  };
}

describe("EngagementShareControls embed snippet", () => {
  it("shows a copy-paste iframe snippet once the portal is publicly reachable", () => {
    render(<EngagementShareControls campaign={campaign()} />);
    expect(screen.getByText("Embed on your website")).toBeTruthy();
    const snippet = screen.getByText(/<iframe/);
    expect(snippet.textContent).toContain("/embed/abcdef0123456789abcdef01");
    expect(snippet.textContent).toContain('title="Downtown listening"');
  });

  it("HTML-attribute-escapes the campaign title so a crafted title cannot inject markup", () => {
    render(<EngagementShareControls campaign={campaign({ title: 'x" onload="alert(1)' })} />);
    const snippet = screen.getByText(/<iframe/);
    const text = snippet.textContent ?? "";
    // The raw breakout sequence must NOT appear; the escaped form must.
    expect(text).not.toContain('title="x" onload="alert(1)"');
    expect(text).toContain("&quot;");
    expect(text).toContain('title="x&quot; onload=&quot;alert(1)"');
  });

  it("hides the embed snippet when the campaign is not publicly reachable (no token)", () => {
    render(<EngagementShareControls campaign={campaign({ share_token: null })} />);
    expect(screen.queryByText("Embed on your website")).toBeNull();
  });
});
