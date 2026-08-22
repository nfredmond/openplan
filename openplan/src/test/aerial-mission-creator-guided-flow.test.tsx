import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { AerialMissionCreator } from "@/components/aerial/aerial-mission-creator";

/**
 * Logging a flight, as a flow rather than a form open on the project page.
 *
 * The behaviours below are the ones a conversion is most likely to lose
 * quietly: the date conversion, the "log another" reset, and the fact that this
 * one does NOT navigate — a mission is logged against the project the planner
 * is already reading.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function openFlow() {
  fireEvent.click(screen.getByTestId("aerial-mission-creator-open"));
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
}

describe("the aerial mission creator", () => {
  it("is behind a button, not open on the project page", () => {
    render(<AerialMissionCreator projectId={PROJECT_ID} />);
    expect(screen.getByTestId("aerial-mission-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mission name")).toBeNull();
  });

  it("posts the same body, with the collection date as an ISO string", async () => {
    render(<AerialMissionCreator projectId={PROJECT_ID} />);
    openFlow();
    fireEvent.change(screen.getByLabelText("Mission name"), {
      target: { value: "SR 49 lidar capture" },
    });
    fireEvent.change(screen.getByLabelText("What kind of flight?"), {
      target: { value: "site_inspection" },
    });
    next();
    fireEvent.change(screen.getByLabelText("When was it collected?"), {
      target: { value: "2026-08-20T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log the mission" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/aerial/missions");
    const body = JSON.parse(String(init.body));
    expect(body.projectId).toBe(PROJECT_ID);
    expect(body.title).toBe("SR 49 lidar capture");
    expect(body.missionType).toBe("site_inspection");
    expect(body.status).toBe("planned");
    // A datetime-local value is not an instant until it is converted.
    expect(body.collectedAt).toBe(new Date("2026-08-20T09:30").toISOString());
    // Untouched optionals stay absent.
    expect("geographyLabel" in body).toBe(false);
    expect("notes" in body).toBe(false);
  });

  it("stays on the project page rather than navigating away", async () => {
    render(<AerialMissionCreator projectId={PROJECT_ID} />);
    openFlow();
    fireEvent.change(screen.getByLabelText("Mission name"), { target: { value: "A flight" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the mission" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // The evidence the planner was reading is the reason they are here.
    expect(pushMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("aerial-mission-logged")).toHaveTextContent("Mission logged.");
  });

  it("comes back blank for the next mission, and re-seeds the study area", async () => {
    render(<AerialMissionCreator projectId={PROJECT_ID} defaultGeographyLabel="Ridge Road corridor" />);
    openFlow();
    fireEvent.change(screen.getByLabelText("Mission name"), { target: { value: "First flight" } });
    next();
    fireEvent.change(screen.getByLabelText("Which area was flown?"), {
      target: { value: "Segment A only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log the mission" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Reopening must not carry the last mission's answers, or a second flight
    // is logged under the first one's name.
    openFlow();
    expect(screen.getByLabelText("Mission name")).toHaveValue("");
    // A name is required to advance — filling it is what the planner does, and
    // it is also why the two assertions below need it.
    fireEvent.change(screen.getByLabelText("Mission name"), { target: { value: "Second flight" } });
    next();
    expect(screen.getByLabelText("Which area was flown?")).toHaveValue("Ridge Road corridor");
  });

  it("clears the confirmation when the next mission is started", async () => {
    // A lingering "Mission logged." while somebody is filling in their SECOND
    // mission says the one they are typing is already saved. Found by a
    // mutation that survived: nothing asserted this until it did.
    render(<AerialMissionCreator projectId={PROJECT_ID} />);
    openFlow();
    fireEvent.change(screen.getByLabelText("Mission name"), { target: { value: "First flight" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the mission" }));
    expect(await screen.findByTestId("aerial-mission-logged")).toBeInTheDocument();

    openFlow();
    expect(screen.queryByTestId("aerial-mission-logged")).toBeNull();
  });

  it("seeds the area from the project, and says that is where it came from", () => {
    render(<AerialMissionCreator projectId={PROJECT_ID} defaultGeographyLabel="Ridge Road corridor" />);
    openFlow();
    fireEvent.change(screen.getByLabelText("Mission name"), { target: { value: "A flight" } });
    next();

    expect(screen.getByLabelText("Which area was flown?")).toHaveValue("Ridge Road corridor");
    expect(screen.getByText(/Narrow it to what was actually flown/i)).toBeInTheDocument();
  });

  it("will not log a mission with no name", () => {
    render(<AerialMissionCreator projectId={PROJECT_ID} />);
    openFlow();
    next();

    expect(
      screen.getAllByText(/Give the mission a name before you log it/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's own refusal", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "This project already has a mission with that name" }),
    });

    render(<AerialMissionCreator projectId={PROJECT_ID} />);
    openFlow();
    fireEvent.change(screen.getByLabelText("Mission name"), { target: { value: "A flight" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Log the mission" }));

    expect(
      await screen.findByText("This project already has a mission with that name")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("aerial-mission-logged")).toBeNull();
  });
});
