import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * /my-work PAGE WIRING — the seam the board tests cannot see.
 *
 * The board renders whatever it is handed, so its tests pass with a described
 * result whether or not the page ever loads the queue. This is the
 * shipped-invisible defect class: a complete, tested work queue no planner can
 * reach because the page forgot to call it, or called it with the wrong client,
 * or ignored the scope in the URL.
 *
 * THE BINDING THAT MATTERS MOST: `loadMyWork` must receive the SAME client the
 * page created for the signed-in caller — the RLS client. Four of the queue's
 * sources have no workspace_id column of their own; a service-role client here
 * would be a cross-tenant leak with nothing left to stop it. The roster is the
 * mirror image: it MUST get the service-role client, because
 * `members_read_own` makes an RLS roster read return one row and the page would
 * then report every teammate's work as belonging to somebody who left.
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after: handing the queue the
 * service-role client, hardcoding the scope to "assigned", and hardcoding
 * `isViewer` to false.
 */

const RLS_CLIENT = {
  auth: { getUser: async () => ({ data: { user: { id: USER_ID() } } }) },
};
function USER_ID() {
  return "44444444-0000-4000-8000-000000000004";
}
const SERVICE_CLIENT = { serviceRole: true };
const WORKSPACE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const createClientMock = vi.fn(async () => RLS_CLIENT);
const createServiceRoleClientMock = vi.fn(() => SERVICE_CLIENT);
const loadWorkspaceContextMock = vi.fn();
const loadRosterMock = vi.fn();
const loadMyWorkMock = vi.fn();
const loadOtherWorkspaceDecisionPackageWorkMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadWorkspaceContext: (...args: unknown[]) => loadWorkspaceContextMock(...args),
}));

vi.mock("@/lib/projects/assignee-roster", () => ({
  loadProjectAssigneeRoster: (...args: unknown[]) => loadRosterMock(...args),
}));

vi.mock("@/lib/my-work/query", () => ({
  loadMyWork: (...args: unknown[]) => loadMyWorkMock(...args),
  loadOtherWorkspaceDecisionPackageWork: (...args: unknown[]) =>
    loadOtherWorkspaceDecisionPackageWorkMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));

import MyWorkPage from "@/app/(app)/my-work/page";
import { MyWorkBoard } from "@/components/my-work/my-work-board";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";

function emptyResult(overrides: Record<string, unknown> = {}) {
  return {
    scope: "assigned",
    items: [],
    reads: new ReadFailureLog(),
    perSource: {},
    limitPerSource: 20,
    departedIncludedInUnassigned: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockResolvedValue(RLS_CLIENT);
  createServiceRoleClientMock.mockReturnValue(SERVICE_CLIENT);
  loadWorkspaceContextMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    options: [
      { id: WORKSPACE_ID, name: "Current workspace" },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Review workspace" },
    ],
  });
  loadRosterMock.mockResolvedValue({ ok: true, members: [] });
  loadMyWorkMock.mockResolvedValue(emptyResult());
  loadOtherWorkspaceDecisionPackageWorkMock.mockResolvedValue({
    workspaces: [],
    reads: new ReadFailureLog(),
  });
});

async function renderPage(scope?: string) {
  return (await MyWorkPage({
    searchParams: Promise.resolve(scope === undefined ? {} : { scope }),
  })) as { type: unknown; props: Record<string, unknown> };
}

