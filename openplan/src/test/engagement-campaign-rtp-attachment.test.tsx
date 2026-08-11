import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * THE CAMPAIGN SIDE OF THE RTP↔ENGAGEMENT SEAM.
 *
 * `engagement_campaigns.rtp_cycle_id` / `rtp_cycle_chapter_id` were set only by
 * the RTP cycle page's creator, and the campaign console never mentioned them:
 * the attachment was invisible and uneditable from the campaign, so comments
 * collected for a plan had to be re-associated by hand. These assert what an
 * operator SEES and can CHANGE on the console — the current attachment, the
 * workspace's cycles and chapters as options, and the PATCH that carries the
 * choice — with every id coming from the fixture, so a component that hardcoded
 * a binding instead of threading it would fail.
 */

const CYCLE_A = "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CYCLE_B = "bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHAPTER_FINANCIAL = "cccc3333-cccc-4ccc-8ccc-cccccccccccc";
const CHAPTER_POLICY = "dddd4444-dddd-4ddd-8ddd-dddddddddddd";

const rtpTargets = {
  cycles: [
    {
      id: CYCLE_A,
      title: "2050 Regional Transportation Plan",
      status: "draft",
      chapters: [
        { id: CHAPTER_FINANCIAL, title: "Financial element" },
        { id: CHAPTER_POLICY, title: "Policy element" },
      ],
    },
    { id: CYCLE_B, title: "2045 Regional Transportation Plan", status: "adopted", chapters: [] },
  ],
};

function campaignFixture(overrides: Partial<Parameters<typeof EngagementCampaignControls>[0]["campaign"]> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "RTP listening campaign",
    summary: null,
    status: "active",
    engagement_type: "comment_collection",
    project_id: null,
    rtp_cycle_id: CYCLE_A,
    rtp_cycle_chapter_id: CHAPTER_FINANCIAL,
    ...overrides,
  };
}

type FetchCall = { url: string; init?: { method?: string; body?: string } };

function stubFetch({ rtpTargets: targets }: { rtpTargets: typeof rtpTargets | null }) {
  const patchBodies: Array<Record<string, unknown>> = [];
  const mock = vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (!init?.method || init.method === "GET") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mapFraming: resolvePortalMapFraming({}),
            submissionGeofence: { enabled: false, canEnable: false, areaState: "unset", areaLabel: null },
            rtpTargets: targets,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    }
    if (init.method === "PATCH") {
      patchBodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
    }
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });
  vi.stubGlobal("fetch", mock);
  return { mock: mock as unknown as { mock: { calls: Array<[FetchCall["url"], FetchCall["init"]]> } }, patchBodies };
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /^save campaign$/i }));
}

describe("the operator can see and change which RTP the campaign feeds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the stored attachment — the cycle and the chapter, by their titles", async () => {
    stubFetch({ rtpTargets });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={[]} />);

    const cycleSelect = (await screen.findByLabelText(/RTP attachment/)) as HTMLSelectElement;
    expect(cycleSelect.value).toBe(CYCLE_A);
    expect(screen.getByRole("option", { name: "2050 Regional Transportation Plan" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2045 Regional Transportation Plan" })).toBeInTheDocument();

    const chapterSelect = screen.getByLabelText(/Plan chapter/) as HTMLSelectElement;
    expect(chapterSelect.value).toBe(CHAPTER_FINANCIAL);
    expect(screen.getByRole("option", { name: "Financial element" })).toBeInTheDocument();
  });

  it("saves a chapter change through the same PATCH the rest of the metadata uses", async () => {
    const { patchBodies } = stubFetch({ rtpTargets });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={[]} />);

    const chapterSelect = (await screen.findByLabelText(/Plan chapter/)) as HTMLSelectElement;
    fireEvent.change(chapterSelect, { target: { value: CHAPTER_POLICY } });
    await save();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ rtpCycleId: CYCLE_A, rtpCycleChapterId: CHAPTER_POLICY });
  });

  it("resets the chapter when the cycle changes — a chapter may not outlive its plan", async () => {
    const { patchBodies } = stubFetch({ rtpTargets });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={[]} />);

    const cycleSelect = (await screen.findByLabelText(/RTP attachment/)) as HTMLSelectElement;
    fireEvent.change(cycleSelect, { target: { value: CYCLE_B } });

    // The old cycle's chapter list is gone with it.
    expect((screen.getByLabelText(/Plan chapter/) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("option", { name: "Financial element" })).not.toBeInTheDocument();

    await save();
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ rtpCycleId: CYCLE_B, rtpCycleChapterId: null });
  });

  it("clears the attachment entirely, chapter included", async () => {
    const { patchBodies } = stubFetch({ rtpTargets });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={[]} />);

    const cycleSelect = (await screen.findByLabelText(/RTP attachment/)) as HTMLSelectElement;
    fireEvent.change(cycleSelect, { target: { value: "" } });

    // No cycle → no chapter select at all; a chapter cannot be chosen without
    // a cycle, structurally rather than by validation message.
    expect(screen.queryByLabelText(/Plan chapter/)).not.toBeInTheDocument();

    await save();
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ rtpCycleId: null, rtpCycleChapterId: null });
  });

  it("offers no chapter control on a campaign attached to nothing", async () => {
    stubFetch({ rtpTargets });

    render(
      <EngagementCampaignControls
        campaign={campaignFixture({ rtp_cycle_id: null, rtp_cycle_chapter_id: null })}
        projects={[]}
      />
    );

    const cycleSelect = (await screen.findByLabelText(/RTP attachment/)) as HTMLSelectElement;
    expect(cycleSelect.value).toBe("");
    expect(screen.queryByLabelText(/Plan chapter/)).not.toBeInTheDocument();
  });

  it("says the options could not be read — and does not send the fields — when the server answers null", async () => {
    const { patchBodies } = stubFetch({ rtpTargets: null });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={[]} />);

    // Unknown, not "no cycles": a failed read must never tell an operator the
    // workspace has no plans, and it must not be able to detach this campaign.
    expect(await screen.findByText(/RTP cycles in this workspace could not be read/i)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Regional Transportation Plan/ })).not.toBeInTheDocument();

    await save();
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).not.toHaveProperty("rtpCycleId");
    expect(patchBodies[0]).not.toHaveProperty("rtpCycleChapterId");
  });
});
