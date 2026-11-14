import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanningContextStrip } from "@/components/projects/planning-context-strip";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("PlanningContextStrip", () => {
  it("shows the active project and a return path", () => {
    render(
      <PlanningContextStrip
        context={{
          status: "active",
          requestedProjectId: "project-1",
          project: { id: "project-1", name: "Main Street" },
        }}
      />,
    );

    expect(screen.getByLabelText("Active project")).toHaveTextContent("Main Street");
    expect(screen.getByRole("link", { name: "Return to project" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
  });

  it("makes a rejected project visible without echoing its id", () => {
    render(
      <PlanningContextStrip
        context={{ status: "rejected", requestedProjectId: "foreign-secret", project: null }}
      />,
    );

    expect(screen.getByLabelText("Project context unavailable")).toHaveTextContent(
      "missing or does not belong to the active workspace",
    );
    expect(screen.queryByText("foreign-secret")).not.toBeInTheDocument();
  });

  /**
   * Both strips are tinted surfaces. The accent as link text measures 4.32:1
   * (Cartographic) and 4.26:1 (Meadow) on the 6 percent primary tint, under the
   * 4.5:1 floor, so the links take the foreground ink and keep the accent as
   * the underline. `palette-text-clears-every-surface.test.ts` measures the
   * foreground on that tint.
   */
  it.each([
    ["active", { status: "active", requestedProjectId: "project-1", project: { id: "project-1", name: "Main Street" } }, "Return to project"],
    ["rejected", { status: "rejected", requestedProjectId: "project-2", project: null }, "Open projects"],
  ] as const)("keeps the %s strip's link out of the accent ink", (_state, context, name) => {
    render(<PlanningContextStrip context={context} />);

    const link = screen.getByRole("link", { name });
    const classes = link.className.split(/\s+/);
    expect(classes).toContain("text-foreground");
    expect(classes).toContain("underline");
    expect(classes).not.toContain("text-primary");
  });
});
