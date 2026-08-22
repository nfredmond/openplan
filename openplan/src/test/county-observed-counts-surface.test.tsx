import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getScaffoldMock = vi.fn();
const saveScaffoldMock = vi.fn();

vi.mock("@/lib/api/county-onramp-client", () => ({
  getCountyRunScaffold: (...args: unknown[]) => getScaffoldMock(...args),
  saveCountyRunScaffold: (...args: unknown[]) => saveScaffoldMock(...args),
}));

import { CountyRunObservedCounts } from "@/components/county-runs/county-run-observed-counts";

/**
 * THE DOOR ONTO THE OBSERVED COUNTS, RENDERED.
 *
 * `every-api-route-has-a-caller` can only see that a call site EXISTS. It
 * cannot see a caller no planner can reach — the defect class this route sat in
 * for months, complete and tested with nothing opening it. So this file renders
 * the real component and drives it the way a person does.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const SCAFFOLD = {
  path: "/srv/runs/nevada/scaffold.csv",
  csvContent: "",
  header: ["station_id", "observed_volume", "source_agency", "source_description", "link_id"],
  rows: [
    {
      station_id: "S-1",
      observed_volume: "",
      source_agency: "TBD",
      source_description: "",
      link_id: "4411",
    },
    {
      station_id: "S-2",
      observed_volume: "12500",
      source_agency: "Caltrans",
      source_description: "Mainline, north of ramp",
      link_id: "4412",
    },
  ],
  summary: {
    station_count: 2,
    observed_volume_filled_count: 1,
    observed_volume_missing_count: 1,
    source_agency_filled_count: 1,
    source_agency_tbd_count: 1,
    source_description_filled_count: 1,
    source_description_missing_count: 1,
    ready_station_count: 1,
    next_action_label: "Add a count for 1 station",
  },
};

beforeEach(() => {
  getScaffoldMock.mockResolvedValue(SCAFFOLD);
  saveScaffoldMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function open() {
  render(<CountyRunObservedCounts countyRunId="run-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Open counts" }));
  await waitFor(() => expect(screen.getByTestId("observed-counts-table")).toBeInTheDocument());
}

describe("a planner can reach and edit the observed counts", () => {
  it("reads nothing until asked, then shows a row per station", async () => {
    render(<CountyRunObservedCounts countyRunId="run-1" />);

    // Not on mount: the scaffold may live on the deployment's filesystem.
    expect(getScaffoldMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open counts" }));
    await waitFor(() => expect(screen.getByTestId("observed-counts-table")).toBeInTheDocument());

    expect(getScaffoldMock).toHaveBeenCalledWith("run-1");
    expect(screen.getByTestId("counts-row-S-1")).toBeInTheDocument();
    expect(screen.getByTestId("counts-row-S-2")).toBeInTheDocument();
  });

  it("says how many stations still need a count", async () => {
    await open();
    const readiness = screen.getByTestId("scaffold-readiness");

    expect(readiness.textContent).toContain("2 stations");
    expect(readiness.textContent).toContain("1 still missing one");
    expect(readiness.textContent).toContain("1 ready to validate");
  });

  it("lets a planner type a count and sends the WHOLE file back", async () => {
    await open();

    fireEvent.change(screen.getByLabelText("observed volume for station S-1"), {
      target: { value: "8750" },
    });
    fireEvent.change(screen.getByLabelText("source agency for station S-1"), {
      target: { value: "Nevada County" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));

    await waitFor(() => expect(saveScaffoldMock).toHaveBeenCalled());
    const [, csv] = saveScaffoldMock.mock.calls[0] as [string, string];

    expect(csv).toContain("S-1,8750,Nevada County,");
    // The station nobody touched survives untouched, quoting and all — a save
    // that dropped it would delete a count somebody already sourced.
    expect(csv).toContain('S-2,12500,Caltrans,"Mainline, north of ramp",4412');
    // And the column this screen does not understand is still there.
    expect(csv.split("\n")[0]).toContain("link_id");
  });

  it("never offers the station id as editable", async () => {
    await open();

    // Re-pointing a count at another link is the one error nobody would catch,
    // and the route's diff compares BY station id.
    expect(screen.queryByLabelText("station id for station S-1")).toBeNull();
    const row = within(screen.getByTestId("counts-row-S-1"));
    expect(row.getAllByRole("textbox")).toHaveLength(3);
  });

  it("cannot save until something has actually changed", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Save counts" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("observed volume for station S-1"), {
      target: { value: "1" },
    });
    expect(screen.getByRole("button", { name: "Save counts" })).toBeEnabled();
  });

  it("re-reads after saving, so the readiness figures come from the saved file", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("observed volume for station S-1"), {
      target: { value: "8750" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));

    await waitFor(() => expect(getScaffoldMock).toHaveBeenCalledTimes(2));
  });

  it("says a load failed rather than showing an empty set of counts", async () => {
    getScaffoldMock.mockRejectedValueOnce(new Error("Registered scaffold CSV file was not found"));
    render(<CountyRunObservedCounts countyRunId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open counts" }));

    await waitFor(() =>
      expect(screen.getByTestId("observed-counts-error").textContent).toContain(
        "Registered scaffold CSV file was not found"
      )
    );
    // An empty table here would read as "this run has no stations".
    expect(screen.queryByTestId("observed-counts-table")).toBeNull();
  });

  it("keeps the edits on screen when a save fails", async () => {
    await open();
    saveScaffoldMock.mockRejectedValueOnce(new Error("permission denied"));

    fireEvent.change(screen.getByLabelText("observed volume for station S-1"), {
      target: { value: "8750" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));

    await waitFor(() =>
      expect(screen.getByTestId("observed-counts-error").textContent).toContain("permission denied")
    );
    // Throwing away what somebody just typed because the write failed is how a
    // planner loses an afternoon of counts.
    expect(screen.getByLabelText("observed volume for station S-1")).toHaveValue("8750");
    expect(screen.getByRole("button", { name: "Save counts" })).toBeEnabled();
  });
});
