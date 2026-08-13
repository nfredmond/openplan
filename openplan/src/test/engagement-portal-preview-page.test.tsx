import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The operator preview at /engagement/{id}/preview renders the REAL resident
 * portal for a campaign in ANY state — and it runs on the service-role client,
 * so THE `.eq()` FILTERS ARE THE ENTIRE ACCESS CONTROL. RLS enforces nothing
 * on this page. The fake below therefore APPLIES its filters to the fixture
 * rows (a fake that answers regardless of filters would stay green with the
 * membership check deleted), and the filters are ALSO recorded and asserted
 * directly — the convention the public plan page tests established.
 *
 * Verified by mutation:
 *   - deleting the membership gate from `loadPortalPreviewResult` fails the
 *     non-member test;
 *   - dropping the `previewMode` prop from the page's render site fails the
 *     submissions-disabled test;
 *   - filtering the campaign read on `status = 'active'` fails the draft test.
 */

const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (target: string) => redirectMock(target),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

// ---------------------------------------------------------------------------
// A recording fake that APPLIES its filters — see the header.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type RecordedRead = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
};

const readLog: RecordedRead[] = [];
let tableRows: Record<string, Row[]>;
let tableErrors: Record<string, { message: string }>;

function fakeQuery(record: RecordedRead) {
  const resolveRows = (): { data: Row[] | null; error: { message: string } | null } => {
    const error = tableErrors[record.table];
    if (error) return { data: null, error };
    const rows = (tableRows[record.table] ?? []).filter((row) =>
      record.filters.every((filter) => row[filter.column] === filter.value)
    );
    return { data: rows, error: null };
  };

  const q: {
    eq: (column: string, value: unknown) => typeof q;
    in: (column: string, values: unknown) => typeof q;
    order: () => typeof q;
    limit: () => typeof q;
    maybeSingle: () => Promise<{ data: Row | null; error: { message: string } | null }>;
    then: (
      resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown
    ) => Promise<unknown>;
  } = {
    eq: (column, value) => {
      record.filters.push({ column, value });
      return q;
    },
    in: (column, values) => {
      record.filters.push({ column, value: values });
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => {
      const { data, error } = resolveRows();
      return { data: data?.[0] ?? null, error };
    },
    then: (resolve) => Promise.resolve(resolveRows()).then(resolve),
  };
  return q;
}

const fromMock = vi.fn((table: string) => ({
  select: vi.fn((columns: string) => {
    const record: RecordedRead = { table, columns, filters: [] };
    readLog.push(record);
    return fakeQuery(record);
  }),
}));

let signedInUserId: string | null = "99999999-9999-4999-8999-999999999999";

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: signedInUserId ? { id: signedInUserId } : null },
      }),
    },
  }),
}));

import EngagementPortalPreviewPage from "@/app/(app)/engagement/[campaignId]/preview/page";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "99999999-9999-4999-8999-999999999999";

function campaignRow(overrides: Row = {}): Row {
  return {
    id: CAMPAIGN_ID,
    workspace_id: WORKSPACE_ID,
    project_id: null,
    title: "Draft Corridor Conversation",
    summary: null,
    public_description: "What should the corridor become?",
    status: "draft",
    engagement_type: "map_feedback",
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
    updated_at: "2026-08-01T00:00:00.000Z",
    accessibility_contact_label: null,
    accessibility_contact_email: null,
    accessibility_contact_phone: null,
    accessibility_alternate_formats: null,
    share_token: null,
    submission_geofence_enabled: false,
    default_content_locale: "en",
    ...overrides,
  };
}

function readsOf(table: string): RecordedRead[] {
  return readLog.filter((read) => read.table === table);
}

function filterValue(read: RecordedRead | undefined, column: string): unknown {
  return read?.filters.find((filter) => filter.column === column)?.value;
}

async function renderPreview(campaignId: string = CAMPAIGN_ID) {
  return render(
    await EngagementPortalPreviewPage({ params: Promise.resolve({ campaignId }) })
  );
}

beforeEach(() => {
  readLog.length = 0;
  fromMock.mockClear();
  notFoundMock.mockClear();
  redirectMock.mockClear();
  signedInUserId = USER_ID;
  tableErrors = {};
  tableRows = {
    engagement_campaigns: [campaignRow()],
    workspace_members: [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "member" }],
    workspaces: [],
    projects: [],
    engagement_categories: [],
    engagement_items: [],
    engagement_survey_questions: [],
    engagement_survey_question_options: [],
    engagement_closeloop_entries: [],
    engagement_content_translations: [],
    engagement_context_layers: [],
  };
});

