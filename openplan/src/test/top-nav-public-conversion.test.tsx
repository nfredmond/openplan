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
  it("uses free sign-up as the public primary action and does not link gated previews from the unauthenticated nav", async () => {
    render(await TopNav());

    expect(screen.getByRole("link", { name: /Create free workspace/i })).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("link", { name: /Create free workspace/i })).toHaveClass("top-nav-primary-link");
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: /Evidence catalog/i })).toHaveAttribute("href", "/examples");
    /*
      The nav's home link is asserted by the PRODUCT NAME, not by the tagline
      above it. This previously pinned the kicker "Open planning workspace",
      which made a pure copy change fail a test whose subject — per its own name
      — is the conversion posture: free sign-up primary, no gated previews. A
      tagline is marketing copy and will be rewritten again; "OpenPlan" is the
      thing that has to be there.
    */
    expect(screen.getByText("OpenPlan")).toBeInTheDocument();
    expect(screen.getAllByText(/free and open source/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Maps, engagement, reporting/i)).toBeInTheDocument();
    expect(screen.queryByText(/Planning operating system/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/operator shell/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /App Preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sign up/i })).not.toBeInTheDocument();
  });
});
