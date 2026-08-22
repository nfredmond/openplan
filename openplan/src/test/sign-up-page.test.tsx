import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signUpMock = vi.fn();
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
      signUp: signUpMock,
    },
  }),
}));

import SignUpPage from "@/app/(auth)/sign-up/page";

describe("SignUpPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    signUpMock.mockReset();
    signUpMock.mockResolvedValue({ error: null });
    // Snapshot the keys before deleting any of them. `URLSearchParams.forEach`
    // walks a live list, so deleting during the walk shifts the remaining
    // entries under the cursor and silently skips every other one — clearing
    // three keys left `redirect` behind. In file-name order the preceding test
    // happened to set a single key, so the leak was invisible; under
    // `--sequence.shuffle` the three-key test ran first and this file's intent
    // test read its `/reports` redirect.
    for (const key of [...searchParamsValue.keys()]) searchParamsValue.delete(key);
  });

  it("uses the confident, welcoming product voice in the sign-up header", async () => {
    render(<SignUpPage />);

    expect(await screen.findByRole("heading", { name: /Create your OpenPlan account/i })).toBeInTheDocument();
    expect(screen.getByText(/projects, maps, engagement, and reporting come together/i)).toBeInTheDocument();
    expect(screen.queryByText(/supervised early access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/establishes the operator account only/i)).not.toBeInTheDocument();
  });

  it("returns new users to sign-in with the intended redirect preserved", async () => {
    searchParamsValue.set("plan", "starter");
    searchParamsValue.set("redirect", "/reports");
    searchParamsValue.set("invite", "invite-token-123");

    render(<SignUpPage />);

    expect(await screen.findByText(/Workspace invitation link detected/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.change(screen.getByLabelText(/^Organization$/i), { target: { value: "Nevada County TC" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => {
      expect(signUpMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/sign-in?created=1&redirect=%2Freports&invite=invite-token-123");
    });
  });

  it("shows an email-confirmation notice instead of routing when the project requires confirmation", async () => {
    // Hosted Supabase with confirmations on: signUp returns a user but no
    // session. The old flow routed to a sign-in screen telling the user to use
    // a password that would not work yet.
    signUpMock.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });

    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.change(screen.getByLabelText(/^Organization$/i), { target: { value: "Nevada County TC" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    expect(await screen.findByText(/Confirm your email to finish/i)).toBeInTheDocument();
    expect(screen.getByText(/planner@example.com/)).toBeInTheDocument();
    // It does NOT route to sign-in — the account cannot sign in yet.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("routes to sign-in when a session is returned (confirmations off)", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null });
    searchParamsValue.set("redirect", "/dashboard");

    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.change(screen.getByLabelText(/^Organization$/i), { target: { value: "Nevada County TC" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/sign-in?created=1&redirect=%2Fdashboard");
    });
    expect(screen.queryByText(/Confirm your email to finish/i)).not.toBeInTheDocument();
  });

  it("folds a recognized landing-page intent into the dashboard redirect", async () => {
    // The landing page's two sign-up doors send ?intent=modeling|engagement.
    // Folding it into the redirect target is what carries it through sign-in
    // (and email confirmation) with no cookie, so the first dashboard visit
    // can point the getting-started checklist at the matching step.
    signUpMock.mockResolvedValue({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null });
    searchParamsValue.set("intent", "engagement");

    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.change(screen.getByLabelText(/^Organization$/i), { target: { value: "Nevada County TC" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        `/sign-in?created=1&redirect=${encodeURIComponent("/dashboard?intent=engagement")}`
      );
    });
  });

  it("drops an unrecognized intent and never overrides an explicit redirect", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null });
    searchParamsValue.set("intent", "modeling");
    searchParamsValue.set("redirect", "/reports");

    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "OpenPlan!2026" } });
    fireEvent.change(screen.getByLabelText(/^Organization$/i), { target: { value: "Nevada County TC" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => {
      // An explicit redirect wins; the intent is not bolted onto /reports.
      expect(pushMock).toHaveBeenCalledWith("/sign-in?created=1&redirect=%2Freports");
    });
  });
});
