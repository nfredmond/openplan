import { describe, expect, it } from "vitest";

import {
  buildProjectPortfolioSummary,
  type PortfolioProjectFacts,
} from "@/lib/projects/portfolio";
import {
  loadProjectPortfolioInputs,
  PORTFOLIO_LANE_SELECTS,
  PORTFOLIO_MAX_PROJECTS,
} from "@/lib/projects/portfolio-queries";

/**
 * THE PORTFOLIO TABLE, THROUGH ITS REAL LOADER.
 *
 * A described fixture proves the assertion; only a built one proves the feature.
 * So every case below seeds ROWS in a fake that applies PostgREST's join
 * semantics — `projects!inner(...)` DROPS a row whose parent misses the filter,
 * a plain embed KEEPS it and nulls the parent — and reads them through
 * `loadProjectPortfolioInputs` and `buildProjectPortfolioSummary`. Nothing here
 * hands the shaping layer a hand-written input object, because that would test
 * the shaping and leave the six select strings unexercised.
 *
 * The fake also projects ONLY the selected columns, so a column missing from a
 * lane's select surfaces here as an undefined value rather than in production —
 * the Supabase clients in this repo are untyped and never check a projection.
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after; see the report.
 */

// ── the fake ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

/**
 * The embeds these six lanes use. Deliberately local to this file rather than
 * shared with `helpers/fake-my-work-tables.ts`: that fake models eight OTHER
 * tables and two of these relations (spend entries, invoice line items) are not
 * in it. Its select-parsing rules are the same ones, restated for the three
 * shapes this module needs.
 */
const RELATIONS: Record<
  string,
  Record<string, { parent: string; fk: string; toMany?: boolean; childFk?: string }>
> = {
  project_deliverables: { projects: { parent: "projects", fk: "project_id" } },
  project_milestones: { projects: { parent: "projects", fk: "project_id" } },
  project_submittals: { projects: { parent: "projects", fk: "project_id" } },
  project_spend_entries: { projects: { parent: "projects", fk: "project_id" } },
  client_invoices: {
    client_invoice_line_items: {
      parent: "client_invoice_line_items",
      fk: "id",
      toMany: true,
      childFk: "invoice_id",
    },
  },
};

type Node = { kind: "column"; name: string } | { kind: "embed"; name: string; inner: boolean; children: Node[] };

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseSelect(select: string): Node[] {
  return splitTopLevel(select).map((raw) => {
    const part = raw.trim();
    const paren = part.indexOf("(");
    if (paren === -1) return { kind: "column", name: part };
    const head = part.slice(0, paren);
    const inner = head.endsWith("!inner");
    return {
      kind: "embed",
      name: inner ? head.slice(0, -"!inner".length) : head,
      inner,
      children: parseSelect(part.slice(paren + 1, part.lastIndexOf(")"))),
    };
  });
}

const DROP = Symbol("drop");

function project(db: Db, table: string, row: Row, nodes: Node[], nulled: ReadonlySet<string>): Row | typeof DROP {
  const out: Row = {};
  for (const node of nodes) {
    if (node.kind === "column") {
      out[node.name] = row[node.name];
      continue;
    }
    const relation = RELATIONS[table]?.[node.name];
    if (!relation) throw new Error(`fake has no relation ${table} -> ${node.name}`);
    if (relation.toMany) {
      out[node.name] = (db[relation.parent] ?? [])
        .filter((child) => child[relation.childFk as string] === row[relation.fk])
        .map((child) => project(db, relation.parent, child, node.children, new Set()));
      continue;
    }
    if (nulled.has(node.name)) {
      out[node.name] = null;
      continue;
    }
    const parent = (db[relation.parent] ?? []).find((candidate) => candidate.id === row[relation.fk]) ?? null;
    if (!parent) {
      if (node.inner) return DROP;
      out[node.name] = null;
      continue;
    }
    out[node.name] = project(db, relation.parent, parent, node.children, new Set());
  }
  return out;
}

function pathIsInner(nodes: Node[], path: string[]): boolean {
  let current = nodes;
  for (const hop of path.slice(0, -1)) {
    const node = current.find((candidate) => candidate.kind === "embed" && candidate.name === hop);
    if (!node || node.kind !== "embed" || !node.inner) return false;
    current = node.children;
  }
  return true;
}

function resolvePath(db: Db, table: string, row: Row, path: string[]): unknown {
  let currentRow: Row | null = row;
  let currentTable = table;
  for (const hop of path.slice(0, -1)) {
    if (!currentRow) return undefined;
    const relation = RELATIONS[currentTable][hop];
    currentRow = (db[relation.parent] ?? []).find((candidate) => candidate.id === currentRow?.[relation.fk]) ?? null;
    currentTable = relation.parent;
  }
  return currentRow ? currentRow[path[path.length - 1]] : undefined;
}

