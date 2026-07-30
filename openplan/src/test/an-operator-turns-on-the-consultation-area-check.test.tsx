import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CAN A PERSON REACH THIS?
 *
 * The defect this repository keeps shipping is a capability that is complete,
 * tested, access-gated and reachable by nobody. So this file renders the real
 * `EngagementOperatorActions` — the section the campaign console actually mounts
 * — rather than the controls component in isolation, and asserts what an
 * operator sees and clicks. The siblings are stubbed because they open their own
 * fetches; the control under test is the real one, inside the real container.
 *
 * The last link in the chain, page → operator actions, is checked against the
 * page source at the bottom of this file.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock("@/components/engagement/engagement-share-controls", () => ({
  EngagementShareControls: () => <div data-testid="share-controls" />,
}));
vi.mock("@/components/engagement/engagement-item-composer", () => ({
  EngagementItemComposer: () => <div data-testid="item-composer" />,
}));
vi.mock("@/components/engagement/survey-builder", () => ({
  EngagementSurveyBuilder: () => <div data-testid="survey-builder" />,
}));
vi.mock("@/components/engagement/close-loop-builder", () => ({
  EngagementCloseLoopBuilder: () => <div data-testid="close-loop-builder" />,
}));

import { EngagementOperatorActions } from "@/components/engagement/engagement-operator-actions";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";

const campaign = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Broad Street listening campaign",
  summary: null,
  status: "active",
  engagement_type: "map_feedback",
  project_id: null,
  share_token: null,
  allow_public_submissions: true,
  submissions_closed_at: null,
  public_description: null,
  demographics_enabled: false,
};

type GeofencePayload = {
  enabled: boolean | null;
  canEnable: boolean;
  areaState: "set" | "unset" | "unreadable";
  areaLabel: string | null;
};

const patchBodies: unknown[] = [];

function respondWith(options: {
  geofence: GeofencePayload;
  campaignAreaLabel?: string | null;
  patchStatus?: number;
  patchBody?: unknown;
}) {
  const campaignPlace = options.campaignAreaLabel
    ? {
        state: "set" as const,
        label: options.campaignAreaLabel,
        bbox: { minLon: -83.2, minLat: 39.85, maxLon: -82.8, maxLat: 40.1 },
      }
    : null;

  return vi.fn().mockImplementation(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PATCH") {
      patchBodies.push(JSON.parse(init.body ?? "{}"));
      return new Response(JSON.stringify(options.patchBody ?? { success: true }), {
        status: options.patchStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        mapFraming: resolvePortalMapFraming({
          campaignPlace,
          submissionGeofenceEnabled: options.geofence.enabled === true,
        }),
        submissionGeofence: options.geofence,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}

function renderConsole() {
  render(
    <EngagementOperatorActions
      campaign={campaign}
      projects={[]}
      categories={[]}
      surveyQuestions={[]}
      closeLoopEntries={[]}
    />
  );
}

describe("an operator can turn on the consultation-area check, where it can run", () => {
  beforeEach(() => {
    patchBodies.length = 0;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the control on the campaign console, naming the area it would use", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        geofence: { enabled: false, canEnable: true, areaState: "set", areaLabel: "the Broad Street corridor" },
        campaignAreaLabel: "the Broad Street corridor",
      })
    );

    renderConsole();

    const toggle = await screen.findByRole("checkbox", {
      name: /only accept comments pinned inside the Broad Street corridor/i,
    });
    expect(toggle).toBeEnabled();
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });

  it("saves the opt-in and nothing else when the operator ticks it", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        geofence: { enabled: false, canEnable: true, areaState: "set", areaLabel: "the Broad Street corridor" },
        campaignAreaLabel: "the Broad Street corridor",
      })
    );

    renderConsole();

    fireEvent.click(
      await screen.findByRole("checkbox", { name: /only accept comments pinned inside/i })
    );

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ submissionGeofenceEnabled: true });
  });

  /**
   * "Never enable a check that cannot run." A campaign with no area of its own
   * has nothing to test a pin against, and an operator who ticked a box
   * believing participation was being filtered would be worse off than one who
   * was told plainly that it is not available.
   */
  it("disables the control, and says why, for a campaign with no area of its own", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        geofence: { enabled: false, canEnable: false, areaState: "unset", areaLabel: null },
      })
    );

    renderConsole();

    const toggle = await screen.findByRole("checkbox", {
      name: /only accept comments pinned inside this campaign's area/i,
    });
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(/This campaign has no area of its own, so there is nothing to check a dropped pin against/i)
    ).toBeInTheDocument();
    // And it names the trap: the map may be framed by an inherited area the
    // check will never use.
    expect(screen.getByText(/the check never runs against either/i)).toBeInTheDocument();
  });

  it("does not present a failed read as 'off'", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        geofence: { enabled: null, canEnable: false, areaState: "unreadable", areaLabel: null },
      })
    );

    renderConsole();

    expect(
      await screen.findByText(/Could not read whether the location check is on/i)
    ).toBeInTheDocument();
    // No checkbox at all: an unchecked box IS a claim, and it is one nobody
    // established.
    expect(screen.queryByRole("checkbox", { name: /only accept comments pinned/i })).toBeNull();
  });

  it("shows the server's own refusal when the save is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        geofence: { enabled: false, canEnable: true, areaState: "set", areaLabel: null },
        campaignAreaLabel: "Franklin County, Ohio",
        patchStatus: 400,
        patchBody: { error: "This campaign has no area on record, so there is nothing to check a dropped pin against." },
      })
    );

    renderConsole();

    fireEvent.click(
      await screen.findByRole("checkbox", { name: /only accept comments pinned inside/i })
    );

    expect(
      await screen.findByText(/nothing to check a dropped pin against/i)
    ).toBeInTheDocument();
  });

  it("tells the operator the two things about the rule that residents experience", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        geofence: { enabled: true, canEnable: true, areaState: "set", areaLabel: "the Broad Street corridor" },
        campaignAreaLabel: "the Broad Street corridor",
      })
    );

    renderConsole();

    // A comment with no pin is never refused …
    expect(
      await screen.findByText(/Comments sent without a pin are always accepted/i)
    ).toBeInTheDocument();
    // … and a refusal is not an oracle for the boundary.
    expect(screen.getByText(/they are never shown the boundary/i)).toBeInTheDocument();
  });

  it("reaches an operator: the campaign console mounts this section", () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), "src/app/(app)/engagement/[campaignId]/page.tsx"),
      "utf8"
    );
    expect(pageSource).toContain("<EngagementOperatorActions");

    const sectionSource = readFileSync(
      path.join(process.cwd(), "src/components/engagement/engagement-operator-actions.tsx"),
      "utf8"
    );
    expect(sectionSource).toContain("<EngagementCampaignControls");
  });
});
