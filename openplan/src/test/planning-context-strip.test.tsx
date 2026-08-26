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
});
