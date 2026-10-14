import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE WORK PROGRAM PAGE OPENS ON THE JOB IN FRONT OF THE PLANNER.
 *
 * Until a version is adopted the job is preparing it, so preparation comes
 * first. The reporting panel used to come first on every work program, and on
 * a new one it opened by telling the planner to save a preparation revision
 * "below". After adoption, reporting is the regular work and comes first.
 *
 * The two panels are doubled: this file proves the order and the adoption read
 * that decides it, not what either panel draws.
 */

const workflowMaybeSingleMock = vi.fn();
const workflowEqMock = vi.fn(() => ({ maybeSingle: workflowMaybeSingleMock }));
const workflowSelectMock = vi.fn(() => ({ eq: workflowEqMock }));

const emptyPage = { data: [], error: null };
const pagedRead = () => ({
  select: () => ({ eq: () => ({ order: () => ({ range: () => Promise.resolve(emptyPage) }) }) }),
});
const orderedRead = () => ({
  select: () => ({ eq: () => ({ order: () => Promise.resolve(emptyPage) }) }),
});

let workspaceCalendarRow: { time_zone: string | null; home_country_code: string | null } | null = null;
const calendarEqMock = vi.fn(() => ({ maybeSingle: async () => ({ data: workspaceCalendarRow, error: null }) }));

const fromMock = vi.fn((table: string) => {
  if (table === "program_work_program_workflow") return { select: workflowSelectMock };
  if (table === "workspaces") return { select: () => ({ eq: calendarEqMock }) };
  if (table === "kb_documents" || table === "projects") return pagedRead();
  if (table === "invoicing_staff" || table === "invoicing_engagements") return orderedRead();
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: fromMock,
  }),
}));

vi.mock("@/lib/programs/api", () => ({
  loadProgramAccess: async () => ({
    error: null,
    allowed: true,
    membership: { role: "owner" },
    program: { id: "program-1", workspace_id: "workspace-1", title: "FY 2026-27 work program", sponsor_agency: "Regional agency" },
  }),
}));

vi.mock("@/lib/programs/work-program/server", () => ({
  loadWorkProgramPreparation: async () => ({ sources: [], latest: null, revisions: [] }),
}));

vi.mock("@/components/programs/work-program/reporting-panel", () => ({
  // The zone is exposed so the page's calendar wiring can be checked.
  ReportingPanel: ({ timeZone }: { timeZone?: string }) => (
    <div data-testid="reporting-panel" data-time-zone={timeZone ?? ""} />
  ),
}));

vi.mock("@/components/programs/work-program/editor", () => ({
  WorkProgramEditor: () => <div data-testid="preparation-editor" />,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import WorkProgramPage from "@/app/(app)/programs/[programId]/work-program/page";

async function renderPage() {
  render(await WorkProgramPage({ params: Promise.resolve({ programId: "program-1" }) }));
}

/** True when `first` comes before `second` in document order. */
function precedes(first: HTMLElement, second: HTMLElement) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function sectionHeadings() {
  return {
    preparation: screen.getByRole("heading", { name: "Preparation and adoption history" }),
    reporting: screen.getByRole("heading", { name: "Reporting" }),
  };
}

describe("work program page order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceCalendarRow = null;
  });

  it("dates new reporting entries on the workspace calendar", async () => {
    workflowMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    for (const zone of ["Pacific/Honolulu", "Asia/Tokyo"]) {
      workspaceCalendarRow = { time_zone: zone, home_country_code: null };
      await renderPage();
      expect(screen.getByTestId("reporting-panel")).toHaveAttribute("data-time-zone", zone);
      cleanup();
    }
    expect(calendarEqMock).toHaveBeenCalledWith("id", "workspace-1");
    workspaceCalendarRow = null;
    await renderPage();
    expect(screen.getByTestId("reporting-panel")).toHaveAttribute("data-time-zone", "UTC");
  });

  it("shows preparation before reporting while nothing is adopted", async () => {
    workflowMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    await renderPage();

    const { preparation, reporting } = sectionHeadings();
    expect(precedes(preparation, reporting)).toBe(true);
    expect(precedes(screen.getByTestId("preparation-editor"), screen.getByTestId("reporting-panel"))).toBe(true);
    // The read that decides it: this program's adopted version, nothing else.
    expect(workflowSelectMock).toHaveBeenCalledWith("effective_revision_id");
    expect(workflowEqMock).toHaveBeenCalledWith("program_id", "program-1");
  });

  it("keeps preparation first when review has started but nothing is adopted", async () => {
    workflowMaybeSingleMock.mockResolvedValue({ data: { effective_revision_id: null }, error: null });

    await renderPage();

    const { preparation, reporting } = sectionHeadings();
    expect(precedes(preparation, reporting)).toBe(true);
  });

  it("shows reporting first once a version is adopted", async () => {
    workflowMaybeSingleMock.mockResolvedValue({ data: { effective_revision_id: "revision-3" }, error: null });

    await renderPage();

    const { preparation, reporting } = sectionHeadings();
    expect(precedes(reporting, preparation)).toBe(true);
    expect(precedes(screen.getByTestId("reporting-panel"), screen.getByTestId("preparation-editor"))).toBe(true);
  });

  it("falls back to preparation first, and still opens, when the adoption read fails", async () => {
    workflowMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await renderPage();

    const { preparation, reporting } = sectionHeadings();
    expect(precedes(preparation, reporting)).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says what the page is for in plain words", async () => {
    workflowMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    await renderPage();

    expect(screen.getByText("Prepare this year's work program from last year's adopted copy.")).toBeInTheDocument();
    expect(screen.queryByText(/retained sources/)).not.toBeInTheDocument();
  });
});
