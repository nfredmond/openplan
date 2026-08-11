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

import HelpPage from "@/app/(app)/help/page";
import { APP_NAV_ENTRIES } from "@/components/nav/nav-registry";
import { MODULE_DESCRIPTIONS } from "@/lib/help/module-descriptions";
import { NEW_WORKSPACE_GETTING_STARTED_STEPS } from "@/lib/onboarding/getting-started";

describe("HelpPage", () => {
  /**
   * The description map and the nav registry must cover each other exactly:
   * a module added to the nav without a Help paragraph fails here, and so does
   * a paragraph for a module that no longer exists.
   */
  it("has a description for every registered module, and no stale ones", () => {
    const registered = APP_NAV_ENTRIES.map((entry) => entry.href).sort();
    const described = Object.keys(MODULE_DESCRIPTIONS).sort();
    expect(described).toEqual(registered);

    render(<HelpPage />);
    for (const entry of APP_NAV_ENTRIES) {
      expect(
        screen.getByRole("link", { name: entry.label }),
        `no module link for ${entry.href}`
      ).toHaveAttribute("href", entry.href);
    }
    expect(
      screen.queryByText(/No description has been written for this module yet/)
    ).not.toBeInTheDocument();
  });

  it("renders the same getting-started list the workspace bootstrap API returns", () => {
    render(<HelpPage />);

    for (const step of NEW_WORKSPACE_GETTING_STARTED_STEPS) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("links the operator guides on GitHub", () => {
    render(<HelpPage />);

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("https://github.com/nfredmond/openplan/blob/main/README.md");
    expect(hrefs).toContain(
      "https://github.com/nfredmond/openplan/blob/main/openplan/docs/FIRST_DEPLOYMENT.md"
    );
    expect(hrefs).toContain(
      "https://github.com/nfredmond/openplan/blob/main/openplan/docs/SELF_HOSTING.md"
    );
  });

  it("lists which features need an AI key, in the checklist's own terms", () => {
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", { name: /Which features need an AI key/ })
    ).toBeInTheDocument();
    // The same four features the dashboard checklist's AI step names.
    expect(screen.getByText(/The Planner Agent/)).toBeInTheDocument();
    expect(screen.getByText(/AI synthesis of public comments/)).toBeInTheDocument();
    expect(screen.getByText(/Narrative drafting for reports and grant applications/)).toBeInTheDocument();
    expect(screen.getByText(/Comment translation on public engagement portals/)).toBeInTheDocument();
    // Who pays whom: the provider bills the workspace's own account, never OpenPlan.
    expect(
      screen.getByText(/usage is billed by the\s+provider, not by OpenPlan/)
    ).toBeInTheDocument();
    // And the path to fix it: the dashboard checklist step.
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/dashboard#workspace-ai-key");
  });

  it("tells planners plainly which fixes belong to whoever operates the deployment", () => {
    render(<HelpPage />);

    expect(
      screen.getByRole("heading", { name: /Some fixes need whoever operates this deployment/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing about your account, your data, or your area caused it/i)
    ).toBeInTheDocument();
  });

  it("speaks planner, not engineer: no environment-variable names or table names", () => {
    const { container } = render(<HelpPage />);
    const text = container.textContent ?? "";

    // Env-var shapes and internal identifiers stay out of this page — the
    // operator docs it links to carry those.
    expect(text).not.toMatch(/OPENPLAN_[A-Z_]+/);
    expect(text).not.toMatch(/NEXT_PUBLIC_[A-Z_]+/);
    expect(text).not.toMatch(/assistant_action_executions|workspace_members/);
  });
});
