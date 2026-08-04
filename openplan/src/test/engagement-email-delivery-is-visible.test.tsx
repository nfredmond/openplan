/**
 * SHIPPED-INVISIBLE: the email outbox had status rows nothing displayed, and the
 * close-the-loop broadcast count was computed and thrown away.
 *
 * Since 2026-07-22 every message OpenPlan queued for a campaign has been recorded
 * in `engagement_email_outbox` with a real status (queued / sent / skipped /
 * failed), and `enqueueCampaignSubscriberEmails` has known exactly how many
 * subscribers a "You said / We did" publish reached. Neither fact was reachable
 * by any human: no page, component or API response carried it. An operator who
 * published an update could not tell 0 subscribers from 400 subscribers whose
 * mail was recorded and never sent, because at $0 the transport no-ops.
 *
 * WHY THIS TEST IS BUILT, NOT DESCRIBED. Nothing here is a hand-written fixture
 * of what the product "would" produce. A single in-memory database is written by
 * the REAL notifications lib, read back by the REAL summary loader, served by the
 * REAL route handlers, and the routes' OWN JSON bodies are handed to the REAL
 * components. A fixture would prove the assertion; this proves the path.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── An in-memory stand-in for PostgREST, shared by every layer below ──────────

type Row = Record<string, unknown>;

class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Every projection string a `.select()` asked for, per table. */
  projections: { table: string; columns: string }[] = [];
  /** Tables whose reads should answer with a database error. */
  failReads = new Set<string>();
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
}

type Filter = { column: string; value: unknown };

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private columns = "*";
  private returning = false;
  private limitN: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
    private op: "select" | "insert" | "update" | "delete",
    private payload: Row | Row[] | null = null
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): this {
    this.limitN = count;
    return this;
  }

  select(columns: string): this {
    this.columns = columns;
    this.returning = true;
    // Only a genuine read is a projection; `insert().select("id")` is not the
    // query whose columns a panel renders.
    if (this.op === "select") this.db.projections.push({ table: this.table, columns });
    return this;
  }

  single() {
    return this.run(true);
  }

  maybeSingle() {
    return this.run(true);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.run(false).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => (row[filter.column] ?? null) === (filter.value ?? null));
  }

  private async run(single: boolean): Promise<{ data: unknown; error: { message: string } | null }> {
    if (this.db.failReads.has(this.table) && this.op === "select") {
      return { data: null, error: { message: `permission denied for table ${this.table}` } };
    }

    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const inserted = incoming.map((row) => ({
        id: this.db.nextId(this.table),
        created_at: new Date().toISOString(),
        ...row,
      }));
      this.db.rows(this.table).push(...inserted);
      const data = this.returning ? (single ? inserted[0] : inserted) : null;
      return { data, error: null };
    }

    if (this.op === "update") {
      const hit = this.db.rows(this.table).filter((row) => this.matches(row));
      for (const row of hit) Object.assign(row, this.payload as Row);
      const data = this.returning ? (single ? hit[0] ?? null : hit) : null;
      return { data, error: null };
    }

    if (this.op === "delete") {
      this.db.tables[this.table] = this.db.rows(this.table).filter((row) => !this.matches(row));
      return { data: null, error: null };
    }

    let rows = this.db.rows(this.table).filter((row) => this.matches(row));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return { data: single ? rows[0] ?? null : rows, error: null };
  }
}

function fakeClient(db: FakeDb) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: (columns: string) => new FakeQuery(db, table, "select").select(columns),
      insert: (payload: Row | Row[]) => new FakeQuery(db, table, "insert", payload),
      update: (payload: Row) => new FakeQuery(db, table, "update", payload),
      delete: () => new FakeQuery(db, table, "delete"),
    }),
  };
}

// ── Module wiring: only the seams outside this feature are doubled ────────────

const db = new FakeDb();
const serviceClientFactory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeClient(dbRef.current)),
  createServiceRoleClient: serviceClientFactory,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const CAMPAIGN = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  title: "Corridor study",
  share_token: "share-token-abc",
};

const campaignAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: campaignAccess,
  validateCampaignCategoryAccess: vi.fn(async () => ({ error: null, category: { id: "cat" } })),
}));

// A mutable handle so each test can install a fresh database without re-mocking.
const dbRef = vi.hoisted(() => ({ current: null as unknown as { rows: (t: string) => Row[] } })) as {
  current: FakeDb;
};
dbRef.current = db;

