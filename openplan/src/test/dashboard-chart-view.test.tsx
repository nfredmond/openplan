import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import {
  DASHBOARD_CHART_IDS,
  DASHBOARD_CHARTS,
  dashboardChartStorageKey,
  type DashboardChartId,
} from "@/lib/dashboard/chart-catalog";
import { blocked, series, type InsightSeries } from "@/lib/dashboard/insights";

/**
 * THE INSIGHTS VIEW, AS A READER MEETS IT.
 *
 * Two things are asserted here and nothing else: that the person's choice of
 * figures is honoured and remembered, and that a figure which cannot be drawn
 * SAYS SO — differently depending on whether the workspace is empty or the
 * query fell over.
 *
 * WHAT THIS FILE CANNOT PROVE, STATED PLAINLY. jsdom applies no stylesheet, has
 * no box model, has no ResizeObserver, and does not render SVG geometry. It
 * cannot establish that a chart is legible, that it is the right shape, that it
 * fits at 390px, or that it works in dark mode. Every one of those was measured
 * in a real browser at 1600x900 and 390x844 in both themes. What jsdom CAN
 * prove is the presence and the wording of the text — which is exactly where
 * the honesty rules live.
 */

const USER = "user-1";
const WORKSPACE = "workspace-1";

const TILES = [{ label: "Analysis runs", value: "3", detail: "3 completed" }];

function drawable(): InsightSeries {
  return series([
    { label: "Jun", value: 1, detail: "1 in Jun" },
    { label: "Jul", value: 4, detail: "4 in Jul" },
    { label: "Aug", value: 2, detail: "2 in Aug" },
  ]);
}

function seriesMap(
  overrides: Partial<Record<DashboardChartId, InsightSeries>> = {}
): Record<DashboardChartId, InsightSeries> {
  const base = {} as Record<DashboardChartId, InsightSeries>;
  for (const id of DASHBOARD_CHART_IDS) base[id] = drawable();
  return { ...base, ...overrides };
}

function renderView(overrides: Partial<Record<DashboardChartId, InsightSeries>> = {}) {
  return render(
    <DashboardInsights
      userId={USER}
      workspaceId={WORKSPACE}
      tiles={TILES}
      series={seriesMap(overrides)}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("choosing which figures appear", () => {
  it("shows every figure to somebody who has never chosen — never a blank slate", () => {
    renderView();
    for (const chart of DASHBOARD_CHARTS) {
      expect(screen.getByRole("heading", { name: chart.title })).toBeInTheDocument();
    }
  });

  it("draws only the figures a returning person kept", () => {
    window.localStorage.setItem(
      dashboardChartStorageKey(USER, WORKSPACE),
      "award-drawdown,open-work"
    );
    renderView();

    expect(
      screen.getByRole("heading", { name: "Money drawn against money awarded" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where the open work sits" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Analysis runs per month" })
    ).not.toBeInTheDocument();
  });

  it("remembers a figure being switched off, for this person and this workspace", () => {
    renderView();

    fireEvent.click(screen.getByTestId("dashboard-chart-picker-toggle"));
    fireEvent.click(screen.getByTestId("dashboard-chart-toggle-composite-scores"));

    expect(screen.queryByRole("heading", { name: "Composite score by run" })).not.toBeInTheDocument();
    const stored = window.localStorage.getItem(dashboardChartStorageKey(USER, WORKSPACE));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("composite-scores");
    expect(stored).toContain("runs-per-month");
    // Another person in the same workspace is unaffected.
    expect(window.localStorage.getItem(dashboardChartStorageKey("user-2", WORKSPACE))).toBeNull();
  });

  it("says the dashboard is empty on purpose when everything is switched off", () => {
    window.localStorage.setItem(dashboardChartStorageKey(USER, WORKSPACE), "");
    renderView();
    expect(screen.getByText(/No figures are switched on/i)).toBeInTheDocument();
  });
});

describe("a figure that cannot be drawn", () => {
  it("renders the reason instead of an axis, and marks a failed read as a warning", () => {
    renderView({
      "runs-per-month": blocked("The runs could not be read.", "unreadable"),
    });

    const note = screen.getByTestId("chart-blocked");
    expect(note).toHaveAttribute("data-blocked-kind", "unreadable");
    expect(note).toHaveTextContent("Could not be read");
    expect(note).toHaveTextContent("The runs could not be read.");
  });

  it("does not let an empty workspace and a failed query read the same", () => {
    renderView({
      "runs-per-month": blocked("Nothing has run yet.", "empty"),
      "comments-received": blocked("The comments could not be read.", "unreadable"),
    });

    const notes = screen.getAllByTestId("chart-blocked");
    const kinds = notes.map((note) => note.getAttribute("data-blocked-kind"));
    expect(kinds).toContain("empty");
    expect(kinds).toContain("unreadable");

    const leads = notes.map((note) => note.textContent ?? "");
    expect(leads.some((text) => text.startsWith("Nothing here yet"))).toBe(true);
    expect(leads.some((text) => text.startsWith("Could not be read"))).toBe(true);
  });

  it("offers no numbers table for a figure that has no numbers", () => {
    window.localStorage.setItem(dashboardChartStorageKey(USER, WORKSPACE), "runs-per-month");
    renderView({ "runs-per-month": blocked("Nothing has run yet.", "empty") });
    expect(screen.queryByRole("button", { name: "Numbers" })).not.toBeInTheDocument();
  });
});

describe("a figure a screen reader can read", () => {
  it("carries the same numbers in a text alternative as the plot draws", () => {
    window.localStorage.setItem(dashboardChartStorageKey(USER, WORKSPACE), "runs-per-month");
    renderView();

    const label = screen.getByRole("img", { name: /Analysis runs per month/i }).getAttribute("aria-label");
    expect(label).toContain("Jun: 1");
    expect(label).toContain("Jul: 4");
    expect(label).toContain("Aug: 2");
  });

  it("puts every value in a table when the reader asks for the numbers", () => {
    window.localStorage.setItem(dashboardChartStorageKey(USER, WORKSPACE), "runs-per-month");
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Numbers" }));

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Jun");
    expect(table).toHaveTextContent("4");
  });

  it("shows a series footnote so an incomplete figure carries its caveat", () => {
    window.localStorage.setItem(dashboardChartStorageKey(USER, WORKSPACE), "award-drawdown");
    renderView({
      "award-drawdown": series(
        [{ label: "STBG", value: 100, reference: 1000, detail: "$100 of $1,000" }],
        "2 awards record no amount and are left out."
      ),
    });

    expect(screen.getByText(/2 awards record no amount/i)).toBeInTheDocument();
  });
});
