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

import AdminPage from "@/app/(app)/admin/page";

describe("AdminPage", () => {
  it("keeps live and staged pilot controls explicit", () => {
    render(<AdminPage />);

    expect(screen.getByText("Admin control room")).toBeInTheDocument();
    expect(screen.getByText("Billing & subscription")).toBeInTheDocument();
    expect(screen.getByText("Pilot readiness")).toBeInTheDocument();
    expect(screen.getAllByText("Staged").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open billing controls/i })).toHaveAttribute("href", "/billing");
    expect(screen.getByRole("link", { name: /Open evidence center/i })).toHaveAttribute(
      "href",
      "/admin/pilot-readiness"
    );
    expect(screen.getByText(/Standard governance profile/i)).toBeInTheDocument();
  });
});
