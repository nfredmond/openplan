import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RtpEngagementCampaignCreator } from "@/components/rtp/rtp-engagement-campaign-creator";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * AN RTP CAMPAIGN IS NOT BORN PROJECT-LESS ANY MORE.
 *
 * The RTP-side creator set `rtpCycleId` and nothing else, so every campaign it
 * made started unattached to any project — and the project link is what frames
 * the public map and connects the campaign to reports. These assert the
 * creator offers the same optional project link the engagement-side creator
 * has, that the chosen id (and the cycle id from the prop — varied here, not
 * hardcoded) reach the create call, and that a failed project read degrades to
 * "could not be read" without blocking creation.
 */

const RTP_CYCLE_ID = "eeee5555-eeee-4eee-8eee-eeeeeeeeeeee";
const PROJECT_TRAIL = "ffff6666-ffff-4fff-8fff-ffffffffffff";

const projectRows = [
  { id: "9999aaaa-9999-4999-8999-999999999999", name: "Downtown Mobility Plan", workspace_id: "w1" },
  { id: PROJECT_TRAIL, name: "Riverfront Trail", workspace_id: "w1" },
];

function stubFetch({ projectsOk = true }: { projectsOk?: boolean } = {}) {
  const postBodies: Array<Record<string, unknown>> = [];
  const mock = vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (typeof url === "string" && url.includes("/api/projects")) {
      if (!projectsOk) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Failed to load projects" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ projects: projectRows }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    if (init?.method === "POST") {
      postBodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      return Promise.resolve(
        new Response(JSON.stringify({ campaignId: "campaign-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return { postBodies };
}

async function createCampaign(title: string) {
  fireEvent.change(screen.getByLabelText(/Campaign title/), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: /Create RTP engagement target/i }));
}

describe("the RTP-side campaign creator can link a project", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers the workspace's projects and sends the chosen one with the cycle from the prop", async () => {
    const { postBodies } = stubFetch();

    render(<RtpEngagementCampaignCreator rtpCycleId={RTP_CYCLE_ID} chapterOptions={[]} />);

    const projectSelect = (await screen.findByLabelText(/Linked project/)) as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Downtown Mobility Plan" })).toBeInTheDocument();
    fireEvent.change(projectSelect, { target: { value: PROJECT_TRAIL } });

    await createCampaign("River corridor listening");

    await waitFor(() => expect(postBodies).toHaveLength(1));
    // Both bindings threaded, neither hardcoded: the project from the pick,
    // the cycle from the prop.
    expect(postBodies[0]).toMatchObject({
      title: "River corridor listening",
      projectId: PROJECT_TRAIL,
      rtpCycleId: RTP_CYCLE_ID,
    });
  });

  it("sends no project when none is chosen", async () => {
    const { postBodies } = stubFetch();

    render(<RtpEngagementCampaignCreator rtpCycleId={RTP_CYCLE_ID} chapterOptions={[]} />);
    await screen.findByLabelText(/Linked project/);

    await createCampaign("Whole-plan comment window");

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).not.toHaveProperty("projectId");
  });

  it("says the project list could not be read — and still creates — when the read fails", async () => {
    const { postBodies } = stubFetch({ projectsOk: false });

    render(<RtpEngagementCampaignCreator rtpCycleId={RTP_CYCLE_ID} chapterOptions={[]} />);

    // Unknown, not "no projects": the failure is named, and it does not gate
    // the create — the link can be made later from the campaign console.
    expect(await screen.findByText(/project list could not be read/i)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Downtown Mobility Plan" })).not.toBeInTheDocument();

    await createCampaign("Created despite the failed list");

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toMatchObject({ rtpCycleId: RTP_CYCLE_ID });
    expect(postBodies[0]).not.toHaveProperty("projectId");
  });
});
