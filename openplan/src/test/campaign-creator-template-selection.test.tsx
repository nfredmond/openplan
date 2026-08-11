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

      fireEvent.change(screen.getByLabelText(/Start from a template/), { target: { value: template.id } });

      // Prefills come from the chosen entry, not from any fixed template.
      expect((screen.getByLabelText(/Summary/) as HTMLTextAreaElement).value).toBe(template.suggestedSummary);
      expect((screen.getByLabelText(/Engagement type/) as HTMLSelectElement).value).toBe(template.engagementType);
      // The planner is told what will be created, and that questions are drafts.
      expect(screen.getByText(/arrive as drafts/i)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Templated campaign" } });
      fireEvent.submit(screen.getByRole("button", { name: /Create campaign/ }).closest("form")!);

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

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Blank campaign" } });
    fireEvent.submit(screen.getByRole("button", { name: /Create campaign/ }).closest("form")!);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/engagement/campaign-2?created=1");
    });
    expect(sentBody().templateId).toBeUndefined();
  });

  it("stays put and says so when the campaign was created but the template was not fully applied", async () => {
    const template = CAMPAIGN_TEMPLATES[0];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        campaignId: "campaign-3",
        template: { id: template.id, applied: false, error: 'The "Crossing safety" category could not be created.' },
      }),
    });

    render(<EngagementCampaignCreator projects={[]} />);

    fireEvent.change(screen.getByLabelText(/Start from a template/), { target: { value: template.id } });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Half-applied" } });
    fireEvent.submit(screen.getByRole("button", { name: /Create campaign/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/could not be fully applied/i)).toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });
});
