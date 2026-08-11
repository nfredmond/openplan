import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

/**
 * Step 2 of the app's own workflow rail linked to a bare "/explore" while
 * step 3 correctly carried `?projectId=` into engagement — so the one path the
 * product draws for a planner dropped the project in the middle. /explore
 * reads `?projectId=` and inherits the project's study area from it; these
 * tests pin that the rail actually hands it over.
 */
describe("PilotWorkflowHandoff", () => {
  function hrefOf(cta: string) {
    return screen.getByText(cta).closest("a")?.getAttribute("href");
  }

  it("carries the project into the analysis step, not just the engagement step", () => {
    render(<PilotWorkflowHandoff projectId="proj-a" />);

    expect(hrefOf("Open analysis")).toBe("/explore?projectId=proj-a");
    // Step 3 already carried it; keep both pinned so the rail stays whole.
    expect(hrefOf("Open engagement")).toBe("/engagement?projectId=proj-a");
    expect(hrefOf("Review project context")).toBe("/projects/proj-a");
  });

  it("threads whichever project it was given, rather than hardcoding one", () => {
    // Varied binding: a fixture with a single id cannot tell "threads the id"
    // from "hardcodes it".
    render(<PilotWorkflowHandoff projectId="proj-b" />);

    expect(hrefOf("Open analysis")).toBe("/explore?projectId=proj-b");
  });

  it("falls back to the bare module path when no project anchors the story yet", () => {
    render(<PilotWorkflowHandoff />);

    expect(hrefOf("Open analysis")).toBe("/explore");
    expect(hrefOf("Open projects")).toBe("/projects");
  });
});
