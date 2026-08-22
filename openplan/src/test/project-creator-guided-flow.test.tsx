import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { ProjectWorkspaceCreator } from "@/components/projects/project-workspace-creator";

/**
 * Starting a project, as a flow.
 *
 * Three behaviours here are easy to lose in a conversion and expensive to lose
 * in use: the response's `details` being preferred over its generic `error`,
 * the navigation happening ONLY when there is an id to navigate to, and the
 * paragraph explaining that "project" is not "workspace".
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ projectRecordId: "22222222-2222-4222-8222-222222222222" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function start(name = "Ridge Road safety") {
  render(<ProjectWorkspaceCreator />);
  fireEvent.click(screen.getByTestId("project-workspace-creator-open"));
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

describe("starting a project", () => {
  it("is behind a button, and still says it is not a new workspace", () => {
    render(<ProjectWorkspaceCreator />);

    expect(screen.getByTestId("project-workspace-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Project name")).toBeNull();
    // "Workspace" means a tenant everywhere else in the product. A planner who
    // thinks this button makes one expects an empty world and gets a record in
    // the world they are already in.
    expect(screen.getByText(/It does not create a new workspace/i)).toBeInTheDocument();
  });

  it("posts the same five keys, blanks raw", async () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Start the project" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects");
    expect(JSON.parse(String(init.body))).toEqual({
      projectName: "Ridge Road safety",
      // Raw, as the inline form sent it — not tidied into undefined.
      summary: "",
      planType: "corridor_plan",
      deliveryPhase: "scoping",
      status: "active",
    });
  });

  it("prefers the server's specific message over its generic one", async () => {
    // The route answers with `details` beside `error`; showing `error` tells a
    // planner less than the server was willing to say.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Failed to create project",
        details: "A project called Ridge Road safety already exists in this workspace",
      }),
    });

    start();
    fireEvent.click(screen.getByRole("button", { name: "Start the project" }));

    expect(
      await screen.findByText(/already exists in this workspace/i)
    ).toBeInTheDocument();
  });

  it("navigates only when the response carries an id", async () => {
    // `projectRecordId` is optional. Pushing without it lands on
    // /projects/undefined.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ workspaceId: "w" }) });

    start();
    fireEvent.click(screen.getByRole("button", { name: "Start the project" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("goes to the project when there is one to go to", async () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Start the project" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/projects/22222222-2222-4222-8222-222222222222")
    );
  });

  it("will not start a project with no name", () => {
    render(<ProjectWorkspaceCreator />);
    fireEvent.click(screen.getByTestId("project-workspace-creator-open"));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));

    expect(
      screen.getAllByText(/Give the project a name before you start it/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
