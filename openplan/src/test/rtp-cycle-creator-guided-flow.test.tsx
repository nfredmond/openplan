import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker-stub" />,
}));

import { RtpCycleCreator } from "@/components/rtp/rtp-cycle-creator";

/**
 * The plan-cycle create flow. The geography WIRING is guarded separately in
 * `rtp-cycle-creator-uses-the-front-door.test.tsx`; this file is the rest —
 * the body, the pin's pair rule, and the fact that it does not navigate.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ rtpCycleId: "22222222-2222-4222-8222-222222222222" }),
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

function openToArea(name = "2050 Regional Transportation Plan") {
  render(<RtpCycleCreator />);
  fireEvent.click(screen.getByTestId("rtp-cycle-creator-open"));
  fireEvent.change(screen.getByLabelText("Cycle name"), { target: { value: name } });
  next();
}

describe("the plan cycle creator", () => {
  it("gives the operations board back its space", () => {
    render(<RtpCycleCreator />);
    expect(screen.getByTestId("rtp-cycle-creator-open")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cycle name")).toBeNull();
    // The map is not mounted until the step that needs it is reached.
    expect(screen.queryByTestId("study-area-picker-stub")).toBeNull();
  });

  it("posts the same keys, with the review timestamps as instants", async () => {
    openToArea();
    next();
    fireEvent.change(screen.getByLabelText("First horizon year"), { target: { value: "2028" } });
    fireEvent.change(screen.getByLabelText("Public review opens"), {
      target: { value: "2027-01-05T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create the cycle" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/rtp-cycles");
    const body = JSON.parse(String(init.body));
    expect(body.title).toBe("2050 Regional Transportation Plan");
    expect(body.status).toBe("draft");
    expect(body.horizonStartYear).toBe(2028);
    expect(body.publicReviewOpenAt).toBe(new Date("2027-01-05T09:00").toISOString());
    for (const key of ["geographyLabel", "anchorLatitude", "anchorLongitude", "summary"]) {
      expect(key in body, `${key} should be absent when blank`).toBe(false);
    }
  });

  it("refuses half a map pin, beside the two fields it is about", () => {
    // The backdrop needs BOTH to draw anything, so a lone latitude silently
    // renders nothing at all.
    openToArea();
    fireEvent.change(screen.getByLabelText("Map pin latitude"), { target: { value: "39.26" } });
    next();

    expect(
      screen.getAllByText(/both a map pin latitude and longitude, or leave both blank/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a complete pin, and sends it as numbers", async () => {
    openToArea();
    fireEvent.change(screen.getByLabelText("Map pin latitude"), { target: { value: "39.26" } });
    fireEvent.change(screen.getByLabelText("Map pin longitude"), { target: { value: "-121.02" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create the cycle" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.anchorLatitude).toBe(39.26);
    expect(body.anchorLongitude).toBe(-121.02);
  });

  it("refuses a pin that is not numbers", () => {
    openToArea();
    fireEvent.change(screen.getByLabelText("Map pin latitude"), { target: { value: "north-ish" } });
    fireEvent.change(screen.getByLabelText("Map pin longitude"), { target: { value: "west" } });
    next();

    expect(
      screen.getAllByText(/latitude and longitude must be numbers/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a last horizon year before the first", () => {
    openToArea();
    next();
    fireEvent.change(screen.getByLabelText("First horizon year"), { target: { value: "2048" } });
    fireEvent.change(screen.getByLabelText("Last horizon year"), { target: { value: "2028" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the cycle" }));

    expect(
      screen.getAllByText(/last year cannot come before the first year/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays on the board rather than navigating away", async () => {
    openToArea();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Create the cycle" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("will not create a cycle with no name", () => {
    render(<RtpCycleCreator />);
    fireEvent.click(screen.getByTestId("rtp-cycle-creator-open"));
    next();

    expect(
      screen.getAllByText(/Give the cycle a name before you create it/i).length
    ).toBeGreaterThanOrEqual(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
