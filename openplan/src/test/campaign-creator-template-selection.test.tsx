import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignCreator } from "@/components/engagement/engagement-campaign-creator";
import { CAMPAIGN_TEMPLATES } from "@/lib/engagement/campaign-templates";

/**
 * The template picker in the campaign creator: choosing a template sends its id
 * to the server, prefills the editable fields from the REGISTRY ENTRY CHOSEN
 * (expectations derived per-template, and the suite runs two templates so a
 * component hardcoding one template's values fails the other binding), and the
 * default stays a blank campaign. A partially-applied template is reported
 * honestly instead of navigating away from the message.
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const fetchMock = vi.fn();

function sentBody(): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
}

// Two different templates: varied binding.
const TEMPLATE_BINDINGS = [CAMPAIGN_TEMPLATES[0], CAMPAIGN_TEMPLATES[CAMPAIGN_TEMPLATES.length - 1]];


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

describe("EngagementCampaignCreator template selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(TEMPLATE_BINDINGS.map((t) => [t.id, t] as const))(
    "sends %s and prefills the form from that template's own registry entry",
    async (_id, template) => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ campaignId: "campaign-1", template: { id: template.id, applied: true } }),
      });

      render(<EngagementCampaignCreator projects={[]} />);

      openFlow();
      fireEvent.change(screen.getByLabelText(/Start from a template/), { target: { value: template.id } });

      // The planner is told what will be created, and that questions are drafts.
      expect(screen.getByText(/arrive as drafts/i)).toBeInTheDocument();

      next();
      // Prefills come from the chosen entry, not from any fixed template.
      expect((screen.getByLabelText(/Engagement type/) as HTMLSelectElement).value).toBe(template.engagementType);
      fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Templated campaign" } });

      next();
      expect((screen.getByLabelText(/Summary/) as HTMLTextAreaElement).value).toBe(template.suggestedSummary);

      submitFlow();

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/engagement/campaign-1?created=1");
      });
      expect(sentBody().templateId).toBe(template.id);
      expect(sentBody().engagementType).toBe(template.engagementType);
    }
  );

  it("sends no templateId for the default blank campaign", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ campaignId: "campaign-2" }) });

    render(<EngagementCampaignCreator projects={[]} />);

    openFlow();
    next();
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Blank campaign" } });
    next();
    submitFlow();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/engagement/campaign-2?created=1");
    });
    expect(sentBody().templateId).toBeUndefined();
  });

  it("says so on the page, and does not navigate, when the template was not fully applied", async () => {
    const template = CAMPAIGN_TEMPLATES[0];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        campaignId: "campaign-3",
        template: { id: template.id, applied: false, error: 'The "Crossing safety" category could not be created.' },
      }),
    });

    render(<EngagementCampaignCreator projects={[]} />);

    openFlow();
    fireEvent.change(screen.getByLabelText(/Start from a template/), { target: { value: template.id } });
    next();
    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: "Half-applied" } });
    next();
    submitFlow();

    await waitFor(() => {
      expect(screen.getByText(/could not be fully applied/i)).toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });
});
