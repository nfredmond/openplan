import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { ProgramCreator } from "@/components/programs/program-creator";
import { PROGRAM_FUNDING_CLASSIFICATION_OPTIONS } from "@/lib/programs/catalog";

/**
 * Fourteen fields that used to hold a column of the programs page.
 *
 * The body is asserted whole against the inline form, and the two dates are
 * asserted as INSTANTS: `toIsoDateTime` turns a blank or an unparseable value
 * into absent rather than into an invalid string reaching the API.
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
    json: async () => ({ programId: "22222222-2222-4222-8222-222222222222" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

/** Fill the two required answers and land on the dates step. */
function openToDates() {
  render(<ProgramCreator projects={PROJECTS} />);
  fireEvent.click(screen.getByTestId("program-creator-open"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2027 RTIP package" } });
  fireEvent.change(screen.getByLabelText("Which funding cycle?"), {
    target: { value: "2027 RTIP" },
  });
  next();
  next();
  next();
}

describe("the program creator", () => {
  it("gives the page its column back", () => {
    render(<ProgramCreator projects={PROJECTS} />);
    expect(screen.getByTestId("program-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("posts every field the inline form posted", async () => {
    openToDates();
    fireEvent.change(screen.getByLabelText("First fiscal year"), { target: { value: "2027" } });
    fireEvent.change(screen.getByLabelText("Nominations due"), {
      target: { value: "2026-11-01T17:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create the program" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/programs");
    const body = JSON.parse(String(init.body));

    expect(body.title).toBe("2027 RTIP package");
    expect(body.programType).toBe("rtip");
    expect(body.status).toBe("draft");
    // Sent RAW by the inline form, and still raw — not tidied into undefined
    // under cover of a layout change.
    expect(body.cycleName).toBe("2027 RTIP");
    expect(body.fundingClassification).toBe(PROGRAM_FUNDING_CLASSIFICATION_OPTIONS[0].value);
    // A number, not the string the input holds.
    expect(body.fiscalYearStart).toBe(2027);
    // An instant, not the local wall-clock string.
    expect(body.nominationDueAt).toBe(new Date("2026-11-01T17:00").toISOString());
    // Untouched optionals absent.
    for (const key of ["projectId", "sponsorAgency", "ownerLabel", "cadenceLabel", "summary", "fiscalYearEnd", "adoptionTargetAt"]) {
      expect(key in body, `${key} should be absent when blank`).toBe(false);
    }
  });

  it("refuses a last year before the first, which the old form never checked", () => {
    // Native min/max validation does not run for a flow's submit, so an end
    // year before the start reached the API.
    openToDates();
    fireEvent.change(screen.getByLabelText("First fiscal year"), { target: { value: "2030" } });
    fireEvent.change(screen.getByLabelText("Last fiscal year"), { target: { value: "2027" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the program" }));

    expect(
      screen.getAllByText(/last year cannot come before the first year/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a year outside any plausible range", () => {
    openToDates();
    fireEvent.change(screen.getByLabelText("First fiscal year"), { target: { value: "20270" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the program" }));

    expect(
      screen.getAllByText(/year between 1900 and 2200/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("will not create a program without a name or a cycle", () => {
    render(<ProgramCreator projects={PROJECTS} />);
    fireEvent.click(screen.getByTestId("program-creator-open"));
    next();

    expect(screen.getAllByText(/Give the program a name/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/which funding cycle/i).length).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's own refusal and stays put", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "That cycle already has a program with this name" }),
    });

    openToDates();
    fireEvent.click(screen.getByRole("button", { name: "Create the program" }));

    expect(
      await screen.findByText("That cycle already has a program with this name")
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("goes to the new program once it exists", async () => {
    openToDates();
    fireEvent.click(screen.getByRole("button", { name: "Create the program" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/programs/22222222-2222-4222-8222-222222222222")
    );
  });
});