// The modules under test are imported AFTER the mocks above are declared.
import { PATCH as closeLoopPatch } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/[entryId]/route";
import { GET as notificationsGet } from "@/app/api/engagement/campaigns/[campaignId]/notifications/route";
import { EngagementCloseLoopBuilder } from "@/components/engagement/close-loop-builder";
import { EngagementNotificationsInbox } from "@/components/engagement/notifications-inbox";
import { EMAIL_OUTBOX_SUMMARY_COLUMNS, loadCampaignEmailDeliverySummary } from "@/lib/notifications/engagement";
import type { CloseLoopEntryRow } from "@/lib/engagement/close-loop";

const ENTRY_ID = "33333333-3333-4333-8333-333333333333";

/**
 * The row as it stands BEFORE the publish, captured at seed time — the component
 * has to be handed the draft it would really be showing, and `publishTheEntry`
 * mutates the shared row in place exactly as the route does.
 */
let draftSnapshot: Row;

function seedDatabase(options: { subscribers: number }): FakeDb {
  const fresh = new FakeDb();
  fresh.rows("engagement_closeloop_entries").push({
    id: ENTRY_ID,
    campaign_id: CAMPAIGN.id,
    category_id: null,
    theme_title: "Safer crossings",
    you_said: "Add a crosswalk at Fifth.",
    we_did: "Funded a crossing in the next cycle.",
    status: "draft",
    ai_assisted: false,
    source_item_ids: [],
    sort_order: 0,
    published_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  });
  for (let index = 0; index < options.subscribers; index += 1) {
    fresh.rows("engagement_subscriptions").push({
      id: `sub-${index}`,
      campaign_id: CAMPAIGN.id,
      email: `resident${index}@example.org`,
      unsubscribe_token: `tok-${index}`,
      confirmed: true,
      unsubscribed_at: null,
    });
  }
  draftSnapshot = JSON.parse(JSON.stringify(fresh.rows("engagement_closeloop_entries")[0])) as Row;
  return fresh;
}

