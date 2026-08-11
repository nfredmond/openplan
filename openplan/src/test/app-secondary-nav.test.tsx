import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathnameValue = "/reports";

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

/**
 * The component renders findNavSection() and nothing else — the registry's
 * groups are the ONLY grouping. These tests render the real component so the
 * derivation is proven where the planner sees it, not just at the registry.
 */
describe("AppSecondaryNav", () => {
  beforeEach(() => {
    pathnameValue = "/reports";
  });

  it("renders the registry's Workspace group on /reports, with no grouping of its own", () => {
    render(<AppSecondaryNav />);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Planner Agent Activity")).toBeInTheDocument();
    // The old hand-written grouping and retired surfaces must not resurface.
    expect(screen.queryByText("Operations")).not.toBeInTheDocument();
    expect(screen.queryByText("Command Center")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("marks the ledger current on /assistant-activity, inside the Workspace group", () => {
    pathnameValue = "/assistant-activity";

    render(<AppSecondaryNav />);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    const ledgerLink = screen.getByText("Planner Agent Activity").closest("a");
    expect(ledgerLink).toHaveAttribute("href", "/assistant-activity");
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("gives /aerial the Library section like every other module", () => {
    pathnameValue = "/aerial";

    render(<AppSecondaryNav />);

    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("Data Hub")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    const aerialLink = screen.getByText("Aerial Imagery").closest("a");
    expect(aerialLink).toHaveAttribute("href", "/aerial");
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("resolves a deep child path to its module's group", () => {
    pathnameValue = "/grants/some-opportunity/detail";

    render(<AppSecondaryNav />);

    expect(screen.getByText("Funding")).toBeInTheDocument();
    expect(screen.getByText("Grants")).toBeInTheDocument();
    expect(screen.getByText("Invoices & Reimbursements")).toBeInTheDocument();
    // /grants is current even though the pathname is a child page.
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("renders nothing on an unregistered path", () => {
    pathnameValue = "/not-a-registered-surface";

    const { container } = render(<AppSecondaryNav />);

    expect(container).toBeEmptyDOMElement();
  });
});