type Filter = { kind: "eq"; path: string[]; value: unknown } | { kind: "in"; column: string; values: readonly string[] };

function createFakeSupabase(db: Db, failures: Record<string, string> = {}) {
  const selects: Record<string, string> = {};
  const limits: Record<string, number> = {};
  const filtersSeen: Record<string, string[]> = {};
  const client = {
    from(table: string) {
      return {
        select(select: string) {
          selects[table] = select;
          const nodes = parseSelect(select);
          const filters: Filter[] = [];
          let limitCount: number | null = null;
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ kind: "eq", path: column.split("."), value });
              (filtersSeen[table] ??= []).push(`eq:${column}`);
              return builder;
            },
            in(column: string, values: readonly string[]) {
              filters.push({ kind: "in", column, values });
              (filtersSeen[table] ??= []).push(`in:${column}`);
              return builder;
            },
            order() {
              return builder;
            },
            limit(count: number) {
              limitCount = count;
              limits[table] = count;
              return builder;
            },
            then<T>(resolve: (result: { data: unknown; error: { message: string } | null }) => T) {
              const failure = failures[table];
              if (failure) return Promise.resolve(resolve({ data: null, error: { message: failure } }));
              const kept: Row[] = [];
              for (const row of db[table] ?? []) {
                let dropped = false;
                const nulled = new Set<string>();
                for (const filter of filters) {
                  if (filter.kind === "in") {
                    if (!filter.values.includes(String(row[filter.column]))) dropped = true;
                    continue;
                  }
                  if (filter.path.length === 1) {
                    if (row[filter.path[0]] !== filter.value) dropped = true;
                    continue;
                  }
                  const value = resolvePath(db, table, row, filter.path);
                  if (value === filter.value) continue;
                  // THE SEMANTICS UNDER TEST: an embed filter only removes the
                  // row when the whole path is `!inner`; otherwise PostgREST
                  // keeps the row and nulls the embed.
                  if (pathIsInner(nodes, filter.path)) dropped = true;
                  else nulled.add(filter.path[0]);
                }
                if (dropped) continue;
                const projected = project(db, table, row, nodes, nulled);
                if (projected === DROP) continue;
                kept.push(projected);
              }
              const rows = limitCount === null ? kept : kept.slice(0, limitCount);
              return Promise.resolve(resolve({ data: rows, error: null }));
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, selects, limits, filtersSeen };
}

// ── fixture ─────────────────────────────────────────────────────────────────

const WS_A = "aaaaaaaa-0000-4000-8000-000000000001";
const WS_B = "bbbbbbbb-0000-4000-8000-000000000002";
const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "22222222-0000-4000-8000-000000000002";
const P_OTHER = "33333333-0000-4000-8000-000000000003";
const NOW = new Date("2026-08-11T12:00:00Z");

function facts(id: string, name: string): PortfolioProjectFacts {
  return { id, name, status: "active", deliveryPhase: "delivery", updatedAt: "2026-08-10T00:00:00Z" };
}

/**
 * P1: a stated project budget, one overdue deliverable, one upcoming milestone,
 *     spend and a sent invoice line.
 * P2: NO stated budget and PARTIAL deliverable coverage — the case whose burn
 *     must refuse.
 * P_OTHER: another workspace's project, with its own records. It is the decoy
 *     that proves the `!inner` embed is doing the scoping.
 */
function buildDb(): Db {
  return {
    projects: [
      { id: P1, workspace_id: WS_A, name: "Corridor Rehabilitation", budget_amount: "100000.00", updated_at: "2026-08-10" },
      { id: P2, workspace_id: WS_A, name: "Bridge Condition Study", budget_amount: null, updated_at: "2026-08-09" },
      { id: P_OTHER, workspace_id: WS_B, name: "Another Workspace's Plan", budget_amount: "9999.00", updated_at: "2026-08-08" },
    ],
    project_deliverables: [
      { id: "d1", project_id: P1, title: "Existing conditions memo", status: "in_progress", due_date: "2026-08-01", budget_amount: "40000.00", percent_complete: 50, updated_at: "x" },
      { id: "d2", project_id: P1, title: "Draft alternatives", status: "not_started", due_date: "2026-09-15", budget_amount: "60000.00", percent_complete: 0, updated_at: "x" },
      { id: "d3", project_id: P2, title: "Field review notes", status: "in_progress", due_date: "2026-08-25", budget_amount: "10000.00", percent_complete: 10, updated_at: "x" },
      { id: "d4", project_id: P2, title: "Load rating summary", status: "not_started", due_date: "2026-10-01", budget_amount: null, percent_complete: null, updated_at: "x" },
      { id: "d-other", project_id: P_OTHER, title: "Someone else's deliverable", status: "in_progress", due_date: "2026-07-01", budget_amount: "1.00", percent_complete: 0, updated_at: "x" },
    ],
    project_milestones: [
      { id: "m1", project_id: P1, title: "Design concept approval", status: "scheduled", target_date: "2026-08-20" },
      { id: "m2", project_id: P1, title: "Closeout", status: "complete", target_date: "2026-07-01" },
      { id: "m-other", project_id: P_OTHER, title: "Someone else's milestone", status: "scheduled", target_date: "2026-07-02" },
    ],
    project_submittals: [
      { id: "s1", project_id: P2, title: "Authorization packet", status: "draft", due_date: "2026-08-18" },
    ],
    project_spend_entries: [
      { id: "sp1", project_id: P1, deliverable_id: "d1", amount: "15000.00", entry_date: "2026-07-01" },
      { id: "sp-other", project_id: P_OTHER, deliverable_id: null, amount: "500.00", entry_date: "2026-07-01" },
    ],
    client_invoices: [
      { id: "inv1", workspace_id: WS_A, project_id: P1, status: "sent", invoice_date: "2026-07-15" },
      { id: "inv-draft", workspace_id: WS_A, project_id: P1, status: "draft", invoice_date: "2026-07-20" },
      { id: "inv-other", workspace_id: WS_B, project_id: P_OTHER, status: "sent", invoice_date: "2026-07-15" },
    ],
    client_invoice_line_items: [
      { id: "l1", invoice_id: "inv1", deliverable_id: "d1", amount: "10000.00" },
      { id: "l-draft", invoice_id: "inv-draft", deliverable_id: "d2", amount: "50000.00" },
      { id: "l-other", invoice_id: "inv-other", deliverable_id: "d-other", amount: "1.00" },
    ],
  };
}

async function summarize(
  db: Db = buildDb(),
  failures: Record<string, string> = {},
  projects: PortfolioProjectFacts[] = [facts(P1, "Corridor Rehabilitation"), facts(P2, "Bridge Condition Study")]
) {
  const fake = createFakeSupabase(db, failures);
  const inputs = await loadProjectPortfolioInputs(fake.client, {
    workspaceId: WS_A,
    projectIds: projects.map((project) => project.id),
  });
  return {
    fake,
    inputs,
    summary: buildProjectPortfolioSummary({ projects, inputs, now: NOW }),
  };
}

// ── the tests ───────────────────────────────────────────────────────────────

describe("the portfolio loader asks for the columns the table renders", () => {
  it("names every rendered column in its select strings", async () => {
    const { fake } = await summarize();
    // Asserting on the PROJECTION itself, not on a fixture: a mocked client
    // returns its rows whatever was selected, so deleting a column from a
    // select would otherwise leave every assertion below green.
    expect(fake.selects.project_deliverables).toContain("budget_amount");
    expect(fake.selects.project_deliverables).toContain("percent_complete");
    expect(fake.selects.project_deliverables).toContain("due_date");
    expect(fake.selects.project_milestones).toContain("target_date");
    expect(fake.selects.project_submittals).toContain("due_date");
    expect(fake.selects.projects).toContain("budget_amount");
    expect(fake.selects.client_invoices).toContain("client_invoice_line_items(deliverable_id, amount)");
  });

  it("filters each lane on the column that scopes it, and invoices on billed status", async () => {
    const { fake } = await summarize();
    // RECORD THE FILTERS, not just the rows: a fake that answers the same rows
    // however it was queried proves nothing about the scoping.
    expect(fake.filtersSeen.project_deliverables).toContain("eq:projects.workspace_id");
    expect(fake.filtersSeen.project_spend_entries).toContain("eq:projects.workspace_id");
    expect(fake.filtersSeen.projects).toContain("eq:workspace_id");
    expect(fake.filtersSeen.client_invoices).toContain("eq:workspace_id");
    // Draft and void invoices never cross the wire. `buildProjectBudgetSnapshot`
    // would exclude a draft line from the billed total anyway (which is why the
    // burn assertions below survive this filter being widened) — this asserts
    // the row cap is not spent on invoices that can never count.
    expect(fake.filtersSeen.client_invoices).toContain("in:status");
  });

  it("scopes every join-scoped lane through a load-bearing !inner embed", () => {
    for (const laneId of ["deliverables", "milestones", "submittals", "spend_entries"] as const) {
      expect(PORTFOLIO_LANE_SELECTS[laneId]).toContain("projects!inner");
    }
    // client_invoices carries its own workspace_id, so it must NOT join.
    expect(PORTFOLIO_LANE_SELECTS.billed_lines).not.toContain("projects!inner");
  });

  it("keeps another workspace's rows out of the read entirely", async () => {
    const { inputs } = await summarize();
    // Four deliverables in workspace A; the fifth belongs to WS_B and the
    // `!inner` embed drops it before it can consume the row cap or land in a
    // group. With the `!inner` removed, PostgREST keeps it and this is 5.
    expect(inputs.deliverables.outcome.rowCount).toBe(4);
    expect(inputs.deliverables.byProjectId.has(P_OTHER)).toBe(false);
    expect(inputs.spendEntries.outcome.rowCount).toBe(1);
    expect(inputs.billedLines.byProjectId.has(P_OTHER)).toBe(false);
  });

  it("groups each lane by project_id", async () => {
    const { inputs } = await summarize();
    expect(inputs.deliverables.byProjectId.get(P1)?.map((row) => row.id)).toEqual(["d1", "d2"]);
    expect(inputs.deliverables.byProjectId.get(P2)?.map((row) => row.id)).toEqual(["d3", "d4"]);
    expect(inputs.milestones.byProjectId.get(P1)?.map((row) => row.id)).toEqual(["m1", "m2"]);
  });
});

describe("the next-deadline column", () => {
  it("names the soonest open dated record across all three kinds, and counts what is overdue", async () => {
    const { summary } = await summarize();
    const p1 = summary.rows.find((row) => row.id === P1);
    expect(p1?.deadlines.available).toBe(true);
    expect(p1?.deadlines.next).toMatchObject({
      kind: "deliverable",
      title: "Existing conditions memo",
      dueOn: "2026-08-01",
      isOverdue: true,
    });
    // d1 (overdue), d2, m1 — the complete milestone is not open work.
    expect(p1?.deadlines.openDatedCount).toBe(3);
    expect(p1?.deadlines.overdueCount).toBe(1);

    const p2 = summary.rows.find((row) => row.id === P2);
    // The submittal on 08-18 beats both of P2's deliverables.
    expect(p2?.deadlines.next).toMatchObject({ kind: "submittal", dueOn: "2026-08-18", isOverdue: false });
    expect(p2?.deadlines.overdueCount).toBe(0);
  });

  it("is unavailable rather than zero when ANY of its three lanes failed", async () => {
    const { summary } = await summarize(buildDb(), { project_submittals: "permission denied for table" });
    const p1 = summary.rows.find((row) => row.id === P1);
    expect(p1?.deadlines.available).toBe(false);
    expect(p1?.deadlines.openDatedCount).toBe(0);
    expect(p1?.deadlines.unavailableReason).toContain("could not be read");
    // The deliverables lane answered, so the failure must not be mislabelled.
    expect(p1?.deadlines.unavailableReason).toContain("submittals");
  });

  it("says a pending migration is a pending migration, not an outage", async () => {
    const { summary } = await summarize(buildDb(), {
      project_milestones: 'relation "project_milestones" does not exist',
    });
    const reason = summary.rows[0].deadlines.unavailableReason ?? "";
    expect(reason).toContain("migration");
    expect(reason).not.toContain("could not be read");
  });
});

describe("the burn column", () => {
  it("measures against the stated project budget when one is entered", async () => {
    const { summary } = await summarize();
    const p1 = summary.rows.find((row) => row.id === P1);
    // billed (sent invoice line, $10,000) + direct spend ($15,000) = $25,000
    // against a $100,000 stated budget. The DRAFT invoice line is excluded.
    expect(p1?.burn.available).toBe(true);
    expect(p1?.burn.actualToDate).toBe(25000);
    expect(p1?.burn.budgetAmount).toBe(100000);
    expect(p1?.burn.burnPercent).toBe(25);
    expect(p1?.burn.basis).toBe("stated_budget");
    expect(p1?.burn.coverage).toBe("complete");
  });

  it("renders “—” with a reason when deliverable budget coverage is incomplete and no project budget is entered", async () => {
    const { summary } = await summarize();
    const p2 = summary.rows.find((row) => row.id === P2);
    expect(p2?.burn.available).toBe(false);
    expect(p2?.burn.burnPercent).toBeNull();
    expect(p2?.burn.coverage).toBe("partial");
    expect(p2?.burn.unavailableReason).toContain("partial figure");
  });

  it("uses the deliverable budget total once every deliverable carries one", async () => {
    const db = buildDb();
    // The only change: the unbudgeted deliverable gets a budget. Coverage
    // becomes complete and the same project now supports a percentage.
    db.project_deliverables = db.project_deliverables.map((row) =>
      row.id === "d4" ? { ...row, budget_amount: "30000.00" } : row
    );
    const { summary } = await summarize(db);
    const p2 = summary.rows.find((row) => row.id === P2);
    expect(p2?.burn.available).toBe(true);
    expect(p2?.burn.basis).toBe("deliverable_budgets");
    expect(p2?.burn.budgetAmount).toBe(40000);
    expect(p2?.burn.burnPercent).toBe(0);
  });

  it("refuses when a money lane could not be read, rather than understating spend", async () => {
    const { summary } = await summarize(buildDb(), { project_spend_entries: "permission denied" });
    for (const row of summary.rows) {
      expect(row.burn.available).toBe(false);
      expect(row.burn.unavailableReason).toContain("spend");
    }
  });

  it("says the budget columns are pending rather than reporting no budgets", async () => {
    const db = buildDb();
    const fake = createFakeSupabase(db);
    // A deployment behind 20260727000012: the first deliverable projection
    // fails on the missing column, the loader retries without it.
    const client = {
      from(table: string) {
        const real = fake.client.from(table);
        if (table !== "project_deliverables") return real;
        return {
          select(select: string) {
            if (select.includes("budget_amount")) {
              return {
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      then: (resolve: (r: { data: null; error: { message: string } }) => unknown) =>
                        Promise.resolve(
                          resolve({ data: null, error: { message: 'column "budget_amount" does not exist' } })
                        ),
                    }),
                  }),
                }),
              };
            }
            return real.select(select);
          },
        };
      },
    };
    const inputs = await loadProjectPortfolioInputs(client, { workspaceId: WS_A, projectIds: [P1, P2] });
    expect(inputs.deliverableBudgetColumnsPending).toBe(true);
    // The lane itself still answered, so the deadline column keeps working.
    expect(inputs.deliverables.outcome.failed).toBe(false);
    const summary = buildProjectPortfolioSummary({ projects: [facts(P1, "Corridor Rehabilitation")], inputs, now: NOW });
    expect(summary.rows[0].deadlines.available).toBe(true);
    expect(summary.rows[0].burn.available).toBe(false);
    expect(summary.rows[0].burn.unavailableReason).toContain("migration");
  });
});

