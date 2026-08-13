import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceTeamPanel } from "@/components/workspaces/workspace-team-panel";
import { confirmDestructiveAction, confirmDialogText, declineConfirmation } from "./helpers/confirm-dialog";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

type FetchArgs = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchCalls: FetchArgs[] = [];
let membersBody: unknown;
let invitationsBody: unknown;
let mutationResponse: Response | null;

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url.startsWith("/api/workspaces/members") && (!init?.method || init.method === "GET")) {
        return jsonResponse(membersBody);
      }
      if (url.startsWith("/api/workspaces/invitations") && (!init?.method || init.method === "GET")) {
        return jsonResponse(invitationsBody);
      }
      return mutationResponse ?? jsonResponse({});
    })
  );
}

beforeEach(() => {
  fetchCalls = [];
  refreshMock.mockClear();
  mutationResponse = null;
  invitationsBody = { invitations: [], memberCount: 2 };
  membersBody = {
    callerUserId: OWNER_ID,
    members: [
      { userId: OWNER_ID, email: "owner@agency.gov", role: "owner", joinedAt: "2026-07-01T00:00:00Z" },
      { userId: MEMBER_ID, email: "planner@agency.gov", role: "member", joinedAt: "2026-07-02T00:00:00Z" },
    ],
  };
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkspaceTeamPanel members management", () => {
  it("renders nothing for non-managers", () => {
    const { container } = render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchCalls).toHaveLength(0);
  });

  it("lists members with email, role, and a role select", async () => {
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    expect(await screen.findByText("owner@agency.gov")).toBeInTheDocument();
    expect(screen.getByText("planner@agency.gov")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByLabelText("Role for planner@agency.gov")).toHaveValue("member");
  });

  it("offers Viewer in the invite role select with its one-line description", async () => {
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    const select = screen.getByLabelText("Role");
    fireEvent.change(select, { target: { value: "viewer" } });
    expect(select).toHaveValue("viewer");
    expect(screen.getByText("Read everything, change nothing.")).toBeInTheDocument();
  });

  it("PATCHes the members API when a role is changed", async () => {
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    const select = await screen.findByLabelText("Role for planner@agency.gov");
    fireEvent.change(select, { target: { value: "viewer" } });

    await waitFor(() => {
      const patch = fetchCalls.find((call) => call.init?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch?.url).toBe("/api/workspaces/members");
      expect(JSON.parse(String(patch?.init?.body))).toEqual({
        workspaceId: WORKSPACE_ID,
        userId: MEMBER_ID,
        role: "viewer",
      });
    });
  });

  it("confirms before removing, naming the loss of access", async () => {
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    const removeButton = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(removeButton);

    expect(await confirmDialogText()).toContain("lose access");
    await declineConfirmation();
    // Declined: no DELETE issued.
    expect(fetchCalls.some((call) => call.init?.method === "DELETE")).toBe(false);
  });

  it("labels self-removal as leaving and DELETEs on confirm", async () => {
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    const leaveButton = await screen.findByRole("button", { name: "Leave" });
    fireEvent.click(leaveButton);
    await confirmDestructiveAction("Leave this workspace");

    await waitFor(() => {
      const del = fetchCalls.find((call) => call.init?.method === "DELETE");
      expect(del).toBeDefined();
      expect(JSON.parse(String(del?.init?.body))).toEqual({
        workspaceId: WORKSPACE_ID,
        userId: OWNER_ID,
      });
    });
  });

  it("renders API error copy verbatim", async () => {
    mutationResponse = jsonResponse(
      { error: "This workspace's last owner cannot be demoted or removed. Promote another owner first." },
      409
    );
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    const leaveButton = await screen.findByRole("button", { name: "Leave" });
    fireEvent.click(leaveButton);
    await confirmDestructiveAction("Leave this workspace");

    expect(
      await screen.findByText(
        "This workspace's last owner cannot be demoted or removed. Promote another owner first."
      )
    ).toBeInTheDocument();
  });

  /**
   * Self-affecting mutations invalidate this panel's own authority: `canManage`
   * comes from the server, and the members API answers 403 to a non-manager and
   * 404 to a non-member. The panel must hand the question back to the server
   * rather than keep rendering management UI its next request would be refused.
   */
  describe("self-affecting mutations", () => {
    function memberListCalls() {
      return fetchCalls.filter((call) => call.url.startsWith("/api/workspaces/members?")).length;
    }

    it("refreshes the page after leaving, and does not re-list a workspace it just left", async () => {
      render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
      const leaveButton = await screen.findByRole("button", { name: "Leave" });
      const listsBefore = memberListCalls();

      fireEvent.click(leaveButton);
      await confirmDestructiveAction("Leave this workspace");

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(await screen.findByText(/You left this workspace\./)).toBeInTheDocument();
      expect(memberListCalls()).toBe(listsBefore);
    });

    it("refreshes the page when the caller demotes themselves out of management", async () => {
      // Two owners, so demoting yourself is a change the API would actually allow.
      membersBody = {
        callerUserId: OWNER_ID,
        members: [
          { userId: OWNER_ID, email: "owner@agency.gov", role: "owner", joinedAt: "2026-07-01T00:00:00Z" },
          { userId: MEMBER_ID, email: "second-owner@agency.gov", role: "owner", joinedAt: "2026-07-02T00:00:00Z" },
        ],
      };
      render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
      const select = await screen.findByLabelText("Role for owner@agency.gov");
      const listsBefore = memberListCalls();

      fireEvent.change(select, { target: { value: "viewer" } });

      await waitFor(() => {
        const patch = fetchCalls.find((call) => call.init?.method === "PATCH");
        expect(JSON.parse(String(patch?.init?.body))).toEqual({
          workspaceId: WORKSPACE_ID,
          userId: OWNER_ID,
          role: "viewer",
        });
      });
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(await screen.findByText(/cannot manage this team/)).toBeInTheDocument();
      expect(memberListCalls()).toBe(listsBefore);
    });

    it("refreshes AND re-lists when the caller demotes themselves but still manages", async () => {
      membersBody = {
        callerUserId: OWNER_ID,
        members: [
          { userId: OWNER_ID, email: "owner@agency.gov", role: "owner", joinedAt: "2026-07-01T00:00:00Z" },
          { userId: MEMBER_ID, email: "second-owner@agency.gov", role: "owner", joinedAt: "2026-07-02T00:00:00Z" },
        ],
      };
      render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
      const select = await screen.findByLabelText("Role for owner@agency.gov");
      const listsBefore = memberListCalls();

      fireEvent.change(select, { target: { value: "admin" } });

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      // An admin may still read the roster, so the panel stays truthful about it.
      await waitFor(() => expect(memberListCalls()).toBe(listsBefore + 1));
    });

    it("leaves the roster alone when someone ELSE is changed", async () => {
      render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
      const select = await screen.findByLabelText("Role for planner@agency.gov");
      const listsBefore = memberListCalls();

      fireEvent.change(select, { target: { value: "viewer" } });

      await waitFor(() => expect(memberListCalls()).toBe(listsBefore + 1));
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  it("hides the role select and remove button for an owner row when the caller is an admin", async () => {
    membersBody = {
      callerUserId: MEMBER_ID,
      members: [
        { userId: OWNER_ID, email: "owner@agency.gov", role: "owner", joinedAt: "2026-07-01T00:00:00Z" },
        { userId: MEMBER_ID, email: "admin@agency.gov", role: "admin", joinedAt: "2026-07-02T00:00:00Z" },
      ],
    };
    render(<WorkspaceTeamPanel workspaceId={WORKSPACE_ID} canManage />);
    expect(await screen.findByText("owner@agency.gov")).toBeInTheDocument();
    expect(screen.queryByLabelText("Role for owner@agency.gov")).toBeNull();
    // The admin can still act on their own row.
    expect(screen.getByLabelText("Role for admin@agency.gov")).toBeInTheDocument();
  });
});
