import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, redirect: () => { throw new Error("redirect"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/workspaces/current", () => ({ loadCurrentWorkspaceMembership: async () => ({ membership: { workspace_id: "workspace", role: "member" } }) }));
vi.mock("@/app/(app)/rtp/[rtpCycleId]/extraction/_components/manual-source-intake", () => ({ ManualSourceIntake: () => <p>Manual intake unchanged</p> }));
vi.mock("@/app/(app)/rtp/[rtpCycleId]/extraction/_components/extraction-run-launcher", () => ({ ExtractionRunLauncher: () => <p>Optional reading unchanged</p> }));
vi.mock("@/lib/rtp/financial-element-queries", () => ({ loadRtpFinancialElement: async () => ({
  bands: [], lines: [], measures: [], results: { bands: { error: null }, lines: { error: null }, measures: { error: null } },
}) }));

type Row = Record<string, unknown>;
type Result = { data: Row[] | Row | null; error: { message: string } | null; count: number | null };
type Query = {
  eq: (column: string, value: unknown) => Query;
  neq: (column: string, value: unknown) => Query;
  in: (column: string, value: unknown) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (size: number) => Query;
  range: (from: number, to: number) => Query;
  or: (cursor: string) => Query;
  maybeSingle: () => Promise<Result>;
  then: (resolve: (value: Result) => unknown) => Promise<unknown>;
};
type Read = { table: string; columns: string; options?: { count?: string; head?: boolean };
  filters: Array<{ op: "eq" | "neq" | "in"; column: string; value: unknown }>;
  orders: Array<{ column: string; ascending: boolean }>; limit?: number; range?: [number, number]; cursor?: string };
const reads: Read[] = [];
let tables: Record<string, Row[]>;
let failed: string | null;
let missingCount: boolean;
let truncatePending: boolean;
let omitSource: boolean;
const cycle = "cycle";
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const candidateRows = () => tables.rtp_extraction_candidates.filter((row) => row.target_kind !== "chapter_block");

function query(read: Read) {
  function result(single = false): Result {
    const kind = read.table === "rtp_extraction_runs" ? read.filters.some((filter) => filter.op === "in") ? "sources" : "history"
      : read.table === "rtp_extraction_candidates" ? read.options?.head ? "chapters" : "pending" : read.table;
    if (failed === kind) return { data: null, error: { message: `SYNTHETIC ${kind} read failed` }, count: null };
    let rows = (tables[read.table] ?? []).filter((row) => read.filters.every((filter) => {
      if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.column]);
      return filter.op === "neq" ? row[filter.column] !== filter.value : row[filter.column] === filter.value;
    }));
    if (read.cursor) {
      const parsed = /^created_at\.gt\.(.+),and\(created_at\.eq\.(.+),id\.gt\.([0-9a-f-]+)\)$/.exec(read.cursor);
      if (!parsed || parsed[1] !== parsed[2]) throw new Error("Malformed source cursor filter");
      rows = rows.filter((row) => String(row.created_at) > parsed[1] || (row.created_at === parsed[1] && String(row.id) > parsed[3]));
    }
    rows = [...rows].sort((a, b) => {
      for (const order of read.orders) {
        const diff = String(a[order.column]).localeCompare(String(b[order.column]));
        if (diff) return order.ascending ? diff : -diff;
      }
      return 0;
    });
    const count = read.options?.count === "exact" && !(missingCount && kind === "pending") ? rows.length : null;
    if (read.range) rows = rows.slice(read.range[0], read.range[1] + 1);
    if (read.limit !== undefined) rows = rows.slice(0, read.limit);
    if (truncatePending && kind === "pending") rows = rows.slice(0, 20);
    if (omitSource && kind === "sources") rows = rows.slice(1);
    return { data: read.options?.head ? null : single ? rows[0] ?? null : rows, error: null, count };
  }
  const q: Query = {
    eq(column: string, value: unknown) { read.filters.push({ op: "eq", column, value }); return q; },
    neq(column: string, value: unknown) { read.filters.push({ op: "neq", column, value }); return q; },
    in(column: string, value: unknown) { read.filters.push({ op: "in", column, value }); return q; },
    order(column: string, options: { ascending: boolean }) { read.orders.push({ column, ascending: options.ascending }); return q; },
    limit(size: number) { read.limit = size; return q; },
    range(from: number, to: number) { read.range = [from, to]; return q; },
    or(cursor: string) { read.cursor = cursor; return q; },
    maybeSingle: async () => result(true),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => ({ select: (columns: string, options?: Read["options"]) => {
    const read: Read = { table, columns, options, filters: [], orders: [] }; reads.push(read); return query(read);
  } }),
}) }));
import Page from "@/app/(app)/rtp/[rtpCycleId]/extraction/page";