describe("the operator portal preview — who may see it", () => {
  it("sends a signed-out visitor to sign in before reading anything", async () => {
    signedInUserId = null;

    await expect(renderPreview()).rejects.toThrow("redirect:/sign-in");
    expect(readsOf("engagement_campaigns")).toHaveLength(0);
  });

  it("shows a signed-in NON-member the same 404 a wrong id gets — and the membership read is scoped to both the workspace and the user", async () => {
    tableRows.workspace_members = [
      // A member of a DIFFERENT workspace: the row exists, the scope must
      // exclude it. This is the binding the filters have to carry.
      { workspace_id: "33333333-3333-4333-8333-333333333333", user_id: USER_ID, role: "owner" },
    ];

    await expect(renderPreview()).rejects.toThrow("notFound");

    const membershipRead = readsOf("workspace_members")[0];
    expect(membershipRead).toBeDefined();
    expect(filterValue(membershipRead, "workspace_id")).toBe(WORKSPACE_ID);
    expect(filterValue(membershipRead, "user_id")).toBe(USER_ID);
  });

  it("refuses a member whose role does not carry engagement.read", async () => {
    tableRows.workspace_members = [
      { workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "not-a-role" },
    ];

    await expect(renderPreview()).rejects.toThrow("notFound");
  });

  it("reports a failed campaign read as a failure, never as the campaign not existing", async () => {
    tableErrors.engagement_campaigns = { message: "relation is on fire" };

    await renderPreview();

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("This preview could not be loaded")).toBeInTheDocument();
    expect(screen.getByText(/not the same as the campaign not existing/)).toBeInTheDocument();
  });
});

describe("the operator portal preview — what a member sees", () => {
  it("renders a DRAFT campaign: the campaign read is scoped by id and deliberately carries no status filter", async () => {
    await renderPreview();

    // The banner tells the truth about a draft: residents cannot see it.
    expect(screen.getByText(/Preview — residents cannot see this yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Draft Corridor Conversation" })
    ).toBeInTheDocument();

    const campaignRead = readsOf("engagement_campaigns")[0];
    expect(filterValue(campaignRead, "id")).toBe(CAMPAIGN_ID);
    // ANY state is previewable — a status filter here would 404 the drafts
    // this page exists for.
    expect(filterValue(campaignRead, "status")).toBeUndefined();
  });

  it("tells the truth about a LIVE campaign instead of claiming residents cannot see it", async () => {
    tableRows.engagement_campaigns = [
      campaignRow({ status: "active", share_token: "a".repeat(28) }),
    ];

    await renderPreview();

    expect(
      screen.getByText(/residents can already see this page at its public link/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/residents cannot see this yet/)).not.toBeInTheDocument();
  });

  it("renders the surface RESIDENTS get, not a second page only operators see", async () => {
    await renderPreview();

    /*
      `portal-shell-map-first` and `portal-shell-no-map` are the two branches of
      `PublicMapShell` — the component the public route renders. Either one
      proves the preview mounted the resident surface itself. Which branch
      appears depends only on whether this environment has a map key, and that
      is not what this test is about; asserting one of them specifically would
      make this test fail on a machine with a token rather than on a regression.

      The no-map branch is what a test run with no NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
      gets, and it is a real resident state, not a preview-only fallback.
    */
    const surface = screen.getByTestId("portal-preview-surface");
    const shell =
      surface.querySelector('[data-testid="portal-shell-map-first"]') ??
      surface.querySelector('[data-testid="portal-shell-no-map"]');
    expect(shell).not.toBeNull();
  });

  it("keeps every submission control inert: the send button never leaves preview mode", async () => {
    await renderPreview();

    /*
      The rail asks one thing at a time and REFUSES to move past the comment
      step while nothing is written, so the walk has to write something — a
      loop that only clicks Next never arrives, which is a guard doing its job
      rather than a bug.
    */
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "An operator reading their own consultation." },
    });
    while (!screen.queryByTestId("portal-step-send")) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }

    const sendButton = screen.getByRole("button", { name: /Send what I wrote/ });
    expect(sendButton).toBeDisabled();
  });
});
