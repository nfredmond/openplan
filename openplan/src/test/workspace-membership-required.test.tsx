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
  it("explains the workspace boundary for unprovisioned signed-in accounts", () => {
    render(<WorkspaceMembershipRequired moduleLabel="Projects" />);

    expect(screen.getByText("Workspace membership required")).toBeInTheDocument();
    expect(screen.getByText(/records belong to a workspace/i)).toBeInTheDocument();
    // The default must not point at the deleted /request-access route (a 404).
    expect(screen.getByRole("link", { name: /go to your workspace/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    expect(screen.queryByRole("link", { name: /request/i })).not.toBeInTheDocument();
  });
});
