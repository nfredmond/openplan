import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathnameValue = "/admin/pilot-readiness";

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameValue,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AppSecondaryNav } from "@/components/nav/app-secondary-nav";

describe("AppSecondaryNav", () => {
  beforeEach(() => {
    pathnameValue = "/admin/pilot-readiness";
  });

  it("keeps the operations section free of operator-only admin routes", () => {
    render(<AppSecondaryNav />);

    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Agent Activity")).toBeInTheDocument();
    expect(screen.queryByText("Pilot Readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows the operations section with an Agent Activity link on /assistant-activity", () => {
    pathnameValue = "/assistant-activity";

    render(<AppSecondaryNav />);

    expect(screen.getByText("Operations")).toBeInTheDocument();
    const agentActivityLink = screen.getByText("Agent Activity").closest("a");
    expect(agentActivityLink).toHaveAttribute("href", "/assistant-activity");
    expect(screen.getByText("Current")).toBeInTheDocument();
  });
});
