import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

import { TopNav } from "@/components/top-nav";

describe("TopNav public conversion posture", () => {
  it("uses request access as the public primary action and does not link gated previews from the unauthenticated nav", async () => {
    render(await TopNav());

    expect(screen.getByRole("link", { name: /Request access/i })).toHaveAttribute("href", "/request-access");
    expect(screen.getByRole("link", { name: /Request access/i })).toHaveClass("top-nav-primary-link");
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: /Evidence catalog/i })).toHaveAttribute("href", "/examples");
    expect(screen.queryByRole("link", { name: /App Preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sign up/i })).not.toBeInTheDocument();
  });
});
