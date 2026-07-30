import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
    },
  }),
}));

import SignInPage from "@/app/(auth)/sign-in/page";

describe("SignInPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    signInWithPasswordMock.mockReset();
    signInWithPasswordMock.mockResolvedValue({ error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ workspaceId: "workspace-1" }), { status: 200 })));
    searchParamsValue.forEach((_, key) => searchParamsValue.delete(key));
  });

  it("uses the confident, welcoming product voice in the sign-in header", async () => {
    render(<SignInPage />);

    expect(await screen.findByRole("heading", { name: /Sign in to your workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/maps, engagement, and reporting stay connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/supervised/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/operations checkpoint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Resume work inside the correct workspace/i)).not.toBeInTheDocument();
  });

  it("surfaces first-success guidance after account creation and preserves the redirect target", async () => {
    searchParamsValue.set("created", "1");
    searchParamsValue.set("redirect", "/reports");

    render(<SignInPage />);

    expect(await screen.findByText(/Account created — next step is your first workspace/i)).toBeInTheDocument();
    // No billing/pricing step: the workspace is already provisioned.
    expect(screen.getByText(/workspace is already provisioned/i)).toBeInTheDocument();
    expect(screen.queryByText(/billing|pricing/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create an account/i })).toHaveAttribute(
      "href",
      "/sign-up?redirect=%2Freports",
    );
  });

  it("preserves invite tokens on the create-account link", async () => {
    searchParamsValue.set("redirect", "/dashboard");
    searchParamsValue.set("invite", "invite-token-123");

    render(<SignInPage />);

    expect(await screen.findByText(/Workspace invitation link detected/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create an account/i })).toHaveAttribute(
      "href",
      "/sign-up?redirect=%2Fdashboard&invite=invite-token-123",
    );
  });

  /**
   * SIGNING IN IS AUTHENTICATION, NOT A DECISION.
   *
   * This form used to POST the invite token to
   * `/api/workspaces/invitations/accept` the moment sign-in succeeded, so a
   * person who followed an invitation link to SEE what they had been sent
   * joined the workspace by the act of authenticating — never shown its name,
   * the role they had been granted, or who invited them, and with no way to
   * decline. The old test asserted exactly that behaviour, which is why it had
   * to be rewritten rather than deleted: the contract inverted.
   */
  it("takes an invited user to the invitation instead of accepting it for them", async () => {
    searchParamsValue.set("redirect", "/dashboard");
    searchParamsValue.set("invite", "invite-token-123");

    render(<SignInPage />);

    fireEvent.change(await screen.findByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith({
        email: "planner@example.com",
        password: "OpenPlan!2026",
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/invitations/invite-token-123");
    });
    // Nothing was answered on their behalf.
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/workspaces/invitations/accept",
      expect.anything()
    );
  });

  it("honours an explicit redirect that is already the invitation page", async () => {
    // The invitation page sends signed-out visitors through sign-up with
    // `redirect=/invitations/<token>`; that must not be rewritten into itself.
    searchParamsValue.set("redirect", "/invitations/invite-token-123");
    searchParamsValue.set("invite", "invite-token-123");

    render(<SignInPage />);

    fireEvent.change(await screen.findByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/invitations/invite-token-123");
    });
  });
});
