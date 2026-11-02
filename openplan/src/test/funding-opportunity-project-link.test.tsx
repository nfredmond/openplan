import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const workspaceProps = vi.fn();
vi.mock("@/components/grants/funding-opportunity-application-workspace", () => ({
  FundingOpportunityApplicationWorkspace: (props: unknown) => {
    workspaceProps(props);
    return null;
  },
}));
vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({ FundingOpportunityDecisionControls: () => null }));
vi.mock("@/components/grants/funding-opportunity-narrative-draft-panel", () => ({ FundingOpportunityNarrativeDraftPanel: () => null }));
vi.mock("@/components/grants/funding-opportunity-deadline-editor", () => ({ FundingOpportunityDeadlineEditor: () => null }));

import { FundingOpportunityProjectLink } from "@/components/grants/funding-opportunity-project-link";
import { projectLinkAnchorId } from "@/lib/grants/opportunity-project-link";
import { GrantsOpportunityRegistryCard } from "@/components/grants/grants-opportunity-registry-card";
import { AtpScoringPacketPanel } from "@/components/grants/atp-scoring-packet-panel";

/**
 * The project link control on a funding opportunity. It sends exactly the
 * chosen project (or null) to the opportunity PATCH, shows the route's refusal
 * in the route's words, and reports success only when the saved row names the
 * chosen project. Blind category: the route's checks are faked here; the route
 * test covers them.
 */

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECTS = [
  { id: "a1a1a1a1-0000-4000-8000-0000000000a1", name: "Main Street sidewalk gap" },
  { id: "a2a2a2a2-0000-4000-8000-0000000000a2", name: "School crossing" },
];

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const transport = vi.fn();
const patches = () => transport.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");

function savedRow(projectId: string | null) {
  return response({ opportunity: { id: OPPORTUNITY_ID, workspace_id: WORKSPACE_ID, project_id: projectId } });
}

beforeEach(() => {
  refresh.mockReset();
  transport.mockReset();
  vi.stubGlobal("fetch", transport);
});
afterEach(() => vi.unstubAllGlobals());

describe("funding opportunity project link", () => {
  it("links an unlinked opportunity to the chosen project", async () => {
    transport.mockResolvedValue(savedRow(PROJECTS[1].id));
    render(
      <FundingOpportunityProjectLink
        opportunityId={OPPORTUNITY_ID}
        workspaceId={WORKSPACE_ID}
        currentProject={null}
        projectOptions={PROJECTS}
      />
    );

    const select = screen.getByLabelText("Project") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("button", { name: "Save project" })).toBeDisabled();

    fireEvent.change(select, { target: { value: PROJECTS[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    await screen.findByText("Project saved.");
    expect(patches()).toHaveLength(1);
    expect(patches()[0][0]).toBe(`/api/funding-opportunities/${OPPORTUNITY_ID}`);
    expect(JSON.parse(String((patches()[0][1] as RequestInit).body))).toEqual({ projectId: PROJECTS[1].id });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("unlinks a linked opportunity behind Change project", async () => {
    transport.mockResolvedValue(savedRow(null));
    render(
      <FundingOpportunityProjectLink
        opportunityId={OPPORTUNITY_ID}
        workspaceId={WORKSPACE_ID}
        currentProject={PROJECTS[0]}
        projectOptions={PROJECTS}
      />
    );

    fireEvent.click(screen.getByText("Change project"));
    const select = screen.getByLabelText("Project") as HTMLSelectElement;
    expect(select.value).toBe(PROJECTS[0].id);
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((patches()[0][1] as RequestInit).body))).toEqual({ projectId: null });
  });

  it("shows the route's refusal and does not refresh", async () => {
    transport.mockResolvedValue(
      response(
        {
          error: "The project link was not changed",
          details: "This opportunity has an exported application built from its current project. Track a new opportunity for the other project.",
          blockers: ["application_export"],
        },
        409
      )
    );
    render(
      <FundingOpportunityProjectLink
        opportunityId={OPPORTUNITY_ID}
        workspaceId={WORKSPACE_ID}
        currentProject={PROJECTS[0]}
        projectOptions={PROJECTS}
      />
    );

    fireEvent.click(screen.getByText("Change project"));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECTS[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The project link was not changed");
    expect(alert.textContent).toContain("an exported application");
    expect(screen.queryByText("Project saved.")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not report success when the saved row names a different project", async () => {
    transport.mockResolvedValue(savedRow(PROJECTS[0].id));
    render(
      <FundingOpportunityProjectLink
        opportunityId={OPPORTUNITY_ID}
        workspaceId={WORKSPACE_ID}
        currentProject={null}
        projectOptions={PROJECTS}
      />
    );

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECTS[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    expect((await screen.findByRole("alert")).textContent).toContain("could not be confirmed");
    expect(screen.queryByText("Project saved.")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("where the control appears", () => {
  const opportunity = {
    id: OPPORTUNITY_ID, workspace_id: WORKSPACE_ID, title: "California ATP", program_id: null, project_id: null,
    opportunity_status: "upcoming", decision_state: "monitor", agency_name: null, owner_label: null, cadence_label: null,
    expected_award_amount: null, opens_at: null, closes_at: null, decision_due_at: null,
    fit_notes: null, readiness_notes: null, decision_rationale: null, decided_at: null, summary: null,
    created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z", programs: null, projects: null, program: null, project: null,
  } as const;

  it("is on the registry card for writers and absent for read-only callers", () => {
    const { container, unmount } = render(
      <GrantsOpportunityRegistryCard
        opportunity={opportunity}
        activeFocusedOpportunityId={null}
        projectGrantModelingEvidence={null}
        projectLinkOptions={PROJECTS}
      />
    );
    expect(container.querySelector(`#${projectLinkAnchorId(OPPORTUNITY_ID)}`)).not.toBeNull();
    expect(screen.getByLabelText("Project")).toBeTruthy();
    unmount();

    const readOnly = render(
      <GrantsOpportunityRegistryCard
        opportunity={opportunity}
        activeFocusedOpportunityId={null}
        projectGrantModelingEvidence={null}
        projectLinkOptions={null}
      />
    );
    expect(readOnly.container.querySelector(`#${projectLinkAnchorId(OPPORTUNITY_ID)}`)).toBeNull();
    expect(screen.queryByLabelText("Project")).toBeNull();
  });

  it("hands the linked project to the application workspace so the ATP scores reload", () => {
    workspaceProps.mockClear();
    render(
      <GrantsOpportunityRegistryCard
        opportunity={{ ...opportunity, project_id: PROJECTS[1].id, project: PROJECTS[1] }}
        activeFocusedOpportunityId={null}
        projectGrantModelingEvidence={null}
      />
    );
    expect(workspaceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ opportunityId: OPPORTUNITY_ID, linkedProjectId: PROJECTS[1].id })
    );
  });

  it("is where the ATP panel's Link a project prompt points", async () => {
    transport.mockResolvedValue(response({ packet: null, missing: "project", scoreRun: null }));
    render(<AtpScoringPacketPanel opportunityId={OPPORTUNITY_ID} />);

    const link = await screen.findByRole("link", { name: "Link a project" });
    expect(link.getAttribute("href")).toBe(`#${projectLinkAnchorId(OPPORTUNITY_ID)}`);
  });
});
