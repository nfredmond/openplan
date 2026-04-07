import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
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
      signInWithPassword: vi.fn(),
    },
  }),
}));

import SignInPage from "@/app/(auth)/sign-in/page";

describe("SignInPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
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
});
