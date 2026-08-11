import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE GUIDED PUBLISH FLOW, in isolation.
 *
 * The component's whole claim is that its steps ARE `getPublicPortalReadiness`
 * over the SAVED campaign row — not a second checklist that can disagree with
 * the portal gate — and that every step acts through the endpoints the console
 * already has (POST …/share-token, PATCH …/campaigns/{id}). So these tests
 * vary the campaign row and assert the steps follow it, and they assert the
 * exact endpoint and body each button sends. Campaign ids differ between tests
 * on purpose: a flow that hardcoded one id would pass a single-fixture suite.
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { CampaignPublishFlow, type PublishFlowCampaign } from "@/components/engagement/campaign-publish-flow";

function campaign(overrides: Partial<PublishFlowCampaign> = {}): PublishFlowCampaign {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    status: "draft",
    share_token: null,
    public_description: null,
    allow_public_submissions: false,
    submissions_closed_at: null,
    ...overrides,
  };
}

const UNSET_AREA = { state: "unset" as const, label: null };

function stubFetch(body: unknown = { success: true }, status = 200) {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const fn = vi.fn(async (url: string | URL, init?: { method?: string; body?: string }) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("CampaignPublishFlow", () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("steps derive from the saved campaign row", () => {
    it("shows all four steps open for a brand-new draft", () => {
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      expect(screen.getByText(/0 of 4 steps complete/i)).toBeInTheDocument();
      for (const id of ["share_token", "public_description", "submission_mode", "active_status"]) {
        expect(screen.getByTestId(`publish-step-${id}`)).toHaveAttribute("data-state", "todo");
      }
      expect(screen.getByRole("button", { name: /Generate link/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Save description/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Accept public submissions/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Set the campaign to Active/i })).toBeInTheDocument();
    });

    it("reads explicitly closed submissions as a completed intake decision", () => {
      // View-only by design: submissions closed counts as an explicit posture,
      // exactly as the readiness lib scores it.
      render(
        <CampaignPublishFlow
          campaign={campaign({
            share_token: "tok-view-only-1234567890abcdef",
            public_description: "A public description long enough to count as real context.",
            submissions_closed_at: "2026-05-01T00:00:00.000Z",
          })}
          campaignArea={UNSET_AREA}
        />
      );

      expect(screen.getByText(/3 of 4 steps complete/i)).toBeInTheDocument();
      expect(screen.getByTestId("publish-step-share_token")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("publish-step-public_description")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("publish-step-submission_mode")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("publish-step-active_status")).toHaveAttribute("data-state", "todo");
      // A done step offers no action.
      expect(screen.queryByRole("button", { name: /Generate link/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Accept public submissions/i })).not.toBeInTheDocument();
    });

    it("does not count a description shorter than the readiness minimum as done", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign({ public_description: "Too short." })}
          campaignArea={UNSET_AREA}
        />
      );

      expect(screen.getByTestId("publish-step-public_description")).toHaveAttribute("data-state", "todo");
    });

    it("warns that a staged link is not yet reachable", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign({ share_token: "tok-staged-1234567890abcdef" })}
          campaignArea={UNSET_AREA}
        />
      );

      expect(
        screen.getByText(/do not put it on outreach materials before then/i)
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Open portal/i })).not.toBeInTheDocument();
    });

    it("collapses to the live URL and status summary once the portal is reachable", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign({
            status: "active",
            share_token: "tok-live-1234567890abcdefgh",
            allow_public_submissions: true,
          })}
          campaignArea={UNSET_AREA}
        />
      );

      const flow = screen.getByTestId("campaign-publish-flow");
      expect(within(flow).getByText(/This campaign is live/i)).toBeInTheDocument();
      expect(within(flow).getByText(/Live · accepting submissions/i)).toBeInTheDocument();
      expect(within(flow).getByText(new RegExp("/engage/tok-live-1234567890abcdefgh"))).toBeInTheDocument();
      expect(within(flow).getByRole("link", { name: /Open portal/i })).toHaveAttribute(
        "href",
        "/engage/tok-live-1234567890abcdefgh"
      );
      expect(screen.queryByTestId("publish-step-share_token")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Set the campaign to Active/i })).not.toBeInTheDocument();
    });

    it("links the resident preview for this campaign in both states", () => {
      const { unmount } = render(
        <CampaignPublishFlow campaign={campaign({ id: "aaaa1111-1111-4111-8111-111111111111" })} campaignArea={UNSET_AREA} />
      );
      expect(screen.getByRole("link", { name: /Preview the resident view/i })).toHaveAttribute(
        "href",
        "/engagement/aaaa1111-1111-4111-8111-111111111111/preview"
      );
      unmount();

      render(
        <CampaignPublishFlow
          campaign={campaign({
            id: "bbbb2222-2222-4222-8222-222222222222",
            status: "active",
            share_token: "tok-live-1234567890abcdefgh",
          })}
          campaignArea={UNSET_AREA}
        />
      );
      expect(screen.getByRole("link", { name: /Preview the resident view/i })).toHaveAttribute(
        "href",
        "/engagement/bbbb2222-2222-4222-8222-222222222222/preview"
      );
    });
  });

  describe("each step acts through the console's existing endpoints", () => {
    it("mints the link through POST …/share-token for this campaign", async () => {
      const calls = stubFetch();
      render(
        <CampaignPublishFlow
          campaign={campaign({ id: "cccc3333-3333-4333-8333-333333333333" })}
          campaignArea={UNSET_AREA}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Generate link/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls).toEqual([
        {
          url: "/api/engagement/campaigns/cccc3333-3333-4333-8333-333333333333/share-token",
          method: "POST",
          body: null,
        },
      ]);
    });

    it("saves the typed description through PATCH …/campaigns/{id}", async () => {
      const calls = stubFetch();
      render(
        <CampaignPublishFlow
          campaign={campaign({ id: "dddd4444-4444-4444-8444-444444444444" })}
          campaignArea={UNSET_AREA}
        />
      );

      fireEvent.change(screen.getByPlaceholderText(/Describe the project/i), {
        target: { value: "We are updating the corridor plan and want your route feedback." },
      });
      fireEvent.click(screen.getByRole("button", { name: /Save description/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls).toEqual([
        {
          url: "/api/engagement/campaigns/dddd4444-4444-4444-8444-444444444444",
          method: "PATCH",
          body: { publicDescription: "We are updating the corridor plan and want your route feedback." },
        },
      ]);
    });

    it("turns on public submissions through the same PATCH", async () => {
      const calls = stubFetch();
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(screen.getByRole("button", { name: /Accept public submissions/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls[0]?.body).toEqual({ allowPublicSubmissions: true });
      expect(calls[0]?.method).toBe("PATCH");
    });

    it("activates the campaign through the same PATCH", async () => {
      const calls = stubFetch();
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(screen.getByRole("button", { name: /Set the campaign to Active/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls[0]?.body).toEqual({ status: "active" });
      expect(calls[0]?.method).toBe("PATCH");
    });

    it("shows the server's own refusal and does not pretend the step saved", async () => {
      stubFetch({ error: "Workspace access denied" }, 403);
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(screen.getByRole("button", { name: /Set the campaign to Active/i }));

      expect(await screen.findByText(/Workspace access denied/)).toBeInTheDocument();
      expect(screen.getByText(/That step did not save/i)).toBeInTheDocument();
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  describe("the campaign-area advisory", () => {
    it("states the consequences of publishing with no area", () => {
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      const advisory = screen.getByTestId("publish-area-advisory");
      expect(advisory).toHaveTextContent(/resident map opens without a boundary you chose/i);
      expect(advisory).toHaveTextContent(/location check .* cannot be turned on/i);
    });

    it("names the area when one is on record", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign()}
          campaignArea={{ state: "set", label: "Franklin County, Ohio" }}
        />
      );

      expect(screen.getByTestId("publish-area-advisory")).toHaveTextContent(
        /Campaign area on record: Franklin County, Ohio/
      );
    });

    it("never renders a failed area read as a missing area", () => {
      render(
        <CampaignPublishFlow campaign={campaign()} campaignArea={{ state: "unreadable", label: null }} />
      );

      const advisory = screen.getByTestId("publish-area-advisory");
      expect(advisory).toHaveTextContent(/failed read, not a missing area/i);
      expect(screen.queryByText(/No campaign area is set/i)).not.toBeInTheDocument();
    });
  });
});
