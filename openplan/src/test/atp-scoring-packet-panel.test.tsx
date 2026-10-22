import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FundingOpportunityApplicationWorkspace } from "@/components/grants/funding-opportunity-application-workspace";
import { buildAtpPacketView } from "@/lib/grants/atp-packet";

/**
 * The ATP scoring packet on screen: present on an application seeded from the
 * ATP template, absent on any other program, and "Not recorded" wherever the
 * packet holds null.
 *
 * Blind category: jsdom has no layout, so this cannot see whether the panel is
 * visible at 390px or crowds the sections below it.
 */

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PACKET_URL = `/api/funding-opportunities/${OPPORTUNITY_ID}/application/atp-packet`;

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function section(sectionKey: string, index: number) {
  return {
    id: `5555555${index}-5555-4555-8555-555555555555`,
    workspace_id: "33333333-3333-4333-8333-333333333333",
    opportunity_id: OPPORTUNITY_ID,
    section_key: sectionKey,
    title: sectionKey,
    guidance: null,
    sort_order: index,
    source: "catalog",
    suggested_evidence: [],
    ai_drafting_enabled: true,
    status: "not_started",
    final_markdown: null,
    finalized_from_draft_id: null,
    updated_by: null,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
  };
}

function applicationPayload(sectionKeys: string[]) {
  return {
    sections: sectionKeys.map(section),
    attachments: [],
    schemaPending: false,
    latestDraftsBySectionId: {},
    latestDraftsUnavailable: false,
    kbDocumentOptions: [],
    reportArtifactOptions: [],
    attachSourcesDegraded: false,
  };
}

const PACKET = {
  ...buildAtpPacketView({
    project: { id: "p-main", name: "Main Street safe routes" },
    run: { id: "run-9", title: "Main Street corridor", created_at: "2026-09-02T17:00:00Z", metrics: { safetyScore: 64, equityScore: 71 } },
    generatedAt: "2026-10-12T00:00:00Z",
  }),
  missing: null,
};

async function openWith(sectionKeys: string[]) {
  fetchMock.mockImplementation(async (url: string) =>
    url === PACKET_URL ? jsonResponse(200, PACKET) : jsonResponse(200, applicationPayload(sectionKeys))
  );
  render(<FundingOpportunityApplicationWorkspace opportunityId={OPPORTUNITY_ID} />);
  fireEvent.click(screen.getByRole("button", { name: /open application workspace/i }));
  await screen.findByTestId("application-sections");
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("ATP scoring packet panel", () => {
  it("shows the packet on an ATP application, with null scores as not recorded", async () => {
    await openWith(["project-narrative", "need-and-safety", "disadvantaged-communities", "budget-narrative"]);

    const panel = await screen.findByTestId("atp-scoring-packet");
    await waitFor(() => expect(within(panel).getByText("Main Street safe routes")).toBeInTheDocument());

    const rows = within(panel).getAllByRole("row").map((row) => row.textContent);
    expect(rows).toContain("Safety64.0");
    expect(rows).toContain("Equity71.0");
    expect(rows).toContain("ClimateNot recordedOpenPlan does not compute this score.");
    expect(rows).toContain("Total (weighted 30/25/25/20)Not recordedNeeds all four scores.");
    expect(rows).toContain("SensitivityNot recorded");

    const summary = within(panel).getByTestId("atp-packet-summary");
    expect(summary.textContent).toContain("Mean total scoreNot recorded");
    expect(summary.textContent).toContain("Disadvantaged community (SB 535)Not recorded");
    expect(summary.textContent).toContain("Tribal areaNot recorded");
    expect(within(panel).getByText(/Screening scores from Main Street corridor/)).toBeInTheDocument();

    const download = within(panel).getByRole("link", { name: /download atp report/i });
    expect(download).toHaveAttribute("href", `${PACKET_URL}?format=markdown`);
    expect(fetchMock).toHaveBeenCalledWith(PACKET_URL);
  });

  it("shows no packet and makes no packet request on another program's application", async () => {
    // Washington's WSDOT pedestrian and bicycle program shares need-and-safety with ATP.
    await openWith(["project-description", "need-and-safety", "active-transportation-demand", "budget-and-cost-estimate"]);

    expect(screen.queryByTestId("atp-scoring-packet")).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(PACKET_URL);
  });
});
