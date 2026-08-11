import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * THE CONSOLE SIDE OF ONE-CAMPAIGN-SEVERAL-PROJECTS (20260810000003).
 *
 * What an operator sees and can change: the covered-project checkboxes seeded
 * from the GET's `linkedProjectIds`, the lead pinned inside the set, and the
 * PATCH that carries the WHOLE set. And the honesty rule the RTP attachment
 * established for this form: when the stored set could not be read, the
 * control is not on screen and the save does not send `projectIds` at all —
 * a failed read must never be able to unlink a campaign from its projects.
 *
 * Ids come from the fixture, so a component that hardcoded a binding instead
 * of threading it would fail.
 */

const LEAD_PROJECT = "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_C = "cccc3333-cccc-4ccc-8ccc-cccccccccccc";

const projects = [
  { id: LEAD_PROJECT, name: "Main Street reconstruction" },
  { id: PROJECT_B, name: "Riverfront trail" },
  { id: PROJECT_C, name: "Transit center relocation" },
];

function campaignFixture() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Corridor listening window",
    summary: null,
    status: "active",
    engagement_type: "comment_collection",
    project_id: LEAD_PROJECT,
    rtp_cycle_id: null,
    rtp_cycle_chapter_id: null,
  };
}

function stubFetch({ linkedProjectIds }: { linkedProjectIds: string[] | null }) {
  const patchBodies: Array<Record<string, unknown>> = [];
  const mock = vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (!init?.method || init.method === "GET") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mapFraming: resolvePortalMapFraming({}),
            submissionGeofence: { enabled: false, canEnable: false, areaState: "unset", areaLabel: null },
            rtpTargets: { cycles: [] },
            linkedProjectIds,
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
  return { patchBodies };
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /^save campaign$/i }));
}

describe("the operator can see and change which projects the campaign covers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the stored set with the lead pinned — checked and not uncheckable", async () => {
    stubFetch({ linkedProjectIds: [LEAD_PROJECT, PROJECT_B] });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={projects} />);

    const lead = (await screen.findByRole("checkbox", {
      name: /Main Street reconstruction/,
    })) as HTMLInputElement;
    expect(lead.checked).toBe(true);
    expect(lead.disabled).toBe(true);

    const covered = screen.getByRole("checkbox", { name: /Riverfront trail/ }) as HTMLInputElement;
    expect(covered.checked).toBe(true);
    expect(covered.disabled).toBe(false);

    const uncovered = screen.getByRole("checkbox", { name: /Transit center relocation/ }) as HTMLInputElement;
    expect(uncovered.checked).toBe(false);
  });

  it("saves the whole checked set — including a newly checked project — through the metadata PATCH", async () => {
    const { patchBodies } = stubFetch({ linkedProjectIds: [LEAD_PROJECT] });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={projects} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /Transit center relocation/ }));
    await save();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0].projectIds).toEqual(expect.arrayContaining([LEAD_PROJECT, PROJECT_C]));
    expect(patchBodies[0].projectIds).toHaveLength(2);
  });

  it("saves a removal by leaving the project out of the set", async () => {
    const { patchBodies } = stubFetch({ linkedProjectIds: [LEAD_PROJECT, PROJECT_B] });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={projects} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /Riverfront trail/ }));
    await save();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0].projectIds).toEqual([LEAD_PROJECT]);
  });

  it("checks the box of a newly chosen lead, and keeps the old lead covered", async () => {
    stubFetch({ linkedProjectIds: [LEAD_PROJECT] });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={projects} />);

    const leadSelect = (await screen.findByLabelText(/Lead project/)) as HTMLSelectElement;
    fireEvent.change(leadSelect, { target: { value: PROJECT_B } });

    const newLead = screen.getByRole("checkbox", { name: /Riverfront trail/ }) as HTMLInputElement;
    expect(newLead.checked).toBe(true);
    expect(newLead.disabled).toBe(true);
    // The old lead is still covered — changing the lead is not an unlinking.
    const oldLead = screen.getByRole("checkbox", { name: /Main Street reconstruction/ }) as HTMLInputElement;
    expect(oldLead.checked).toBe(true);
    expect(oldLead.disabled).toBe(false);
  });

  it("says the set could not be read — and does not send projectIds — when the server answers null", async () => {
    const { patchBodies } = stubFetch({ linkedProjectIds: null });

    render(<EngagementCampaignControls campaign={campaignFixture()} projects={projects} />);

    expect(
      await screen.findByText(/projects this campaign covers could not be read/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Riverfront trail/ })).not.toBeInTheDocument();

    await save();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect("projectIds" in patchBodies[0]).toBe(false);
  });
});
