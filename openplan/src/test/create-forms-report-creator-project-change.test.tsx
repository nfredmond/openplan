import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportCreator } from "@/components/reports/report-creator";

/**
 * CHANGING THE PROJECT CHANGES THE WORKSPACE, AND EVIDENCE DOES NOT CROSS ONE.
 *
 * FOUND BY MUTATION. When `report-creator.tsx` became a guided flow, the
 * pruning that used to live in a `useEffect` on the derived workspace id moved
 * into the project select's `onChange`. Replacing the county-run re-pick with a
 * blank string changed NOTHING in the existing suite: every case there renders
 * a single project, so the project never moves and the pruning never runs.
 *
 * What that would have shipped: a planner starts a report for a project in one
 * workspace, changes their mind and picks a project in another, and the packet
 * goes out citing a county run and a set of analysis runs belonging to the
 * workspace they left. The server refuses some of that — but a report citing
 * evidence from the wrong agency is exactly the confident-wrong-answer this
 * codebase refuses to ship, and "the API will catch it" is not a defence when
 * the planner has already been shown the wrong run on an approval screen.
 *
 * So this drives the project actually moving. Two projects, two workspaces, and
 * an assertion on both halves: the county-run default follows the workspace,
 * and analysis runs selected for the old one are dropped rather than sent.
 *
 * WHAT IT CANNOT PROVE: anything visual. jsdom applies no stylesheet and has no
 * box model — that the sheet is on screen, full-height on a phone, that focus
 * moved, or that the page behind is inert are browser measurements, not
 * assertions here.
 */

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PROJECTS = [
  { id: "project-a", workspace_id: WS_A, name: "Riverside Corridor" },
  { id: "project-b", workspace_id: WS_B, name: "Hilltown Safety Plan" },
];

const RUNS = [
  { id: "run-a", workspace_id: WS_A, title: "Riverside base year", created_at: "2026-04-01T00:00:00.000Z" },
  { id: "run-b", workspace_id: WS_B, title: "Hilltown base year", created_at: "2026-04-02T00:00:00.000Z" },
];

const COUNTY_RUNS = [
  {
    id: "county-a",
    workspace_id: WS_A,
    runName: "Riverside assignment",
    geographyLabel: "Riverside County, CA",
    stage: "validated-screening",
    updatedAt: "2026-04-01T00:00:00.000Z",
    claimStatus: "screening_grade" as const,
    statusReason: "Screening grade.",
    validationSummary: null,
    decidedAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: "county-b",
    workspace_id: WS_B,
    runName: "Hilltown assignment",
    geographyLabel: "Hilltown County, CA",
    stage: "validated-screening",
    updatedAt: "2026-04-02T00:00:00.000Z",
    claimStatus: "claim_grade_passed" as const,
    statusReason: "All checks passed.",
    validationSummary: null,
    decidedAt: "2026-04-02T00:00:00.000Z",
  },
];

const fetchMock = vi.fn();

function sheet() {
  return within(screen.getByTestId("guided-flow-report-creator"));
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: /^new report$/i }));
}

function next() {
  fireEvent.click(sheet().getByRole("button", { name: /^next$/i }));
}

function back() {
  fireEvent.click(sheet().getByRole("button", { name: /^back$/i }));
}

describe("ReportCreator: moving the project moves the workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ reportId: "report-x" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-picks the county-run default for the workspace the new project belongs to", () => {
    render(<ReportCreator projects={PROJECTS} runs={RUNS} modelingCountyRuns={COUNTY_RUNS} />);
    open();

    // It starts on the first project's workspace.
    next();
    next();
    expect(sheet().getByLabelText("Modeling evidence")).toHaveValue("county-a");

    back();
    back();
    fireEvent.change(sheet().getByLabelText(/^project$/i), { target: { value: "project-b" } });
    next();
    next();

    expect(sheet().getByLabelText("Modeling evidence")).toHaveValue("county-b");
    // And the other workspace's run is not even offered.
    expect(sheet().queryByRole("option", { name: /Riverside assignment/ })).not.toBeInTheDocument();
  });

  it("drops analysis runs chosen for the workspace the planner left", async () => {
    render(<ReportCreator projects={PROJECTS} runs={RUNS} modelingCountyRuns={COUNTY_RUNS} />);
    open();
    next();
    next();

    fireEvent.click(sheet().getByText("Riverside base year"));
    expect(sheet().getByText("1 selected")).toBeInTheDocument();

    back();
    back();
    fireEvent.change(sheet().getByLabelText(/^project$/i), { target: { value: "project-b" } });
    next();
    next();

    expect(sheet().getByText("0 selected")).toBeInTheDocument();
    fireEvent.click(sheet().getByRole("button", { name: /create report/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as {
      projectId: string;
      runIds: string[];
      modelingCountyRunId?: string;
    };
    expect(body.projectId).toBe("project-b");
    expect(body.runIds).toEqual([]);
    expect(body.modelingCountyRunId).toBe("county-b");
  });
});
