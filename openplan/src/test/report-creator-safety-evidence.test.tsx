/**
 * KI-2026-08-31-015: report creation can reach a project's Safety evidence.
 *
 * The new-report flow offers the chosen project's ready crash acquisitions and
 * carries the choice to the report's own evidence control, which saves it. A
 * project with none says so and links to Safety for that project.
 *
 * Blind category: jsdom renders the flow but not the report page it pushes to,
 * so that the report control preselects the id is proved by the report detail
 * control's own tests, not here.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ReportCreator } from "@/components/reports/report-creator";

const PROJECTS = [
  { id: "project-1", workspace_id: "workspace-1", name: "Rural Roads Safety Plan" },
  { id: "project-2", workspace_id: "workspace-1", name: "Tribal Route Study" },
];

const OPTIONS = {
  "project-1": [
    { id: "ingest-1", sourceLabel: "Statewide crash file", createdAt: "2026-10-20T00:00:00Z", crashCount: 40, geocodedCount: 38 },
  ],
};

function openToEvidence() {
  fireEvent.click(screen.getByRole("button", { name: /^new report$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
}

function created(reportId: string) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ reportId }), { status: 201, headers: { "content-type": "application/json" } })
  );
}

describe("ReportCreator Safety evidence", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers the project's crash acquisitions and opens the report with the chosen one", async () => {
    const fetchMock = created("report-9");
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportCreator projects={PROJECTS} runs={[]} safetyIngestOptionsByProject={OPTIONS} />);
    openToEvidence();

    const select = screen.getByLabelText("Crash evidence");
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: /Statewide crash file · 40 reported/ })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "ingest-1" } });
    fireEvent.click(screen.getByRole("button", { name: /create report/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(
      "/reports/report-9?safetyIngestId=ingest-1&projectId=project-1#report-controls"
    );
    // The create request is unchanged: the report's own control saves the choice.
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("safetyIngestId");
    expect(body.projectId).toBe("project-1");
  });

  it("opens the report without crash evidence when none is chosen", async () => {
    vi.stubGlobal("fetch", created("report-10"));
    render(<ReportCreator projects={PROJECTS} runs={[]} safetyIngestOptionsByProject={OPTIONS} />);
    openToEvidence();
    fireEvent.click(screen.getByRole("button", { name: /create report/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/reports/report-10?projectId=project-1"));
  });

  it("says a project has no crash data and links to Safety for that project", () => {
    render(
      <ReportCreator
        projects={PROJECTS}
        runs={[]}
        initialProjectId="project-2"
        safetyIngestOptionsByProject={OPTIONS}
      />
    );
    openToEvidence();

    expect(screen.queryByLabelText("Crash evidence")).toBeNull();
    expect(screen.getByTestId("report-creator-safety-evidence")).toHaveTextContent(
      "No crash data is attached to this project."
    );
    expect(screen.getByRole("link", { name: "Retrieve it in Safety" })).toHaveAttribute(
      "href",
      "/safety?projectId=project-2"
    );
  });

  it("drops a chosen acquisition when the project changes", async () => {
    vi.stubGlobal("fetch", created("report-11"));
    render(
      <ReportCreator
        projects={PROJECTS}
        runs={[]}
        safetyIngestOptionsByProject={{
          ...OPTIONS,
          "project-2": [
            { id: "ingest-2", sourceLabel: "Tribal crash file", createdAt: "2026-10-21T00:00:00Z", crashCount: 5, geocodedCount: 5 },
          ],
        }}
      />
    );
    openToEvidence();
    fireEvent.change(screen.getByLabelText("Crash evidence"), { target: { value: "ingest-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "project-2" } });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    expect(screen.getByLabelText("Crash evidence")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /create report/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/reports/report-11?projectId=project-2"));
  });
});
