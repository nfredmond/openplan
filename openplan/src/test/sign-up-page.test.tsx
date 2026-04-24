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
    searchParamsValue.forEach((_, key) => searchParamsValue.delete(key));
  });

  it("preserves plan and redirect context on the sign-in link", async () => {
    searchParamsValue.set("plan", "starter");
    searchParamsValue.set("redirect", "/reports");
    searchParamsValue.set("invite", "invite-token-123");

    render(<SignUpPage />);

    expect(await screen.findByRole("link", { name: /Sign in/i })).toHaveAttribute(
      "href",
      "/sign-in?plan=starter&redirect=%2Freports&invite=invite-token-123",
    );
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
      expect(pushMock).toHaveBeenCalledWith("/sign-in?created=1&redirect=%2Freports&plan=starter&invite=invite-token-123");
    });
  });
});
