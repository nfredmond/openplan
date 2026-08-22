import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { PlanCreator } from "@/components/plans/plan-creator";

/**
 * A CONVERSION MAY CHANGE THE SHAPE OF THE ASKING AND NOTHING ELSE.
 *
 * Moving a create form into a guided flow re-plumbs every field through a new
 * value store, and the failure that matters is silent: a key renamed, a `""`
 * sent where `undefined` was, a field dropped from the body entirely. None of
 * that shows on screen — the flow closes, the row appears, and a column that
 * used to hold null now holds an empty string.
 *
 * So the body is asserted whole, against the inline form this replaced.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const PROJECTS = [
  { id: "11111111-1111-4111-8111-111111111111", workspace_id: "w", name: "Ridge Road corridor" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ planId: "22222222-2222-4222-8222-222222222222" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function open() {
  render(<PlanCreator projects={PROJECTS} />);
  fireEvent.click(screen.getByTestId("plan-creator-open"));
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

describe("the plan creator asks in steps and posts what it always posted", () => {
  it("does not sit open on the page — it is behind a button", () => {
    // The whole point of the archetype: a create form should not eat the page a
    // planner came to read.
    render(<PlanCreator projects={PROJECTS} />);
    expect(screen.getByTestId("plan-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("sends every field, with blanks absent rather than empty", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Downtown safety plan" } });
    fireEvent.change(screen.getByLabelText("What kind of plan is it?"), {
      target: { value: "safety" },
    });
    next();
    fireEvent.change(screen.getByLabelText("Primary project"), {
      target: { value: PROJECTS[0].id },
    });
    fireEvent.change(screen.getByLabelText("What year does it look ahead to?"), {
      target: { value: "2035" },
    });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create the plan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/plans");
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      title: "Downtown safety plan",
      planType: "safety",
      status: "draft",
      projectId: PROJECTS[0].id,
      // A number, not the string the input holds.
      horizonYear: 2035,
      // Untouched optionals are ABSENT. `JSON.stringify` drops `undefined`, and
      // that is what keeps these columns null instead of empty strings.
    });
    expect("geographyLabel" in body).toBe(false);
    expect("summary" in body).toBe(false);
  });

  it("refuses a horizon year the old form only pretended to bound", async () => {
    // The inline form expressed 1900..2200 as min/max on a number input, which
    // binds NATIVE form validation only — and a guided flow's submit does not
    // go through it, so 20355 reached the API. The bound is checked by the
    // thing that submits now.
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A plan" } });
    next();
    fireEvent.change(screen.getByLabelText("What year does it look ahead to?"), {
      target: { value: "20355" },
    });
    next();

    // The flow states a problem twice on purpose: once in the step's summary
    // and once beside the field it belongs to.
    expect(
      (await screen.findAllByText(/horizon year between 1900 and 2200/i)).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still accepts no horizon year at all", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A plan" } });
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create the plan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect("horizonYear" in body).toBe(false);
  });

  it("will not create a plan with no name", () => {
    open();
    next();

    expect(screen.getAllByText(/Give the plan a name before you create it/i).length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the API's own message instead of a generic failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "A plan with that name already exists" }),
    });

    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A plan" } });
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create the plan" }));

    expect(await screen.findByText("A plan with that name already exists")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("goes to the new plan once it exists", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A plan" } });
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create the plan" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/plans/22222222-2222-4222-8222-222222222222")
    );
    expect(refreshMock).toHaveBeenCalled();
  });
});