describe("/my-work page wiring", () => {
  it("reads the queue with the caller's RLS client and the roster with the service role", async () => {
    await renderPage();

    expect(loadMyWorkMock).toHaveBeenCalledTimes(1);
    expect(loadMyWorkMock.mock.calls[0][0]).toBe(RLS_CLIENT);
    expect(loadMyWorkMock.mock.calls[0][1]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID(),
    });
    expect(loadOtherWorkspaceDecisionPackageWorkMock).toHaveBeenCalledWith(RLS_CLIENT, {
      currentWorkspaceId: WORKSPACE_ID,
      workspaces: [
        { id: WORKSPACE_ID, name: "Current workspace" },
        { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Review workspace" },
      ],
    });

    expect(loadRosterMock).toHaveBeenCalledTimes(1);
    expect(loadRosterMock.mock.calls[0][0]).toBe(SERVICE_CLIENT);
    expect(loadRosterMock.mock.calls[0][1]).toBe(USER_ID());
    expect(loadRosterMock.mock.calls[0][2]).toBe(WORKSPACE_ID);
  });

  it("carries the scope from the URL into the read, and falls back for anything else", async () => {
    // VARY THE BINDING: one fixture cannot tell "threads the scope" from
    // "hardcodes the default".
    await renderPage("unassigned");
    expect(loadMyWorkMock.mock.calls[0][1]).toMatchObject({ scope: "unassigned" });

    loadMyWorkMock.mockClear();
    await renderPage("all_projects");
    expect(loadMyWorkMock.mock.calls[0][1]).toMatchObject({ scope: "all_projects" });

    loadMyWorkMock.mockClear();
    await renderPage("../etc/passwd");
    expect(loadMyWorkMock.mock.calls[0][1]).toMatchObject({ scope: "assigned" });
  });

  it("hands the board the roster it read, and the caller's role", async () => {
    const roster = { ok: true, members: [{ userId: USER_ID(), email: "a@b.gov", role: "member" }] };
    loadRosterMock.mockResolvedValue(roster);
    const element = await renderPage();

    expect(element.type).toBe(MyWorkBoard);
    expect(element.props.roster).toBe(roster);
    expect(element.props.isViewer).toBe(false);

    // VARY THE BINDING on the role too.
    loadWorkspaceContextMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      options: [{ id: WORKSPACE_ID, name: "Current workspace" }],
    });
    const viewerElement = await renderPage();
    expect(viewerElement.props.isViewer).toBe(true);
  });

  it("hands cross-workspace decision-package obligations to the visible board", async () => {
    loadOtherWorkspaceDecisionPackageWorkMock.mockResolvedValue({
      workspaces: [{
        workspaceId: "bbbbbbbb-0000-4000-8000-000000000002",
        workspaceName: "Review workspace",
      }],
      reads: new ReadFailureLog(),
    });

    const element = await renderPage();

    expect(element.props.otherWorkspaceDecisionPackageWork).toEqual([{
      workspaceId: "bbbbbbbb-0000-4000-8000-000000000002",
      workspaceName: "Review workspace",
    }]);
  });

  it("discloses the roster failure and the queue's failures in one sentence", async () => {
    loadRosterMock.mockImplementation(
      async (
        _service: unknown,
        _callerId: string,
        _workspaceId: string,
        reads: { check: (label: string, result: unknown) => boolean }
      ) => {
        reads.check("this workspace's team roster", { error: { message: "no service key" } });
        return { ok: false };
      }
    );
    const queueReads = new ReadFailureLog();
    queueReads.check("project deliverables", { error: { message: "permission denied" } });
    loadMyWorkMock.mockResolvedValue(emptyResult({ reads: queueReads }));

    const element = await renderPage();
    const summary = element.props.readFailureSummary as string;

    // ONE sentence naming both — two sentences each look like the whole story.
    expect(summary).toContain("this workspace's team roster");
    expect(summary).toContain("project deliverables");
    expect(summary.match(/This page could not read/g)).toHaveLength(1);
  });

  it("discloses a failed cross-workspace decision-package probe in the same visible summary", async () => {
    const crossWorkspaceReads = new ReadFailureLog();
    crossWorkspaceReads.check("decision packages in Review workspace", {
      error: { message: "permission denied" },
    });
    loadOtherWorkspaceDecisionPackageWorkMock.mockResolvedValue({
      workspaces: [],
      reads: crossWorkspaceReads,
    });

    const element = await renderPage();

    expect(element.props.readFailureSummary).toContain("decision packages in Review workspace");
  });

  it("asks for a workspace instead of an empty queue when the caller has none", async () => {
    loadWorkspaceContextMock.mockResolvedValue({ membership: null, options: [] });

    const element = await renderPage();

    expect(element.type).toBe(WorkspaceMembershipRequired);
    expect(loadMyWorkMock).not.toHaveBeenCalled();
    expect(loadOtherWorkspaceDecisionPackageWorkMock).not.toHaveBeenCalled();
    // And no service-role client is created for a caller with no workspace.
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as unknown as typeof RLS_CLIENT);

    await expect(renderPage()).rejects.toThrow("redirect:/sign-in");
    expect(loadMyWorkMock).not.toHaveBeenCalled();
  });
});
