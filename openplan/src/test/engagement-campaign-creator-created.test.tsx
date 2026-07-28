import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignCreator } from "@/components/engagement/engagement-campaign-creator";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const fetchMock = vi.fn();

describe("EngagementCampaignCreator create-success surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lands the new campaign console with the created flag so the public-link explainer shows", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ campaignId: "campaign-9" }),
    });

    render(<EngagementCampaignCreator projects={[]} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Corridor listening" } });
    fireEvent.submit(screen.getByRole("button", { name: /Create campaign/ }).closest("form")!);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/engagement/campaign-9?created=1");
    });
  });

  it("stays put and shows the error when creation fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Failed to create engagement campaign" }),
    });

    render(<EngagementCampaignCreator projects={[]} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Corridor listening" } });
    fireEvent.submit(screen.getByRole("button", { name: /Create campaign/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/Failed to create engagement campaign/)).toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
