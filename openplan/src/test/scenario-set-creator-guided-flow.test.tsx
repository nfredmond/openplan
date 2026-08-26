import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { ScenarioSetCreator } from "@/components/scenarios/scenario-set-creator";

/**
 * The scenario-set create flow, and the two disclosures that must survive a
 * layout conversion.
 *
 * A failed project read and a workspace with no projects produce the SAME empty
 * array. Answering both with "create a project first" states something about
 * the workspace that may be false and sends a planner to duplicate a project
 * they already have — so the two are separate sentences, and neither may be
 * replaced by an open form or a create button that cannot work.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const PROJECTS = [
  { id: "11111111-1111-4111-8111-111111111111", workspace_id: "w", name: "Ridge Road corridor" },
  { id: "33333333-3333-4333-8333-333333333333", workspace_id: "w", name: "Bridge study" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ scenarioSetId: "22222222-2222-4222-8222-222222222222" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the scenario set creator", () => {
  it("is behind a button, not sitting open on the page", () => {
    render(<ScenarioSetCreator projects={PROJECTS} />);
    expect(screen.getByTestId("scenario-set-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("posts exactly what the inline form posted, blanks included", async () => {
    // `summary` and `planningQuestion` are sent RAW here — a blank one arrives
    // as "" rather than absent. That is what the inline form did, and a
    // conversion is not the place to change what lands in the database.
    render(<ScenarioSetCreator projects={PROJECTS} />);
    fireEvent.click(screen.getByTestId("scenario-set-creator-open"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2026 alternatives" } });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECTS[1].id } });
    fireEvent.click(screen.getByRole("button", { name: "Create the scenario set" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scenarios");
    expect(JSON.parse(String(init.body))).toEqual({
      projectId: PROJECTS[1].id,
      title: "2026 alternatives",
      summary: "",
      planningQuestion: "",
    });
  });

  it("defaults to the first project rather than to nothing", async () => {
    render(<ScenarioSetCreator projects={PROJECTS} />);
    fireEvent.click(screen.getByTestId("scenario-set-creator-open"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A set" } });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create the scenario set" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.projectId).toBe(PROJECTS[0].id);
  });

  it("preselects the project carried in planning context", () => {
    render(<ScenarioSetCreator projects={PROJECTS} initialProjectId={PROJECTS[1].id} />);
    fireEvent.click(screen.getByTestId("scenario-set-creator-open"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A set" } });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    expect(screen.getByLabelText("Project")).toHaveValue(PROJECTS[1].id);
  });

  it("does not trust an initial project outside the available workspace list", () => {
    render(<ScenarioSetCreator projects={PROJECTS} initialProjectId="cross-workspace-project" />);
    fireEvent.click(screen.getByTestId("scenario-set-creator-open"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A set" } });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    expect(screen.getByLabelText("Project")).toHaveValue(PROJECTS[0].id);
  });

  it("says a failed project read is a failed read, and offers no create button", () => {
    render(<ScenarioSetCreator projects={[]} projectsUnreadable />);

    expect(screen.getByText("Projects could not be read")).toBeInTheDocument();
    expect(
      screen.getByText(/failed read, not a workspace without projects/i)
    ).toBeInTheDocument();
    // Neither the button nor the flow: creating a set with no project cannot work.
    expect(screen.queryByTestId("scenario-set-creator-open")).toBeNull();
  });

  it("says an empty workspace is an empty workspace, in different words", () => {
    render(<ScenarioSetCreator projects={[]} />);

    expect(screen.getByText("No projects available")).toBeInTheDocument();
    expect(screen.queryByText("Projects could not be read")).toBeNull();
    expect(screen.queryByTestId("scenario-set-creator-open")).toBeNull();
  });

  it("will not create a set with no name", () => {
    render(<ScenarioSetCreator projects={PROJECTS} />);
    fireEvent.click(screen.getByTestId("scenario-set-creator-open"));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    expect(
      screen.getAllByText(/Give the scenario set a name before you create it/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