async function show(search: Record<string, string> = {}) {
  return render(await Page({ params: Promise.resolve({ rtpCycleId: cycle }), searchParams: Promise.resolve(search) }));
}
function searchOf(href: string) { return Object.fromEntries(new URL(href, "http://localhost").searchParams); }
function pendingRegion() { return within(screen.getByRole("article", { name: "Pending numeric proposals" })); }
beforeEach(() => {
  reads.length = 0; failed = null; missingCount = false; truncatePending = false; omitSource = false;
  tables = { rtp_cycles: [{ id: cycle, workspace_id: "workspace", title: "SYNTHETIC cycle", financial_basis_year: null }],
    rtp_extraction_candidates: [], rtp_extraction_runs: [], projects: [], project_rtp_cycle_links: [], kb_documents: [] };
  for (let n = 1; n <= 55; n++) {
    const created_at = new Date(Date.UTC(2026, 9, 18, 0, 0, n)).toISOString();
    tables.rtp_extraction_runs.push({ id: uuid(100 + n), workspace_id: "workspace", rtp_cycle_id: cycle,
      kb_document_id: uuid(500 + n), kb_documents: { id: uuid(500 + n), title: `Retained source ${n}` },
      model: null, source_method: "manual_retained_page", document_extraction_id: uuid(1000 + n), original_checksum: `original-${n}`,
      extraction_content_sha256: `pages-${n}`, extraction_source: "text_layer", status: "succeeded", candidate_count: 1, discarded_count: 0, failure_reason: null, created_at });
    if (n <= 51) tables.rtp_extraction_candidates.push({ id: uuid(n), run_id: uuid(100 + n), workspace_id: "workspace", rtp_cycle_id: cycle,
      target_kind: "financial_line", status: "pending", proposed_json: { sourceName: `Source ${n}`, entryKind: "revenue", amount: 1000 + n },
      source_page: 112, source_quote: `SYNTHETIC source row ${n} has $${1000 + n}.`, created_at });
  }
});
afterEach(() => cleanup());

