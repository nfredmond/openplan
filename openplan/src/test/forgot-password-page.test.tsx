import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetPasswordForEmailMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail: resetPasswordForEmailMock } }),
}));

import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";

async function request(email: string) {
  render(<ForgotPasswordPage />);
  fireEvent.change(await screen.findByLabelText(/work email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /email me a reset link/i }));
}

/**
 * M-2 of the hosted review. Supabase answers an unknown address with success,
 * and refuses a real account's second request inside 60 seconds with HTTP 429.
 * Showing that refusal would tell anyone which addresses have accounts.
 */
describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    resetPasswordForEmailMock.mockReset();
  });

  it("shows the same notice for a rate-limited real account as for an unknown address", async () => {
    resetPasswordForEmailMock.mockResolvedValue({
      error: {
        status: 429,
        code: "over_email_send_rate_limit",
        message: "For security purposes, you can only request this after 42 seconds.",
      },
    });
    await request("planner@example.invalid");
    expect(await screen.findByRole("status")).toHaveTextContent("Check your email.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still reports a failure the person can act on", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: { status: 500, message: "Error sending recovery email" } });
    await request("planner@example.invalid");
    expect(await screen.findByRole("alert")).toHaveTextContent("Error sending recovery email");
  });
});
