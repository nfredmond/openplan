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

import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";

describe("WorkspaceMembershipRequired", () => {
  it("sets a supervised pilot/workbench boundary for unprovisioned signed-in accounts", () => {
    render(<WorkspaceMembershipRequired moduleLabel="Projects" />);

    expect(screen.getByText("Workspace membership required")).toBeInTheDocument();
    expect(screen.getByText(/supervised pilot planning workbench/i)).toBeInTheDocument();
    expect(screen.getByText(/planning workbench/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request supervised pilot access/i })).toHaveAttribute(
      "href",
      "/request-access"
    );
  });
});