// Actual server page, reconciliation and review cards. Transport applies scopes,
// sorting, bounds and cursor semantics. No application code runs in this lane.
// Blind: PostgREST SQL/RLS, cross-request snapshots, Next routing and browser layout.
describe("bounded pending review source tests, all UNRUN", () => {
  it("P2_OLDER_PENDING_VISIBLE: an older manual proposal outside newest 50 runs keeps its review card and exact source", async () => {
    await show(); const queue = pendingRegion();
    expect(queue.getByText(String(candidateRows()[0].source_quote))).toBeVisible();
    expect(queue.getByRole("heading", { name: "Retained source 1" })).toBeVisible();
    expect(queue.getByText(/Version 00000000-0000-4000-8000-0000000003e9/)).toBeInTheDocument();
    expect(queue.getAllByRole("link", { name: "Page 112" })[0]).toHaveAttribute("href", `/api/knowledge-base/documents/${uuid(501)}/download`);
    expect(queue.getAllByRole("button", { name: "Save into the plan" })).toHaveLength(25);
    expect(queue.getByRole("heading", { name: "25 new" })).toBeVisible();
    expect(queue.getByText(/Reconciliation covers only the proposals displayed on this page/)).toBeVisible();
    const history = within(screen.getByRole("article", { name: "Reading history" }));
    expect(history.queryByText("Retained source 1")).toBeNull();
  });
  it("P2_ALL_51_REACHABLE: follows valid next links to all 51 distinct pending proposals exactly once", async () => {
    const seen = new Set<string>(); let search: Record<string, string> = {}; let pages = 0;
    while (true) {
      const view = await show(search); const queue = pendingRegion(); pages++;
      for (const candidate of candidateRows()) if (queue.queryByText(String(candidate.source_quote))) {
        expect(seen.has(String(candidate.id))).toBe(false); seen.add(String(candidate.id));
      }
      const next = queue.queryByRole("link", { name: "Next pending proposals" });
      if (!next) { expect(queue.getByText(/End of the current pending list/)).toBeVisible(); view.unmount(); break; }
      const href = next.getAttribute("href")!;
      expect(new URL(href, "http://localhost").pathname).toBe("/rtp/cycle/extraction");
      search = searchOf(href); expect(search.afterId).toMatch(/^[0-9a-f-]{36}$/);
      view.unmount(); if (pages > 3) throw new Error("Navigation repeated a pending page");
    }
    expect(pages).toBe(3); expect(seen.size).toBe(51);
  });
  it("P2_QUERY_PROJECTIONS: bounds candidate and history reads, and requests exact displayed-run metadata", async () => {
    await show();
    const pending = reads.find((read) => read.table === "rtp_extraction_candidates" && !read.options?.head)!;
    expect(pending.columns).toBe("id, run_id, target_kind, proposed_json, source_page, source_quote, status, created_at");
    expect(pending.options).toEqual({ count: "exact" }); expect(pending.limit).toBe(26);
    expect(pending.filters).toEqual([{ op: "eq", column: "rtp_cycle_id", value: cycle }, { op: "eq", column: "workspace_id", value: "workspace" }, { op: "eq", column: "status", value: "pending" }, { op: "neq", column: "target_kind", value: "chapter_block" }]);
    expect(pending.orders).toEqual([{ column: "created_at", ascending: true }, { column: "id", ascending: true }]);
    const sources = reads.find((read) => read.table === "rtp_extraction_runs" && read.filters.some((filter) => filter.op === "in"))!;
    expect(sources.columns).toBe("id, kb_document_id, model, source_method, document_extraction_id, original_checksum, extraction_content_sha256, extraction_source, status, candidate_count, discarded_count, failure_reason, created_at, kb_documents(id, title)");
    expect(sources.limit).toBe(25);
    expect(sources.filters).toEqual([{ op: "eq", column: "rtp_cycle_id", value: cycle }, { op: "eq", column: "workspace_id", value: "workspace" }, { op: "in", column: "id", value: Array.from({ length: 25 }, (_, i) => uuid(101 + i)) }]);
    const history = reads.find((read) => read.table === "rtp_extraction_runs" && read.range)!;
    expect(history.range).toEqual([0, 50]); expect(history.options).toEqual({ count: "exact" });
    const chapters = reads.find((read) => read.options?.head)!;
    expect(chapters.columns).toBe("id"); expect(chapters.options).toEqual({ count: "exact", head: true });
  });
  it.each(["pending", "sources"])("P2_READ_FAILURE_%s: renders an unavailable page, never an empty or reconciled queue", async (kind) => {
    failed = kind; await show(); const queue = pendingRegion();
    expect(queue.getByRole("heading", { name: "Pending review unavailable" })).toBeVisible();
    expect(queue.getByText(/This is not an empty-queue finding/)).toBeVisible();
    expect(queue.queryByText(/25 new/)).toBeNull(); expect(queue.queryByRole("link", { name: "Next pending proposals" })).toBeNull();
  });
  it.each(["unknown-count", "short-response", "missing-source"])("P2_COMPLETENESS_%s: refuses unconfirmed completeness", async (mode) => {
    missingCount = mode === "unknown-count"; truncatePending = mode === "short-response"; omitSource = mode === "missing-source";
    await show(); expect(pendingRegion().getByRole("heading", { name: "Pending review unavailable" })).toBeVisible();
    expect(pendingRegion().queryByText(/End of the current pending list/)).toBeNull();
  });
  it("P2_INVALID_NAVIGATION: rejects partial/injected cursors and offers a valid restart", async () => {
    await show({ afterId: "bad),or(anything)" }); const queue = pendingRegion();
    expect(queue.getByText("This pending-review link is invalid")).toBeVisible();
    expect(queue.getByRole("link", { name: "Restart pending review" })).toHaveAttribute("href", "/rtp/cycle/extraction");
    expect(reads.some((read) => read.cursor)).toBe(false);
  });
  it("P2_STABLE_CONTINUATION: acceptance before the cursor does not skip the next pending page, including timestamp ties", async () => {
    for (const candidate of candidateRows()) candidate.created_at = "2026-10-18T00:00:00.000Z";
    const first = await show(); const href = pendingRegion().getByRole("link", { name: "Next pending proposals" }).getAttribute("href")!;
    first.unmount(); for (const candidate of candidateRows().slice(0, 25)) candidate.status = "accepted";
    await show(searchOf(href));
    expect(pendingRegion().getByText(String(candidateRows()[25].source_quote))).toBeVisible();
    expect(pendingRegion().getAllByRole("button", { name: "Save into the plan" })).toHaveLength(25);
  });
  it("P2_HISTORY_INDEPENDENT: paginates older history without displacing the oldest pending proposal", async () => {
    const first = await show(); const history = within(screen.getByRole("article", { name: "Reading history" }));
    const href = history.getByRole("link", { name: "Older readings" }).getAttribute("href")!; first.unmount();
    await show(searchOf(href));
    expect(pendingRegion().getByText(String(candidateRows()[0].source_quote))).toBeVisible();
    expect(screen.getByRole("link", { name: "Newer readings" })).toHaveAttribute("href", "/rtp/cycle/extraction");
    expect(reads.filter((read) => read.table === "rtp_extraction_runs" && read.range).at(-1)?.range).toEqual([50, 100]);
  });
  it("P2_EMPTY_IS_EXPLICIT: a complete empty pending list retains history and separate chapter navigation", async () => {
    tables.rtp_extraction_candidates = []; await show(); const queue = pendingRegion();
    expect(queue.getByText(/No numeric proposals are waiting in the current list/)).toBeVisible();
    expect(screen.getByRole("article", { name: "Reading history" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Place copied chapter text" })).toBeVisible();
  });
  it("P2_HISTORY_FAILURE_IS_SEPARATE: history failure cannot hide or empty pending review", async () => {
    failed = "history"; await show();
    expect(screen.getByText("Reading history is unavailable")).toBeVisible();
    expect(pendingRegion().getByText(String(candidateRows()[0].source_quote))).toBeVisible();
  });
  it("P2_INVALID_HISTORY_LINK: invalid history bounds have a valid recovery link and preserve pending proposals", async () => {
    await show({ historyPage: "-1" });
    expect(screen.getByText("Reading history is unavailable")).toBeVisible();
    expect(screen.getByRole("link", { name: "Restart reading history" })).toHaveAttribute("href", "/rtp/cycle/extraction");
    expect(pendingRegion().getByText(String(candidateRows()[0].source_quote))).toBeVisible();
  });
});
