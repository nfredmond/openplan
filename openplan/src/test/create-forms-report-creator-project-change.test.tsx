import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportCreator } from "@/components/reports/report-creator";
import { GuidedComparisonPicker } from "@/components/reports/guided-comparison-picker";
import { REPORT_TYPE_OPTIONS } from "@/lib/reports/catalog";

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
  it.each(REPORT_TYPE_OPTIONS)("renders the declared comparison field for $value", async ({ value }) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ options: [] }), { status: 200 }));
    render(<ReportCreator projects={PROJECTS} runs={[]} />);
    open(); next();
    fireEvent.change(sheet().getByLabelText("Report type"), { target: { value } });
    next();
    const picker = sheet().getByLabelText("Saved baseline and build comparison");
    expect(picker).toHaveAttribute("id", "report-creator-guidedSnapshotId");
    if (value === "analysis_summary") {
      expect(picker).toBeEnabled();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("projectId=project-a"), expect.anything()));
    } else {
      expect(picker).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("retains an identified disabled picker without a project and makes no discovery request", () => {
    render(<GuidedComparisonPicker projectId={null} value={null} onChange={vi.fn()}
      fieldProps={{ id: "report-creator-guidedSnapshotId", "aria-describedby": "comparison-help" }} />);
    const picker = screen.getByLabelText("Saved baseline and build comparison");
    expect(picker).toBeDisabled();
    expect(picker).toHaveAttribute("id", "report-creator-guidedSnapshotId");
    expect(picker).toHaveAttribute("aria-describedby", "comparison-help");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discloses that no project exists before offering a report flow", () => {
    render(<ReportCreator projects={[]} runs={[]} />);
    expect(screen.getByText("No projects available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new report$/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts fresh on project change, aborts the old request and ignores its late result", async () => {
    const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((resolve) => {
      pending.push({ resolve, signal: init.signal as AbortSignal });
    }));
    const props = { value: null, onChange: vi.fn(), fieldProps: { id: "comparison" } };
    const view = render(<GuidedComparisonPicker {...props} projectId="project-a" />);
    expect(pending).toHaveLength(1);
    view.rerender(<GuidedComparisonPicker {...props} projectId="project-b" />);
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Reading saved comparisons");
    await act(async () => pending[1].resolve(new Response(JSON.stringify({ options: [
      { id: "snapshot-b", projectId: "project-b", label: "Project B comparison" },
      { id: "foreign", projectId: "project-a", label: "Foreign comparison" },
    ] }))));
    expect(screen.getByRole("option", { name: /Project B comparison/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Foreign comparison/ })).not.toBeInTheDocument();
    await act(async () => pending[0].resolve(new Response(JSON.stringify({ options: [
      { id: "snapshot-a", projectId: "project-a", label: "Late project A comparison" },
    ] }))));
    expect(screen.queryByRole("option", { name: /Late project A/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Project B comparison/ })).toBeInTheDocument();
    view.rerender(<GuidedComparisonPicker {...props} projectId="project-a" />);
    expect(pending[1].signal.aborted).toBe(true);
    expect(pending).toHaveLength(3);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Project B comparison/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Late project A/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Saved baseline and build comparison")).toHaveAttribute("id", "comparison");
  });

  it("clears cached options on disable and rediscovers on reentry without accepting a late error", async () => {
    const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise<Response>((resolve) => {
      pending.push({ resolve, signal: init.signal as AbortSignal });
    }));
    const props = { projectId: "project-a", value: null, onChange: vi.fn(), fieldProps: { id: "comparison" } };
    const view = render(<GuidedComparisonPicker {...props} />);
    await act(async () => pending[0].resolve(new Response(JSON.stringify({ options: [
      { id: "old", projectId: "project-a", label: "Previously loaded comparison" },
    ] }))));
    expect(screen.getByRole("option", { name: /Previously loaded/ })).toBeInTheDocument();
    view.rerender(<GuidedComparisonPicker {...props} disabled />);
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending).toHaveLength(1);
    expect(screen.queryByRole("option", { name: /Previously loaded/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Saved baseline and build comparison")).toBeDisabled();
    view.rerender(<GuidedComparisonPicker {...props} />);
    expect(pending).toHaveLength(2);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Previously loaded/ })).not.toBeInTheDocument();
    view.rerender(<GuidedComparisonPicker {...props} disabled />);
    expect(pending[1].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve(new Response(JSON.stringify({ error: "Late disabled request failure" }), { status: 500 })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(pending).toHaveLength(2);
    expect(screen.getByLabelText("Saved baseline and build comparison")).toHaveAttribute("id", "comparison");
  });

  it("prunes an explicit comparison even when moving to another project in the same workspace", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { reportId: "report-x" }
      : { options: [{ id: "saved-snapshot", projectId: url.includes("project-b") ? "project-b" : "project-a", label: "Saved exact comparison" }] }), { status: init?.method === "POST" ? 201 : 200 }));
    render(<ReportCreator projects={PROJECTS.map((project) => ({ ...project, workspace_id: WS_A }))} runs={[]} />);
    open(); next();
    fireEvent.change(sheet().getByLabelText("Report type"), { target: { value: "analysis_summary" } });
    next();
    await waitFor(() => expect(sheet().getByRole("option", { name: /Saved exact comparison/ })).toBeInTheDocument());
    expect(sheet().getByLabelText("Saved baseline and build comparison")).toHaveValue("");
    fireEvent.change(sheet().getByLabelText("Saved baseline and build comparison"), { target: { value: "saved-snapshot" } });
    back(); back();
    fireEvent.change(sheet().getByLabelText(/^project$/i), { target: { value: "project-b" } });
    next(); next();
    expect(sheet().getByLabelText("Saved baseline and build comparison")).toHaveValue("");
    fireEvent.click(sheet().getByRole("button", { name: /create report/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => (call as [string, RequestInit])[1]?.method === "POST")).toBe(true));
    const posted = fetchMock.mock.calls.find((call) => (call as [string, RequestInit])[1]?.method === "POST") as [string, RequestInit];
    expect(JSON.parse(String(posted[1].body))).toMatchObject({ projectId: "project-b", reportType: "analysis_summary" });
    expect(JSON.parse(String(posted[1].body)).guidedComparisonSelectionV1).toBeUndefined();
  });
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