async function publishTheEntry(): Promise<Record<string, unknown>> {
  const request = new NextRequest("https://agency.example/api/engagement/campaigns/x/closeloop/y", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "published" }),
  });
  const response = await closeLoopPatch(request, {
    params: Promise.resolve({ campaignId: CAMPAIGN.id, entryId: ENTRY_ID }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function readNotifications(): Promise<Record<string, unknown>> {
  const request = new NextRequest("https://agency.example/api/engagement/campaigns/x/notifications");
  const response = await notificationsGet(request, { params: Promise.resolve({ campaignId: CAMPAIGN.id }) });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** Hand a route's OWN body to the component, so no fixture stands between them. */
function respondWith(body: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => body } as unknown as Response);
}

function draftEntry(): CloseLoopEntryRow {
  return JSON.parse(JSON.stringify(draftSnapshot)) as CloseLoopEntryRow;
}

describe("the email outbox and the close-the-loop broadcast are reachable by a person", () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY; // the $0 default: recorded, never delivered
    dbRef.current = seedDatabase({ subscribers: 3 });
    serviceClientFactory.mockImplementation(() => fakeClient(dbRef.current));
    campaignAccess.mockResolvedValue({ error: null, allowed: true, campaign: { ...CAMPAIGN } });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("a publish tells the operator how many subscribers it reached and that nothing was delivered", async () => {
    // The route runs the REAL enqueueCampaignSubscriberEmails against the REAL
    // outbox writer; the counts below are whatever that produced, not a fixture.
    const body = await publishTheEntry();

    expect(body.broadcastOutcome).toBe("attempted");
    expect(body.broadcast).toEqual({ enqueued: 3, delivered: 0, skipped: 3, failed: 0, transport: "none" });

    // And the outbox really has the three rows the count is claiming.
    expect(dbRef.current.rows("engagement_email_outbox")).toHaveLength(3);

    // Now the operator surface, fed the route's own body.
    respondWith(body);
    render(<EngagementCloseLoopBuilder campaignId={CAMPAIGN.id} categories={[]} initialEntries={[draftEntry()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    const notice = await screen.findByTestId("closeloop-broadcast-notice");
    expect(notice.textContent).toMatch(/3 update emails were recorded in the outbox but not delivered/i);
    expect(notice.textContent).toMatch(/no email service configured/i);
    // The honest failure mode this replaces: silence, or a bare "3 emailed".
    expect(notice.textContent).not.toMatch(/3 update emails delivered/i);
  });

  it("says no subscriptions were found rather than staying silent", async () => {
    dbRef.current = seedDatabase({ subscribers: 0 });
    const body = await publishTheEntry();
    expect(body.broadcast).toEqual({ enqueued: 0, delivered: 0, skipped: 0, failed: 0, transport: "none" });

    respondWith(body);
    render(<EngagementCloseLoopBuilder campaignId={CAMPAIGN.id} categories={[]} initialEntries={[draftEntry()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    const notice = await screen.findByTestId("closeloop-broadcast-notice");
    expect(notice.textContent).toMatch(/found no confirmed email subscriptions/i);
  });

  /**
   * THE ZERO IS NOT A FACT ABOUT THE WORLD.
   *
   * `enqueueCampaignSubscriberEmails` reads engagement_subscriptions with the
   * error discarded, so a subscriber list the database refused arrives as an
   * empty one. Surfacing the count (which is what this lane did) turned an
   * invisible bad read into a sentence on an operator's screen, so the sentence
   * may report what was FOUND and may not claim that nobody subscribed.
   *
   * The route below runs against a database that answers the subscriptions read
   * with an error and every other read normally — the failure the product would
   * really hit, not a hand-built payload.
   */
  it("a subscriber list that could not be read is never reported as 'nobody subscribed'", async () => {
    dbRef.current.failReads.add("engagement_subscriptions");
    const body = await publishTheEntry();

    // The read failed and the count still came back zero: proof the two are
    // indistinguishable in this payload, which is why the copy must hedge.
    expect(body.broadcast).toEqual({ enqueued: 0, delivered: 0, skipped: 0, failed: 0, transport: "none" });
    expect(dbRef.current.rows("engagement_email_outbox")).toHaveLength(0);

    respondWith(body);
    render(<EngagementCloseLoopBuilder campaignId={CAMPAIGN.id} categories={[]} initialEntries={[draftEntry()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    const notice = await screen.findByTestId("closeloop-broadcast-notice");
    // No claim about people: "nobody has/is subscribed", "no subscribers", "no
    // one has subscribed" are all assertions a failed read cannot support.
    expect(notice.textContent).not.toMatch(/nobody (has|is|was)/i);
    expect(notice.textContent).not.toMatch(/no ?(one|body) (has|had) subscribed/i);
    // What it may say instead, plus the disclosure that a failed read looks the same.
    expect(notice.textContent).toMatch(/found no confirmed email subscriptions/i);
    expect(notice.textContent).toMatch(/failed to read/i);
  });

  /**
   * The outbox `error` column is the transport's reply verbatim, and a provider
   * that rejects a recipient echoes the address back. Operators are deliberately
   * never given participant email addresses — the table is REVOKEd from
   * `authenticated` and the panel's projection excludes `to_email` — so the
   * address must not arrive through the diagnostic string instead.
   */
  it("an address inside a provider's error never reaches the operator panel", async () => {
    dbRef.current.rows("engagement_email_outbox").push({
      id: "outbox-failed",
      campaign_id: CAMPAIGN.id,
      status: "failed",
      transport: "resend",
      error: 'HTTP 422: {"message":"Invalid `to` field: resident7@example.org is not a valid recipient"}',
      created_at: "2026-08-02T10:00:00.000Z",
      sent_at: null,
    });

    const body = await readNotifications();
    respondWith(body);
    render(<EngagementNotificationsInbox campaignId={CAMPAIGN.id} initialNotifications={[]} />);

    const panel = await screen.findByTestId("email-delivery-panel");
    await waitFor(() => expect(panel.textContent).toMatch(/Most recent failure/i));
    expect(panel.textContent).not.toContain("resident7@example.org");
    // Masked, not withheld: the operator still gets the status, the code and the
    // domain, which is what makes the failure diagnosable.
    expect(panel.textContent).toMatch(/HTTP 422/);
    expect(panel.textContent).toContain("r…@example.org");
    expect(panel.textContent).toMatch(/are masked/i);
  });

  it("a campaign with no share link says WHY no update emails went out", async () => {
    campaignAccess.mockResolvedValue({ error: null, allowed: true, campaign: { ...CAMPAIGN, share_token: null } });
    const body = await publishTheEntry();
    expect(body.broadcastOutcome).toBe("no_share_token");
    expect(body.broadcast).toBeNull();

    respondWith(body);
    render(<EngagementCloseLoopBuilder campaignId={CAMPAIGN.id} categories={[]} initialEntries={[draftEntry()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    const notice = await screen.findByTestId("closeloop-broadcast-notice");
    expect(notice.textContent).toMatch(/no public share link/i);
    expect(notice.textContent).toMatch(/unsubscribe link/i);
  });

  it("a broadcast step that could not report back says UNKNOWN, never 'nobody'", async () => {
    // A deployment missing its service-role key: createServiceRoleClient throws,
    // the publish still commits, and the operator must not be told zero.
    serviceClientFactory.mockImplementation(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });
    const body = await publishTheEntry();
    expect(body.broadcastOutcome).toBe("unknown");
    expect((body.entry as { status: string }).status).toBe("published"); // the publish itself survived

    respondWith(body);
    render(<EngagementCloseLoopBuilder campaignId={CAMPAIGN.id} categories={[]} initialEntries={[draftEntry()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    const notice = await screen.findByTestId("closeloop-broadcast-notice");
    expect(notice.textContent).toMatch(/could not determine whether subscriber update emails were queued/i);
    expect(notice.textContent).toMatch(/not the same as nobody being emailed/i);
    expect(notice.textContent).not.toMatch(/found no confirmed email subscriptions/i);
  });

  it("delivered mail is reported as delivered, with the transport named", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const sendSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, status: 200, text: async () => "", json: async () => ({}) } as unknown as Response);

    const body = await publishTheEntry();
    expect(sendSpy).toHaveBeenCalled(); // the transport was really exercised
    expect(body.broadcast).toEqual({ enqueued: 3, delivered: 3, skipped: 0, failed: 0, transport: "resend" });

    sendSpy.mockResolvedValue({ ok: true, status: 200, json: async () => body } as unknown as Response);
    render(<EngagementCloseLoopBuilder campaignId={CAMPAIGN.id} categories={[]} initialEntries={[draftEntry()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    const notice = await screen.findByTestId("closeloop-broadcast-notice");
    expect(notice.textContent).toMatch(/3 update emails delivered via resend/i);
  });

  it("the outbox rows a publish wrote become a delivery panel a planner can read", async () => {
    await publishTheEntry(); // writes three real outbox rows

    // The REAL loader over the REAL rows, then the REAL route, then the REAL panel.
    const summary = await loadCampaignEmailDeliverySummary(fakeClient(dbRef.current) as never, CAMPAIGN.id);
    expect(summary).toMatchObject({ ok: true, total: 3, counts: { skipped: 3, sent: 0, failed: 0, queued: 0 } });

    const body = await readNotifications();
    expect(body.emailDelivery).toMatchObject({ ok: true, total: 3 });
    expect(body.emailTransport).toBe("none");

    respondWith(body);
    render(<EngagementNotificationsInbox campaignId={CAMPAIGN.id} initialNotifications={[]} />);

    const panel = await screen.findByTestId("email-delivery-panel");
    await waitFor(() => expect(panel.textContent).toMatch(/3 Recorded, not sent/i));
    expect(panel.textContent).toMatch(/3 messages recorded/i);
    expect(panel.textContent).toMatch(/no email service was configured/i);
    expect(panel.textContent).not.toMatch(/No emails have been queued/i);
  });

  it("the delivery panel never asks the database for participant email addresses", async () => {
    await publishTheEntry();
    dbRef.current.projections.length = 0;
    await loadCampaignEmailDeliverySummary(fakeClient(dbRef.current) as never, CAMPAIGN.id);

    const outboxProjections = dbRef.current.projections.filter((p) => p.table === "engagement_email_outbox");
    expect(outboxProjections).toHaveLength(1);
    // Assert the projection STRING, because a mocked client answers whatever was
    // asked for: the panel renders exactly these columns and no recipient.
    expect(outboxProjections[0].columns).toBe(EMAIL_OUTBOX_SUMMARY_COLUMNS);
    expect(outboxProjections[0].columns).not.toMatch(/to_email/);
    for (const column of ["status", "transport", "error", "created_at", "sent_at"]) {
      expect(outboxProjections[0].columns).toContain(column);
    }
  });

  it("a failed outbox read is disclosed as a failed read, not as an empty outbox", async () => {
    await publishTheEntry();
    dbRef.current.failReads.add("engagement_email_outbox");

    const summary = await loadCampaignEmailDeliverySummary(fakeClient(dbRef.current) as never, CAMPAIGN.id);
    expect(summary.ok).toBe(false);

    const body = await readNotifications();
    expect(body.emailDelivery).toMatchObject({ ok: false });

    respondWith(body);
    render(<EngagementNotificationsInbox campaignId={CAMPAIGN.id} initialNotifications={[]} />);

    const panel = await screen.findByTestId("email-delivery-panel");
    await waitFor(() => expect(panel.textContent).toMatch(/could not be read/i));
    expect(panel.textContent).toMatch(/not the same as no emails having been sent/i);
    expect(panel.textContent).not.toMatch(/No emails have been queued/i);
  });
});