describe("caps are disclosed rather than applied silently", () => {
  it("turns a truncated lane into “—” and a sentence, never into a count", async () => {
    const db = buildDb();
    // One project, so the row allowance is small enough to bind: 40 rows per
    // project, and 40 deliverables fills it exactly.
    db.project_deliverables = Array.from({ length: 40 }, (_, index) => ({
      id: `bulk-${index}`,
      project_id: P1,
      title: `Deliverable ${index}`,
      status: "in_progress",
      due_date: "2026-09-01",
      budget_amount: "1000.00",
      percent_complete: 0,
      updated_at: "x",
    }));
    const { inputs, summary } = await summarize(db, {}, [facts(P1, "Corridor Rehabilitation")]);
    expect(inputs.deliverables.outcome.truncated).toBe(true);
    expect(summary.rows[0].deadlines.available).toBe(false);
    expect(summary.rows[0].deadlines.unavailableReason).toContain("row cap");
    expect(summary.rows[0].burn.available).toBe(false);
    expect(summary.disclosures.join(" ")).toContain("deliverables");
  });

  it("says so when the workspace has more projects than one batch covers", async () => {
    const many = Array.from({ length: PORTFOLIO_MAX_PROJECTS + 3 }, (_, index) =>
      facts(`${index}`.padStart(8, "0") + "-0000-4000-8000-000000000000", `Project ${index}`)
    );
    const { inputs, summary } = await summarize(buildDb(), {}, many);
    expect(inputs.projectsTruncated).toBe(true);
    expect(inputs.projectIds).toHaveLength(PORTFOLIO_MAX_PROJECTS);
    expect(summary.disclosures.join(" ")).toContain("most recently updated projects");
  });

  it("has nothing to disclose when nothing bound", async () => {
    const { summary } = await summarize();
    expect(summary.disclosures).toEqual([]);
  });
});

describe("the loader reads with the caller's client only", () => {
  it("never reaches for a service-role client", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/projects/portfolio-queries.ts"),
      "utf8"
    );
    // Four of these six lanes have no workspace_id of their own. A service-role
    // read of them would be a cross-tenant leak with nothing left to stop it.
    expect(source).not.toContain("createServiceRoleClient");
    expect(source).not.toContain("SERVICE_ROLE");
  });
});
