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
    participation_starts_at: null,
    participation_ends_at: null,
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
    // Five steps since 2026-08-15: "where the resident map opens" joined the
    // list after a tester published a campaign with no area and a pin landed in
    // the middle of the country. These counts moved with it; the invariant they
    // guard — that the steps come from the SAVED row, never from local state —
    // is unchanged.
    it("shows every step open for a brand-new draft", () => {
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      expect(screen.getByText(/0 of 5 steps complete/i)).toBeInTheDocument();
      for (const id of [
        "share_token",
        "public_description",
        "submission_mode",
        "active_status",
        "map_opens_somewhere",
      ]) {
        expect(screen.getByTestId(`publish-step-${id}`)).toHaveAttribute("data-state", "todo");
      }
      expect(screen.getByRole("button", { name: /Generate link/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Save description/i })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Accept comments from residents/i })).not.toBeChecked();
      expect(screen.getByRole("button", { name: /Choose an area/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Set to Active/i })).toBeInTheDocument();
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

      expect(screen.getByText(/3 of 5 steps complete/i)).toBeInTheDocument();
      expect(screen.getByTestId("publish-step-share_token")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("publish-step-public_description")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("publish-step-submission_mode")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("publish-step-active_status")).toHaveAttribute("data-state", "todo");
      // A done step offers no action, except the comments step, which stays
      // so a planner can change it. Closed comments are reopened, not toggled.
      expect(screen.queryByRole("button", { name: /Generate link/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Save description/i })).not.toBeInTheDocument();
      const step = screen.getByTestId("publish-step-submission_mode");
      expect(within(step).getByText(/Comments are closed, so the page is view only/i)).toBeInTheDocument();
      expect(within(step).getByRole("button", { name: /Reopen comments/i })).toBeInTheDocument();
      expect(within(step).queryByRole("checkbox")).not.toBeInTheDocument();
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
        screen.getByText(/do not put this link on outreach materials until the page is live/i)
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
      expect(within(flow).getByRole("heading", { name: /The public page is live/i })).toBeInTheDocument();
      expect(within(flow).getByText(/Live · accepting submissions/i)).toBeInTheDocument();
      expect(within(flow).getByText(new RegExp("/engage/tok-live-1234567890abcdefgh"))).toBeInTheDocument();
      expect(within(flow).getByRole("link", { name: /Open portal/i })).toHaveAttribute(
        "href",
        "/engage/tok-live-1234567890abcdefgh"
      );
      expect(screen.queryByTestId("publish-step-share_token")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Set to Active/i })).not.toBeInTheDocument();
    });

    it("links the resident preview for this campaign in both states", () => {
      const { unmount } = render(
        <CampaignPublishFlow campaign={campaign({ id: "aaaa1111-1111-4111-8111-111111111111" })} campaignArea={UNSET_AREA} />
      );
      // Before going live the preview is its own step in the checklist.
      expect(
        within(screen.getByTestId("publish-step-preview")).getByRole("link", { name: /Preview as a resident/i })
      ).toHaveAttribute(
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
      expect(screen.getByRole("link", { name: /Preview as a resident/i })).toHaveAttribute(
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

    it("turns comments on through the same PATCH, from the comments step itself", async () => {
      const calls = stubFetch();
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(
        within(screen.getByTestId("publish-step-submission_mode")).getByRole("checkbox", {
          name: /Accept comments from residents/i,
        })
      );

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls[0]?.body).toEqual({ allowPublicSubmissions: true });
      expect(calls[0]?.method).toBe("PATCH");
      expect(calls[0]?.url).toBe("/api/engagement/campaigns/22222222-2222-4222-8222-222222222222");
    });

    it("turns comments off again through the same PATCH, reading the saved row", async () => {
      const calls = stubFetch();
      render(
        <CampaignPublishFlow campaign={campaign({ allow_public_submissions: true })} campaignArea={UNSET_AREA} />
      );

      const toggle = screen.getByRole("checkbox", { name: /Accept comments from residents/i });
      expect(toggle).toBeChecked();
      // The moderation rule is said where comments are switched on.
      expect(screen.getByTestId("publish-step-submission_mode")).toHaveTextContent(/waits for staff review/i);
      fireEvent.click(toggle);

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls[0]?.body).toEqual({ allowPublicSubmissions: false });
    });

    it("activates the campaign through the same PATCH", async () => {
      const calls = stubFetch();
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(screen.getByRole("button", { name: /Set to Active/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls[0]?.body).toEqual({ status: "active" });
      expect(calls[0]?.method).toBe("PATCH");
    });

    it("closes comments on a live page through the same PATCH", async () => {
      const calls = stubFetch();
      render(
        <CampaignPublishFlow
          campaign={campaign({
            id: "ffff6666-6666-4666-8666-666666666666",
            status: "active",
            share_token: "tok-live-1234567890abcdefgh",
            allow_public_submissions: true,
          })}
          campaignArea={UNSET_AREA}
        />
      );

      expect(screen.queryByRole("button", { name: /Reopen comments/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Close comments/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls).toEqual([
        {
          url: "/api/engagement/campaigns/ffff6666-6666-4666-8666-666666666666",
          method: "PATCH",
          body: { submissionsClosed: true },
        },
      ]);
    });

    it("shows a closed live page as view only and reopens it through the same PATCH", async () => {
      const calls = stubFetch();
      render(
        <CampaignPublishFlow
          campaign={campaign({
            id: "abab7777-7777-4777-8777-777777777777",
            status: "active",
            share_token: "tok-live-1234567890abcdefgh",
            allow_public_submissions: true,
            submissions_closed_at: "2026-04-02T09:30:00.000Z",
          })}
          campaignArea={UNSET_AREA}
        />
      );

      const flow = screen.getByTestId("campaign-publish-flow");
      expect(within(flow).getByText(/Live · submissions closed/i)).toBeInTheDocument();
      expect(within(flow).queryByRole("button", { name: /Close comments/i })).not.toBeInTheDocument();
      fireEvent.click(within(flow).getByRole("button", { name: /Reopen comments/i }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(calls).toEqual([
        {
          url: "/api/engagement/campaigns/abab7777-7777-4777-8777-777777777777",
          method: "PATCH",
          body: { submissionsClosed: false },
        },
      ]);
    });

    /*
      A reopen after the participation end date would clear the close time and
      change nothing residents see, because the public page, the submit routes
      and the database all refuse comments after that date. The flow names the
      date and sends the planner to it instead of offering the reopen.
    */
    it("names a past end date instead of offering a reopen that would not reopen", () => {
      for (const [timeZone, named] of [
        ["America/Los_Angeles", "October 10, 2026 at 19:30 (America/Los_Angeles)"],
        ["Pacific/Auckland", "October 11, 2026 at 15:30 (Pacific/Auckland)"],
      ] as const) {
        const { unmount } = render(
          <CampaignPublishFlow
            campaign={campaign({
              status: "active",
              share_token: "tok-live-1234567890abcdefgh",
              allow_public_submissions: true,
              submissions_closed_at: "2026-10-01T09:30:00.000Z",
              participation_ends_at: "2026-10-11T02:30:00+00:00",
            })}
            campaignArea={UNSET_AREA}
            timeZone={timeZone}
          />
        );

        const flow = screen.getByTestId("campaign-publish-flow");
        expect(flow).toHaveTextContent(`Comments are closed because the participation period ended on ${named}.`);
        expect(flow).not.toHaveTextContent(/accepting submissions/i);
        expect(within(flow).queryByRole("button", { name: /Reopen comments/i })).not.toBeInTheDocument();
        expect(within(flow).queryByRole("button", { name: /Close comments/i })).not.toBeInTheDocument();
        expect(within(flow).getByRole("link", { name: /Change the end date/i })).toHaveAttribute(
          "href",
          "#campaign-control-participation-ends"
        );
        unmount();
      }
    });

    it("says a reopened page is closed by its end date, and offers no switch that does nothing", () => {
      // Reopened (no close time) but past the end date: the state a planner
      // reached before this change, when the console said "accepting".
      render(
        <CampaignPublishFlow
          campaign={campaign({
            status: "active",
            share_token: "tok-live-1234567890abcdefgh",
            allow_public_submissions: true,
            submissions_closed_at: null,
            participation_ends_at: "2026-10-11T02:30:00+00:00",
          })}
          campaignArea={UNSET_AREA}
          timeZone="America/Los_Angeles"
        />
      );

      const flow = screen.getByTestId("campaign-publish-flow");
      expect(within(flow).getByText(/Live · submissions closed/i)).toBeInTheDocument();
      expect(flow).not.toHaveTextContent(/accepting submissions/i);
      expect(within(flow).queryByRole("button", { name: /Close comments/i })).not.toBeInTheDocument();
      expect(within(flow).getByRole("link", { name: /Change the end date/i })).toBeInTheDocument();
    });

    it("puts the end date in the comments step before the page is live", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign({
            allow_public_submissions: true,
            participation_ends_at: "2026-10-11T02:30:00+00:00",
          })}
          campaignArea={UNSET_AREA}
          timeZone="America/Los_Angeles"
        />
      );

      const step = screen.getByTestId("publish-step-submission_mode");
      expect(step).toHaveTextContent(
        "Comments are closed because the participation period ended on October 10, 2026 at 19:30 (America/Los_Angeles)."
      );
      expect(within(step).queryByRole("checkbox")).not.toBeInTheDocument();
      expect(within(step).getByRole("link", { name: /Change the end date/i })).toBeInTheDocument();
    });

    it("offers nothing to close on a view-only page that never took comments", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign({
            status: "active",
            share_token: "tok-live-1234567890abcdefgh",
            allow_public_submissions: false,
          })}
          campaignArea={UNSET_AREA}
        />
      );

      expect(screen.queryByRole("button", { name: /Close comments/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Reopen comments/i })).not.toBeInTheDocument();
    });

    it("shows the server's own refusal and does not pretend the step saved", async () => {
      stubFetch({ error: "Workspace access denied" }, 403);
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(screen.getByRole("button", { name: /Set to Active/i }));

      expect(await screen.findByText(/Workspace access denied/)).toBeInTheDocument();
      expect(screen.getByText(/That step did not save/i)).toBeInTheDocument();
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  describe("the map area step", () => {
    it("states the consequence of publishing with no area and offers the picker", () => {
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      const step = screen.getByTestId("publish-step-map_opens_somewhere");
      expect(within(step).getByTestId("publish-area-advisory")).toHaveTextContent(/middle of the country/i);
      expect(within(step).getByRole("button", { name: /Choose an area/i })).toBeInTheDocument();
      // No project area to copy, so no one-click copy is offered.
      expect(within(step).queryByRole("button", { name: /Use the project's area/i })).not.toBeInTheDocument();
    });

    it("names the area when one is on record and offers nothing to set", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign()}
          campaignArea={{ state: "set", label: "Franklin County, Ohio" }}
        />
      );

      const step = screen.getByTestId("publish-step-map_opens_somewhere");
      expect(step).toHaveAttribute("data-state", "done");
      expect(within(step).getByTestId("publish-area-advisory")).toHaveTextContent(
        "The map opens on Franklin County, Ohio."
      );
      expect(within(step).queryByRole("button")).not.toBeInTheDocument();
    });

    it("counts the linked project's area, which the resident map falls back to", () => {
      render(
        <CampaignPublishFlow
          campaign={campaign()}
          campaignArea={{ state: "set", label: "Placer County, California", source: "project" }}
          projectArea={{ kind: "county", geoid: "06061", label: "Placer County, California" }}
        />
      );

      const step = screen.getByTestId("publish-step-map_opens_somewhere");
      expect(step).toHaveAttribute("data-state", "done");
      expect(within(step).getByTestId("publish-area-advisory")).toHaveTextContent(
        "The map opens on the project's area, Placer County, California."
      );
      expect(screen.queryByText(/middle of the country/i)).not.toBeInTheDocument();
      // Copying the area the map already opens on would change nothing.
      expect(within(step).queryByRole("button", { name: /Use the project's area/i })).not.toBeInTheDocument();
      expect(within(step).getByRole("button", { name: /Choose another area/i })).toBeInTheDocument();
      expect(screen.getByText(/1 of 5 steps complete/i)).toBeInTheDocument();
    });

    it("counts the workspace home area, which the resident map falls back to after the project's", () => {
      for (const label of ["Nevada County, California", "Franklin County, Ohio"]) {
        const { unmount } = render(
          <CampaignPublishFlow
            campaign={campaign()}
            campaignArea={{ state: "set", label, source: "workspace" }}
            projectArea={{ kind: "county", geoid: "06061", label: "Placer County, California" }}
          />
        );

        const step = screen.getByTestId("publish-step-map_opens_somewhere");
        expect(step).toHaveAttribute("data-state", "done");
        expect(within(step).getByTestId("publish-area-advisory")).toHaveTextContent(
          `The map opens on the workspace's home area, ${label}.`
        );
        expect(screen.queryByText(/middle of the country/i)).not.toBeInTheDocument();
        // The project's area is narrower than the workspace home and is not
        // what the map opens on, so it is still offered.
        expect(
          within(step).getByRole("button", { name: "Use the project's area: Placer County, California" })
        ).toBeInTheDocument();
        expect(within(step).getByRole("button", { name: /Choose another area/i })).toBeInTheDocument();
        expect(screen.getByText(/1 of 5 steps complete/i)).toBeInTheDocument();
        unmount();
      }
    });

    it("never renders a failed area read as a missing area", () => {
      render(
        <CampaignPublishFlow campaign={campaign()} campaignArea={{ state: "unreadable", label: null }} />
      );

      const step = screen.getByTestId("publish-step-map_opens_somewhere");
      expect(within(step).getByTestId("publish-area-advisory")).toHaveTextContent(/failed read, not a missing area/i);
      expect(screen.queryByText(/middle of the country/i)).not.toBeInTheDocument();
      // Nothing to set: an area may already be on record.
      expect(within(step).queryByRole("button")).not.toBeInTheDocument();
    });

    it("copies the linked project's area by reference, through the campaign PATCH", async () => {
      // Two different places, so a step that hardcoded one would fail.
      for (const [index, projectArea] of [
        { kind: "county" as const, geoid: "06061", label: "Placer County, California" },
        { kind: "city" as const, geoid: "3918000", label: "Columbus city, Ohio" },
      ].entries()) {
        const calls = stubFetch();
        refreshMock.mockClear();
        const { unmount } = render(
          <CampaignPublishFlow
            campaign={campaign({ id: `eeee555${index}-5555-4555-8555-555555555555` })}
            campaignArea={UNSET_AREA}
            projectArea={projectArea}
          />
        );

        fireEvent.click(screen.getByRole("button", { name: `Use the project's area: ${projectArea.label}` }));

        await waitFor(() => expect(refreshMock).toHaveBeenCalled());
        expect(calls).toEqual([
          {
            url: `/api/engagement/campaigns/eeee555${index}-5555-4555-8555-555555555555`,
            method: "PATCH",
            body: { place: { mode: "place", ...projectArea } },
          },
        ]);
        unmount();
        vi.unstubAllGlobals();
      }
    });

    it("opens the shared picker inline and refuses to save an empty area", async () => {
      const calls = stubFetch();
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      fireEvent.click(screen.getByRole("button", { name: /Choose an area/i }));
      const step = screen.getByTestId("publish-step-map_opens_somewhere");
      await waitFor(() => expect(within(step).getByLabelText("Search for a place")).toBeInTheDocument());

      fireEvent.click(within(step).getByRole("button", { name: /Save area/i }));

      expect(await screen.findByText(/Search for a place or draw an area before saving/i)).toBeInTheDocument();
      expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
    });
  });

  describe("the checklist holds every step a first public page needs, in order", () => {
    /*
      THE DEFECT THIS CLOSES. The map area and the comments switch were set at
      the bottom of a twelve-section Setup tab, and the only preview was a link
      beside the saved URL. These read the steps in DOM order, so moving one out
      of the checklist, or back below "Go live", fails here.
    */
    it("puts the map area, comments and the preview before going live", () => {
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      const order = within(screen.getByTestId("campaign-publish-flow"))
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-testid"));
      expect(order).toEqual([
        "publish-step-share_token",
        "publish-step-public_description",
        "publish-step-map_opens_somewhere",
        "publish-step-submission_mode",
        "publish-step-preview",
        "publish-step-active_status",
      ]);
    });

    it("counts only the readiness checks, so the header and the numbers agree", () => {
      render(<CampaignPublishFlow campaign={campaign()} campaignArea={UNSET_AREA} />);

      // Five counted steps, numbered one to five; the preview is not a check and is not numbered.
      expect(screen.getByText(/0 of 5 steps complete/i)).toBeInTheDocument();
      const markers = within(screen.getByTestId("campaign-publish-flow"))
        .getAllByRole("listitem")
        .map((item) => item.querySelector("[aria-hidden='true']")?.textContent ?? "");
      expect(markers).toEqual(["1", "2", "3", "4", "", "5"]);
      expect(screen.getByTestId("publish-step-preview")).toHaveAttribute("data-state", "optional");
    });
  });
});
