import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const resendMock = vi.fn();
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
      resend: resendMock,
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
    resendMock.mockReset();
    resendMock.mockResolvedValue({ error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ workspaceId: "workspace-1" }), { status: 200 })));
    // SNAPSHOT THE KEYS BEFORE DELETING THEM.
    //
    // This was `searchParamsValue.forEach((_, key) => …delete(key))`, which
    // mutates the collection it is walking: deleting shifts the remaining
    // entries down and `forEach` skips the next one, so the reset left params
    // behind. Whichever query string the previous test set then bled into this
    // one, and the page took a different branch than the test was describing.
    //
    // Under a fixed order the survivors happened to be harmless. Shuffled, they
    // are not, and a leaked `invite` or `created` is exactly the kind of thing
    // this page branches on.
    for (const key of [...searchParamsValue.keys()]) searchParamsValue.delete(key);
  });

  it("uses the confident, welcoming product voice in the sign-in header", async () => {
    render(<SignInPage />);

    expect(await screen.findByRole("heading", { name: /Sign in to your workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/maps, engagement, and reporting stay connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/supervised/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/operations checkpoint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Resume work inside the correct workspace/i)).not.toBeInTheDocument();
  });

  it("preserves the redirect target on the create-account link", async () => {
    searchParamsValue.set("redirect", "/reports");

    render(<SignInPage />);

    expect(await screen.findByRole("link", { name: /Create an account/i })).toHaveAttribute(
      "href",
      "/sign-up?redirect=%2Freports",
    );
    // No billing/pricing step, and no founder-provisioning vocabulary.
    expect(screen.queryByText(/provisioned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/billing|pricing/i)).not.toBeInTheDocument();
  });

  /**
   * A FAILED CONFIRMATION LINK IS NOT A FORGOTTEN PASSWORD.
   *
   * The notice used to answer every failed emailed link with "Request a new
   * reset link". A person who had just signed up and opened a stale
   * confirmation link was sent to reset a password they had not forgotten, on
   * an account that was not confirmed.
   */
  it("explains a failed emailed link and offers a new confirmation email, not only a reset", async () => {
    searchParamsValue.set("auth_error", "Email link is invalid or has expired");
    searchParamsValue.set("redirect", "/reports");

    render(<SignInPage />);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("The link from your email did not work.");
    expect(notice).toHaveTextContent("Email link is invalid or has expired");
    expect(notice).toHaveTextContent(/already opened the link once, your account is confirmed/i);
    // The reset link is still there for the person who was resetting.
    expect(screen.getByRole("link", { name: /request a new reset link/i })).toHaveAttribute("href", "/forgot-password");

    // No email typed yet: it asks for one and sends nothing.
    fireEvent.click(screen.getByRole("button", { name: /send a new confirmation email/i }));
    expect(await screen.findByText(/Type your email in the form below first/i)).toBeInTheDocument();
    expect(resendMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send a new confirmation email/i }));

    await waitFor(() => {
      expect(resendMock).toHaveBeenCalledWith({
        type: "signup",
        email: "planner@example.com",
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reports")}`,
        },
      });
    });
    expect(await screen.findByText(/a new link is on its way/i)).toBeInTheDocument();
  });

  it("shows no link notice when the URL carries no auth error", async () => {
    render(<SignInPage />);

    await screen.findByRole("heading", { name: /Sign in to your workspace/i });
    expect(screen.queryByText(/The link from your email did not work/i)).not.toBeInTheDocument();
  });

  it.each(["//elsewhere.example/path", "https://elsewhere.example", "/\\elsewhere.example"])(
    "does not follow the off-site redirect %s after sign-in",
    async (redirect) => {
      searchParamsValue.set("redirect", redirect);

      render(<SignInPage />);

      fireEvent.change(await screen.findByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
      fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/dashboard");
      });
    },
  );

  it("keeps a same-site redirect with its query string", async () => {
    searchParamsValue.set("redirect", "/dashboard?intent=modeling");

    render(<SignInPage />);

    fireEvent.change(await screen.findByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/dashboard?intent=modeling");
    });
    expect(screen.getByLabelText(/^Password$/i)).toHaveAttribute("autocomplete", "current-password");
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
