/** Legacy outbox records remain visible in Activity after publication moves to the durable queue.
 * This suite exercises the real legacy writer, summary loader, notifications route and Activity panel
 * over a query double. Durable publication and response UI have separate tests and live SQL evidence.
 */
import { render, screen, waitFor } from "@testing-library/react";
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
import { GET as notificationsGet } from "@/app/api/engagement/campaigns/[campaignId]/notifications/route";
import { EngagementNotificationsInbox } from "@/components/engagement/notifications-inbox";
import { enqueueCampaignSubscriberEmails, EMAIL_OUTBOX_SUMMARY_COLUMNS, loadCampaignEmailDeliverySummary } from "@/lib/notifications/engagement";

function seedDatabase(options: { subscribers: number }): FakeDb {
  const fresh = new FakeDb();
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
  return fresh;
}

async function recordLegacyOutbox() {
  return enqueueCampaignSubscriberEmails(fakeClient(dbRef.current) as never, CAMPAIGN.id,
    { subject: "Legacy update", text: "Retained legacy message", template: "closeloop_published" },
    { origin: "https://agency.example", shareToken: CAMPAIGN.share_token });
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

describe("legacy outbox records remain visible in Activity", () => {
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

  it("legacy outbox rows become a delivery panel a planner can read", async () => {
    await recordLegacyOutbox(); // writes three real outbox rows

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
    await recordLegacyOutbox();
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
    await recordLegacyOutbox();
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
