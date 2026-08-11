import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    title: "Downtown listening",
    status: "active",
    share_token: "abcdef0123456789abcdef01",
    public_description: "Tell us about downtown.",
    public_slug: null,
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
    ...overrides,
  };
}

const fetchMock = vi.fn();
const confirmMock = vi.fn();

describe("EngagementShareControls server-minted link flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, shareToken: "x".repeat(28) }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no longer offers a free-text share token input", () => {
    render(<EngagementShareControls campaign={campaign()} />);

    expect(screen.queryByLabelText(/Share token/)).toBeNull();
    expect(screen.queryByPlaceholderText(/No share token/)).toBeNull();
  });

  it("regenerates only after a confirm that names the consequence, via the server endpoint", async () => {
    confirmMock.mockReturnValue(true);
    render(<EngagementShareControls campaign={campaign()} />);

    fireEvent.click(screen.getByRole("button", { name: /Regenerate link/ }));

    expect(confirmMock).toHaveBeenCalledWith(expect.stringMatching(/current link stops working immediately/));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/engagement/campaigns/c1/share-token", { method: "POST" });
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("does nothing when the regenerate confirm is declined", () => {
    confirmMock.mockReturnValue(false);
    render(<EngagementShareControls campaign={campaign()} />);

    fireEvent.click(screen.getByRole("button", { name: /Regenerate link/ }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generates a first link without a confirm when no token exists yet", async () => {
    render(<EngagementShareControls campaign={campaign({ share_token: null })} />);

    expect(screen.queryByRole("button", { name: /Regenerate link/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Generate link/ }));

    expect(confirmMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/engagement/campaigns/c1/share-token", { method: "POST" });
    });
  });

  it("disables the link through PATCH with a null token after confirmation", async () => {
    confirmMock.mockReturnValue(true);
    render(<EngagementShareControls campaign={campaign()} />);

    fireEvent.click(screen.getByRole("button", { name: /Disable link/ }));

    expect(confirmMock).toHaveBeenCalledWith(expect.stringMatching(/stops resolving immediately/));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/engagement/campaigns/c1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ shareToken: null }),
        })
      );
    });
  });

  it("saving share settings never sends a token", async () => {
    render(<EngagementShareControls campaign={campaign()} />);

    fireEvent.click(screen.getByRole("button", { name: /Save share settings/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).not.toHaveProperty("shareToken");
  });
});
