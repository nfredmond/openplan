import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignCreator } from "@/components/engagement/engagement-campaign-creator";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const fetchMock = vi.fn();


/**
 * The creator is a guided flow now: the form lives behind a "New campaign"
 * button, and its answers are spread over three steps. These helpers open it
 * and walk it.
 *
 * WHAT THESE TESTS CANNOT PROVE: anything visual. jsdom applies no stylesheet
 * and has no box model, so it cannot show that the sheet is on screen,
 * full-height on a phone, that focus moved into it, or that the page behind is
 * inert. `src/test/guided-flow-jsdom-dialog-shim.ts` only supplies `showModal`
 * so the component mounts. Layout is measured in a real browser.
 */
function openFlow() {
  fireEvent.click(screen.getByRole("button", { name: /^new campaign$/i }));
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
}

function submitFlow() {
  fireEvent.click(screen.getByRole("button", { name: /^create campaign$/i }));
}

describe("EngagementCampaignCreator create-success surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preselects the project carried in planning context", () => {
    render(
      <EngagementCampaignCreator
        projects={[
          { id: "project-1", name: "Downtown Mobility Plan" },
          { id: "project-2", name: "Transit Access Plan" },
        ]}
        initialProjectId="project-2"
      />
    );

    openFlow();
    next();
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Listening" } });
    next();
    expect(screen.getByLabelText("Linked project (optional)")).toHaveValue("project-2");
  });

  it("does not trust an initial project outside the available workspace list", () => {
    render(
      <EngagementCampaignCreator
        projects={[{ id: "project-1", name: "Downtown Mobility Plan" }]}
        initialProjectId="cross-workspace-project"
      />
    );

    openFlow();
    next();
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Listening" } });
    next();
    expect(screen.getByLabelText("Linked project (optional)")).toHaveValue("");
  });

  it("lands the new campaign console with the created flag so the public-link explainer shows", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ campaignId: "campaign-9" }),
    });

    render(<EngagementCampaignCreator projects={[]} />);

    openFlow();
    next();
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Corridor listening" } });
    next();
    submitFlow();

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

    openFlow();
    next();
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Corridor listening" } });
    next();
    submitFlow();

    await waitFor(() => {
      expect(screen.getByText(/Failed to create engagement campaign/)).toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
