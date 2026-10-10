import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ModelCreator } from "@/components/models/model-creator";

const PROJECTS = [
  { id: "project-1", name: "Downtown Mobility Plan" },
  { id: "project-2", name: "Transit Access Plan" },
];

function openProjectStep() {
  fireEvent.click(screen.getByTestId("model-creator-open"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Travel model" } });
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ModelCreator planning context", () => {
  it("keeps an unlinked model on the planning-work step", () => {
    render(<ModelCreator projects={PROJECTS} scenarioSets={[]} />);
    openProjectStep();
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    expect(screen.getByLabelText("Primary project")).toBeInTheDocument();
    expect(screen.getAllByText("Choose a primary project or scenario set before continuing.").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Model family")).not.toBeInTheDocument();
  });

  it.each(["project", "scenario"])("accepts a %s link without requiring both", (kind) => {
    render(<ModelCreator projects={PROJECTS} scenarioSets={[{ id: "scenario-1", title: "No Build" }]} />);
    openProjectStep();
    fireEvent.change(screen.getByLabelText(kind === "project" ? "Primary project" : "Primary scenario set"), {
      target: { value: kind === "project" ? "project-1" : "scenario-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    expect(screen.getByLabelText("Model family")).toBeInTheDocument();
  });

  it("preselects the project carried in planning context", () => {
    render(
      <ModelCreator
        projects={PROJECTS}
        scenarioSets={[]}
        initialProjectId="project-2"
      />
    );

    openProjectStep();
    expect(screen.getByLabelText("Primary project")).toHaveValue("project-2");
  });

  it("does not trust an initial project outside the available workspace list", () => {
    render(
      <ModelCreator
        projects={PROJECTS}
        scenarioSets={[]}
        initialProjectId="cross-workspace-project"
      />
    );

    openProjectStep();
    expect(screen.getByLabelText("Primary project")).toHaveValue("");
  });
});
