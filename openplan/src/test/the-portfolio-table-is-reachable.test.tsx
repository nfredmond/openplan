import type { ComponentPropsWithoutRef } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PORTFOLIO TABLE AND THE WORK-PLAN APPLIER, ON THE REAL /projects PAGE.
 *
 * This repository's most expensive recurring defect is a capability that is
 * complete, tested, gated and reviewed — and that no person can reach, because
 * the suite tested the unit and not the path to the unit. The library tests
 * beside this one prove the loader and the shaping; this one renders the actual
 * page and asserts a planner sees the table, sees the reason behind a "—", and
 * has a control that posts to the apply route.
 *
 * NOTHING BELOW STUBS THE LOADER OR THE SHAPING. The Supabase client is faked at
 * the transport (a chainable stub answering rows per table), so
 * `loadProjectPortfolioInputs`, `buildProjectPortfolioSummary`,
 * `ProjectPortfolioTable` and `WorkPlanTemplateApplier` all run for real. A test
 * that doubled the loader would prove the renderer and leave the wiring — the
 * part that keeps breaking — unexercised.
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after; see the report.
 */

const WORKSPACE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "22222222-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

let tables: Record<string, Row[]> = {};
let tableErrors: Record<string, string> = {};

/**
 * One chainable stub for every read the page makes — its own four and the
 * portfolio loader's six. It answers rows BY TABLE and does not evaluate
 * filters, which is exactly the limit this test accepts: the filter semantics
 * are proven in `project-portfolio.test.ts` against a fake that does apply
 * them. Here the question is whether the page calls the loader at all and
 * renders what comes back.
 */
function createClientStub() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "44444444-0000-4000-8000-000000000004" } } }),
    },
    from(table: string) {
      const result = tableErrors[table]
        ? { data: null, error: { message: tableErrors[table] } }
        : { data: tables[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        then: <T,>(resolve: (value: typeof result) => T) => Promise.resolve(resolve(result)),
      };
      for (const method of ["select", "eq", "in", "order", "limit", "not", "neq"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => result;
      builder.single = async () => result;
      return builder;
    },
  };
}

const createClientMock = vi.fn(async () => createClientStub());

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
  createServiceRoleClient: () => ({ serviceRole: true }),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    workspace: { id: WORKSPACE_ID, name: "Regional Agency" },
  }),
}));

vi.mock("@/lib/aerial/queries", () => ({
  loadAerialPostureInputsForProjects: async () => ({ missions: [], packages: [] }),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import ProjectsPage from "@/app/(app)/projects/page";

function project(id: string, name: string, overrides: Row = {}): Row {
  return {
    id,
    workspace_id: WORKSPACE_ID,
    name,
    summary: null,
    status: "active",
    plan_type: "corridor_plan",
    delivery_phase: "delivery",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    budget_amount: null,
    workspaces: { name: "Regional Agency", created_at: "2026-01-01T00:00:00Z" },
    ...overrides,
  };
}

async function renderPage() {
  render(await ProjectsPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  tableErrors = {};
  tables = {
    projects: [
      project(P1, "Corridor Rehabilitation", { budget_amount: "100000.00" }),
      project(P2, "Bridge Condition Study"),
    ],
    reports: [],
    report_artifacts: [],
    project_rtp_cycle_links: [],
    project_deliverables: [
      {
        id: "d1",
        project_id: P1,
        title: "Existing conditions memo",
        status: "in_progress",
        due_date: "2026-08-01",
        budget_amount: "40000.00",
        percent_complete: 50,
      },
      {
        id: "d3",
        project_id: P2,
        title: "Field review notes",
        status: "in_progress",
        due_date: "2026-08-25",
        budget_amount: null,
        percent_complete: null,
      },
    ],
    project_milestones: [],
    project_submittals: [],
    project_spend_entries: [
      { project_id: P1, deliverable_id: "d1", amount: "25000.00" },
    ],
    client_invoices: [],
  };
});

describe("a planner reaches the portfolio table on /projects", () => {
  it("renders the table above the cards, with each project's next deadline", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: /what each project needs next/i })).toBeTruthy();
    // The table's own row for P1 shows the record that is due, not a count.
    expect(screen.getAllByText("Existing conditions memo").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 overdue/).length).toBeGreaterThan(0);

    // ABOVE the cards: the table's heading precedes the card list's heading in
    // document order. This is the whole placement decision, so it is asserted
    // rather than assumed.
    const table = screen.getByRole("heading", { name: /what each project needs next/i });
    const cards = screen.getByRole("heading", { name: /^Project records$/i });
    expect(table.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the burn percentage where a budget supports one", async () => {
    await renderPage();
    // $25,000 direct spend against a $100,000 stated project budget.
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText(/of the project budget/)).toBeTruthy();
  });

  it("shows “—” WITH ITS REASON where the budget basis is incomplete", async () => {
    await renderPage();
    // P2 has one deliverable carrying no budget and no project budget.
    expect(screen.getByText(/nothing to measure spending against/i)).toBeTruthy();
  });

  it("says a lane could not be read instead of rendering zeros over it", async () => {
    tableErrors.project_submittals = "permission denied for table project_submittals";
    await renderPage();
    // The table is still on screen — a failed lane must not remove it — and it
    // shows no overdue chip, because "0 overdue" over an unreadable lane is the
    // false sentence this whole design exists to refuse.
    expect(screen.getByRole("heading", { name: /what each project needs next/i })).toBeTruthy();
    expect(screen.getByText(/could not read/i)).toBeTruthy();
    expect(screen.getByText(/project submittals/i)).toBeTruthy();
    expect(screen.queryByText(/1 overdue/)).toBeNull();
    // And the cell says WHY, in the row's own title attribute.
    expect(
      document.querySelector('[title*="could not be read"]')?.textContent?.trim()
    ).toBe("—");
  });
});

describe("a planner reaches the work-plan applier on /projects", () => {
  it("renders the picker, the anchor-date field and the shipped template's scope notes", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: /start a project from a work-plan template/i })).toBeTruthy();
    expect(screen.getByText(/Generic planning project/)).toBeTruthy();
    // The button is disabled until a project, a template and a date are chosen:
    // no anchor date is pre-filled, deliberately.
    const button = screen.getByRole("button", { name: /apply work plan/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Choose a project, a template and the date its schedule starts from/i)).toBeTruthy();
  });

  it("offers every project in the list to apply a plan to", async () => {
    await renderPage();
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toContain("Corridor Rehabilitation");
    expect(options).toContain("Bridge Condition Study");
  });
});
