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
    expect(screen.queryByText("Pilot Readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});
