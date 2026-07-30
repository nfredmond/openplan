import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AN INVITATION WITH NO REFUSAL IS NOT AN INVITATION.
 *
 * `/api/workspaces/invitations/decline` was written, tested, audited and
 * email-matched — and nothing in the product called it. The only way out of an
 * invitation was to ignore it until it expired. Worse, accepting was IMPLICIT:
 * the invite link went to `/sign-up?invite=…`, and the sign-in form POSTed the
 * token to `/accept` on success, so a person who followed the link to see what
 * they had been sent joined a workspace they were never shown.
 *
 * These tests drive the real page and the real decision component, and assert
 * what a person invited to a workspace would actually be able to see and do.
 */

const routerPush = vi.fn();
const routerRefresh = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
  redirect: (url: string) => redirectMock(url),
}));

const getUserMock = vi.fn();
const loadInvitationByTokenMock = vi.fn();
const getUserByIdMock = vi.fn();
const workspaceMaybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createServiceRoleClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: workspaceMaybeSingleMock }) }),
    }),
  }),
}));

vi.mock("@/lib/workspaces/invitations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspaces/invitations")>();
  return {
    ...actual,
    loadInvitationByToken: (...args: unknown[]) => loadInvitationByTokenMock(...args),
  };
});

import InvitationPage from "@/app/(auth)/invitations/[token]/page";

const INVITATION = {
  id: "inv-1",
  workspace_id: "ws-1",
  email: "planner@city.example",
  email_normalized: "planner@city.example",
  role: "member" as const,
  status: "pending" as const,
  token_hash: "hash",
  token_prefix: "hash",
  invited_by_user_id: "user-inviter",
  expires_at: "2099-01-01T00:00:00.000Z",
};

const renderPage = async (token = "invite-token-1234567890123456") =>
  render(await InvitationPage({ params: Promise.resolve({ token }) }));

describe("an invitation can be refused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "planner@city.example" } } });
    loadInvitationByTokenMock.mockResolvedValue({ ok: true, invitation: INVITATION });
    getUserByIdMock.mockResolvedValue({ data: { user: { email: "director@city.example" } } });
    workspaceMaybeSingleMock.mockResolvedValue({ data: { name: "City of Example" }, error: null });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows what is being offered before either answer is possible", async () => {
    await renderPage();

    // The four facts a person needs to decide, none of which the old flow showed.
    expect(screen.getByText(/Join City of Example/i)).toBeInTheDocument();
    expect(screen.getByText(/Create and edit workspace content/i)).toBeInTheDocument();
    expect(screen.getByText("planner@city.example")).toBeInTheDocument();
    expect(screen.getByText("director@city.example")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /accept and join/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decline/i })).toBeInTheDocument();
  });

  it("writes nothing merely because the invitation was opened", async () => {
    await renderPage();

    // Reading an invitation is not answering it. A link preview or a mis-click
    // must not enrol anybody.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("declines through the route that had no caller", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "declined" }),
    });
    await renderPage();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^decline$/i })));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/invitations/decline",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByText(/Invitation declined/i)).toBeInTheDocument();
    // Declining must not land them in the workspace they just refused.
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("accepts only when the button is pressed, and then opens the workspace", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ workspaceId: "ws-1" }),
    });
    await renderPage();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /accept and join/i })));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/invitations/accept",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });

  it("leaves the invitation open when the answer could not be delivered", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    await renderPage();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^decline$/i })));

    // Not "declined" — the request never reached the server, so nothing was
    // decided, and the buttons must come back.
    expect(await screen.findByRole("alert")).toHaveTextContent(/unchanged/i);
    expect(screen.getByRole("button", { name: /^decline$/i })).toBeEnabled();
  });

  it("sends a signed-out visitor to sign up, keeping the token", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(renderPage("tok-abc")).rejects.toThrow(/REDIRECT:/);
    expect(redirectMock).toHaveBeenCalledWith(
      "/sign-up?invite=tok-abc&redirect=%2Finvitations%2Ftok-abc"
    );
  });

  it("names both addresses when the wrong account is signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-2", email: "personal@example.com" } } });

    await renderPage();

    // The ordinary cause is a personal account reading a work invitation, which
    // is fixable — so say which two addresses disagree.
    expect(screen.getByText(/different address/i)).toBeInTheDocument();
    expect(screen.getByText(/planner@city.example/)).toBeInTheDocument();
    expect(screen.getByText(/personal@example.com/)).toBeInTheDocument();
  });

  it("distinguishes an expired invitation from one that was withdrawn", async () => {
    loadInvitationByTokenMock.mockResolvedValue({ ok: false, reason: "expired", invitation: INVITATION });
    const expired = await renderPage();
    expect(expired.container.textContent).toMatch(/has expired/i);
    expired.unmount();

    loadInvitationByTokenMock.mockResolvedValue({ ok: false, reason: "not_pending", invitation: INVITATION });
    const withdrawn = await renderPage();
    expect(withdrawn.container.textContent).toMatch(/no longer open/i);
  });

  it("does not blame the link when the read itself failed", async () => {
    loadInvitationByTokenMock.mockRejectedValue(new Error("connection reset"));

    await renderPage();

    // "This link is not valid" would send someone to request a replacement that
    // fails identically. A read that FAILED is not an invitation that is gone.
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
  });

  it("still lets the decision be made when the workspace name is unreadable", async () => {
    workspaceMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "nope" } });

    await renderPage();

    expect(screen.getByText(/Join this workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept and join/i })).toBeInTheDocument();
  });
});
