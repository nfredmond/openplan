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

  it("surfaces pilot readiness as an operations-adjacent route", () => {
    render(<AppSecondaryNav />);

    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText(/Commercial controls and pilot-readiness surfaces/i)).toBeInTheDocument();
    expect(screen.getByText("Pilot Readiness")).toBeInTheDocument();
    expect(screen.getByText(/Smoke evidence, proof packets, and launch diligence/i)).toBeInTheDocument();
  });
});
