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

  it("surfaces first-success guidance after account creation and preserves the redirect target", async () => {
    searchParamsValue.set("created", "1");
    searchParamsValue.set("plan", "starter");
    searchParamsValue.set("redirect", "/reports");

    render(<SignInPage />);

    expect(await screen.findByText(/Account created — next step is your first workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/launch billing only after you are inside the correct workspace context/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create an account/i })).toHaveAttribute(
      "href",
      "/sign-up?plan=starter&redirect=%2Freports",
    );
  });

  it("preserves invite tokens on the create-account link", async () => {
    searchParamsValue.set("redirect", "/dashboard");
    searchParamsValue.set("invite", "invite-token-123");

    render(<SignInPage />);

    expect(await screen.findByText(/Workspace invitation link detected/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create an account/i })).toHaveAttribute(
      "href",
      "/sign-up?plan=starter&redirect=%2Fdashboard&invite=invite-token-123",
    );
  });

  it("accepts an invitation token after sign-in before redirecting", async () => {
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
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "invite-token-123" }),
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });
});
