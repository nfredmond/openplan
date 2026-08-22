/**
 * The eleven tables `/my-work` reads, in memory, WITH POSTGREST'S JOIN
 * SEMANTICS ACTUALLY APPLIED — and one seeded workspace to read them from.
 *
 * WHY A FAKE THIS ELABORATE, AND WHY IT IS SHARED. Five of the eleven sources
 * (`project_deliverables`, `project_milestones`, `project_submittals`,
 * `project_issues`, `engagement_items`) carry no workspace_id of their own: the
 * ONLY thing scoping
 * them to the viewed workspace is the `!inner` embed on `projects` plus the
 * `.eq("projects.workspace_id", …)` filter in the descriptor's select string. A
 * fixture-replaying double would answer the same rows however it was queried,
 * so every test over it would pass with the join deleted. This one implements
 * the difference that matters:
 *
 *   - `projects!inner(...)` + mismatched embed filter → the ROW IS DROPPED;
 *   - plain `projects(...)`  + mismatched embed filter → the row is KEPT and the
 *     embed is nulled (what PostgREST actually does — and exactly the
 *     cross-tenant listing leak the `!inner` exists to prevent).
 *
 * It also projects ONLY the selected columns, so a column missing from a
 * descriptor's `select` surfaces as a broken title here rather than as
 * `undefined` in production — untyped Supabase clients never check projections
 * at build time.
 *
 * It is a shared helper because the queue's reader and the page that renders it
 * must be tested against the SAME workspace. A board test built from
 * hand-written items proves the renderer and nothing else; built from these
 * rows, through the real loader, it proves the feature. (This repository's
 * recorded lesson: a described fixture proves the assertion, only a built one
 * proves the feature.)
 */

import { loadMyWork } from "@/lib/my-work/query";
import type { MyWorkItem, MyWorkResult, MyWorkScope } from "@/lib/my-work/types";
import type { ProjectAssigneeRoster } from "@/lib/projects/assignee-roster";

// ── The fake ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
export type Db = Record<string, Row[]>;

/** FK graph the embeds resolve through — child table → embed name → relation. */
const RELATIONS: Record<string, Record<string, { fk: string; parent: string }>> = {
  project_deliverables: { projects: { fk: "project_id", parent: "projects" } },
  project_milestones: { projects: { fk: "project_id", parent: "projects" } },
  project_submittals: { projects: { fk: "project_id", parent: "projects" } },
  project_issues: { projects: { fk: "project_id", parent: "projects" } },
  stage_gate_decisions: { projects: { fk: "project_id", parent: "projects" } },
  funding_opportunities: { projects: { fk: "project_id", parent: "projects" } },
  funding_awards: { projects: { fk: "project_id", parent: "projects" } },
  billing_invoice_records: { projects: { fk: "project_id", parent: "projects" } },
  // Engagement comments are scoped through their CAMPAIGN, and the campaign's
  // project is a second hop — the only two-level embed in the queue, and the
  // reason `projectRow` recurses.
  engagement_items: {
    engagement_campaigns: { fk: "campaign_id", parent: "engagement_campaigns" },
  },
  engagement_campaigns: { projects: { fk: "project_id", parent: "projects" } },
};

type SelectNode =
  | { kind: "column"; name: string }
  | { kind: "embed"; name: string; inner: boolean; children: SelectNode[] };

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
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseSelect(select: string): SelectNode[] {
  return splitTopLevel(select).map((rawPart) => {
    const part = rawPart.trim();
    const parenIndex = part.indexOf("(");
    if (parenIndex === -1) return { kind: "column", name: part };
    const head = part.slice(0, parenIndex);
    const inner = head.endsWith("!inner");
    return {
      kind: "embed",
      name: inner ? head.slice(0, -"!inner".length) : head,
      inner,
      children: parseSelect(part.slice(parenIndex + 1, part.lastIndexOf(")"))),
    };
  });
}

/** Whether every embed hop along a dotted filter path is declared `!inner` in the select. */
function pathIsAllInner(nodes: SelectNode[], path: string[]): boolean {
  let current = nodes;
  for (const hop of path.slice(0, -1)) {
    const node = current.find((candidate) => candidate.kind === "embed" && candidate.name === hop);
    if (!node || node.kind !== "embed" || !node.inner) return false;
    current = node.children;
  }
  return true;
}

const DROP = Symbol("drop");

function lookupParent(db: Db, table: string, embedName: string, row: Row): Row | null {
  const relation = RELATIONS[table]?.[embedName];
  if (!relation) throw new Error(`fake has no relation ${table} -> ${embedName}`);
  return (db[relation.parent] ?? []).find((parent) => parent.id === row[relation.fk]) ?? null;
}

function projectRow(
  db: Db,
  table: string,
  row: Row,
  nodes: SelectNode[],
  nulledEmbeds: ReadonlySet<string>
): Row | typeof DROP {
  const out: Row = {};
  for (const node of nodes) {
    if (node.kind === "column") {
      out[node.name] = row[node.name];
      continue;
    }
    if (nulledEmbeds.has(node.name)) {
      out[node.name] = null;
      continue;
    }
    const parent = lookupParent(db, table, node.name, row);
    if (!parent) {
      if (node.inner) return DROP;
      out[node.name] = null;
      continue;
    }
    const relation = RELATIONS[table][node.name];
    const sub = projectRow(db, relation.parent, parent, node.children, new Set());
    if (sub === DROP) {
      if (node.inner) return DROP;
      out[node.name] = null;
      continue;
    }
    out[node.name] = sub;
  }
  return out;
}

function resolvePathValue(db: Db, table: string, row: Row, path: string[]): unknown {
  let currentRow: Row | null = row;
  let currentTable = table;
  for (const hop of path.slice(0, -1)) {
    if (!currentRow) return undefined;
    const parent = lookupParent(db, currentTable, hop, currentRow);
    currentTable = RELATIONS[currentTable][hop].parent;
    currentRow = parent;
  }
  return currentRow ? currentRow[path[path.length - 1]] : undefined;
}

type Filter =
  | { kind: "eq"; path: string[]; value: unknown }
  | { kind: "in"; column: string; values: readonly string[] }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "notNull"; column: string }
  | { kind: "notIn"; column: string; values: string[] }
  | { kind: "or"; clauses: string[] };

/** `col.is.null` / `col.not.in.(a,b)` — the only two shapes the loader builds. */
function evaluateOrClause(clause: string, row: Row): boolean {
  const isNullMatch = /^([a-z_]+)\.is\.null$/.exec(clause.trim());
  if (isNullMatch) return row[isNullMatch[1]] === null || row[isNullMatch[1]] === undefined;
  const notInMatch = /^([a-z_]+)\.not\.in\.\(([^)]*)\)$/.exec(clause.trim());
  if (notInMatch) {
    const value = row[notInMatch[1]];
    // PostgREST: NULL is not IN anything, and NOT IN over NULL is NULL — the
    // row does not match. The `is.null` alternative is what covers those.
    if (value === null || value === undefined) return false;
    return !notInMatch[2]
      .split(",")
      .map((entry) => entry.trim())
      .includes(String(value));
  }
  throw new Error(`fake cannot evaluate or-clause: ${clause}`);
}

function runQuery(
  db: Db,
  table: string,
  select: string,
  filters: Filter[],
  order: { column: string; ascending: boolean } | null,
  limitCount: number | null
): Row[] {
  const nodes = parseSelect(select);
  const kept: Row[] = [];

  for (const row of db[table] ?? []) {
    let dropped = false;
    const nulled = new Set<string>();
    for (const filter of filters) {
      if (filter.kind === "neq") {
        if (row[filter.column] === filter.value) {
          dropped = true;
          break;
        }
        continue;
      }
      if (filter.kind === "notNull") {
        if (row[filter.column] === null || row[filter.column] === undefined) {
          dropped = true;
          break;
        }
        continue;
      }
      if (filter.kind === "in") {
        if (!filter.values.includes(String(row[filter.column]))) {
          dropped = true;
          break;
        }
        continue;
      }
      if (filter.kind === "notIn") {
        if (filter.values.includes(String(row[filter.column]))) {
          dropped = true;
          break;
        }
        continue;
      }
      if (filter.kind === "or") {
        if (!filter.clauses.some((clause) => evaluateOrClause(clause, row))) {
          dropped = true;
          break;
        }
        continue;
      }
      if (filter.path.length === 1) {
        if (row[filter.path[0]] !== filter.value) {
          dropped = true;
          break;
        }
        continue;
      }
      const value = resolvePathValue(db, table, row, filter.path);
      if (value === filter.value) continue;
      // THE SEMANTICS UNDER TEST: an embed filter only removes the parent row
      // when the whole path is `!inner`; otherwise PostgREST nulls the embed
      // and keeps the row — the leak shape.
      if (pathIsAllInner(nodes, filter.path)) {
        dropped = true;
        break;
      }
      nulled.add(filter.path[0]);
    }
    if (dropped) continue;
    const projected = projectRow(db, table, row, nodes, nulled);
    if (projected === DROP) continue;
    kept.push(projected);
  }

  let rows = kept;
  if (order) {
    const { column, ascending } = order;
    rows = [...rows].sort((a, b) => {
      const compared = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
      return ascending ? compared : -compared;
    });
  }
  if (limitCount !== null) rows = rows.slice(0, limitCount);
  return rows;
}

type FakeResult = { data: unknown; error: { message: string } | null };

export function createFakeSupabase(db: Db, failures: Record<string, string> = {}) {
  const selects: Record<string, string> = {};
  const limits: Record<string, number> = {};
  const client = {
    from(table: string) {
      return {
        select(select: string) {
          selects[table] = select;
          const filters: Filter[] = [];
          let order: { column: string; ascending: boolean } | null = null;
          let limitCount: number | null = null;
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ kind: "eq", path: column.split("."), value });
              return builder;
            },
            neq(column: string, value: unknown) {
              filters.push({ kind: "neq", column, value });
              return builder;
            },
            in(column: string, values: readonly string[]) {
              filters.push({ kind: "in", column, values });
              return builder;
            },
            is(column: string, value: null) {
              filters.push({ kind: "or", clauses: [`${column}.is.${String(value)}`] });
              return builder;
            },
            not(column: string, operator: string, value: unknown) {
              if (operator === "is" && value === null) {
                filters.push({ kind: "notNull", column });
                return builder;
              }
              if (operator === "in") {
                const inner = String(value).replace(/^\(|\)$/g, "");
                filters.push({
                  kind: "notIn",
                  column,
                  values: inner.split(",").map((entry) => entry.trim()),
                });
                return builder;
              }
              throw new Error(`fake cannot apply not(${column}, ${operator})`);
            },
            or(filter: string) {
              filters.push({ kind: "or", clauses: splitTopLevel(filter) });
              return builder;
            },
            order(column: string, options?: { ascending?: boolean }) {
              order = { column, ascending: options?.ascending === true };
              return builder;
            },
            limit(count: number) {
              limitCount = count;
              limits[table] = count;
              return builder;
            },
            then<T>(resolve: (result: FakeResult) => T, reject?: (reason: unknown) => T): Promise<T> {
              const failure = failures[table];
              const result: FakeResult = failure
                ? { data: null, error: { message: failure } }
                : { data: runQuery(db, table, select, filters, order, limitCount), error: null };
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, selects, limits };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export const WS_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const WS_B = "bbbbbbbb-0000-4000-8000-000000000002";
export const P1 = "11111111-0000-4000-8000-000000000001";
export const P2 = "22222222-0000-4000-8000-000000000002";
export const P_B = "33333333-0000-4000-8000-000000000003";
export const ME = "44444444-0000-4000-8000-000000000004";
export const TEAMMATE = "55555555-0000-4000-8000-000000000005";
/** Assigned work whose person is no longer on the roster. */
export const DEPARTED = "66666666-0000-4000-8000-000000000006";
export const AWARD_MIRRORED = "77777777-0000-4000-8000-000000000007";
export const AWARD_PLAIN = "88888888-0000-4000-8000-000000000008";
export const CAMPAIGN_A = "99999999-0000-4000-8000-000000000009";
/** A campaign in WS_A with NO project — a comment on it is a workspace record. */
export const CAMPAIGN_UNLINKED = "99999999-0000-4000-8000-000000000010";
export const CAMPAIGN_B = "99999999-0000-4000-8000-000000000011";
export const MODEL_A = "cccccccc-0000-4000-8000-000000000012";
export const REPORT_A = "dddddddd-0000-4000-8000-000000000013";
export const RTP_CHAPTER_A = "eeeeeeee-0000-4000-8000-000000000014";

export const NOW = new Date("2026-08-11T12:00:00Z");

export const ROSTER: ProjectAssigneeRoster = {
  ok: true,
  members: [
    { userId: ME, email: "planner@example.gov", role: "member" },
    { userId: TEAMMATE, email: "colleague@example.gov", role: "member" },
  ],
};

export function buildDb(): Db {
  return {
    projects: [
      { id: P1, workspace_id: WS_A, name: "Corridor Rehabilitation" },
      { id: P2, workspace_id: WS_A, name: "Bridge Condition Study" },
      { id: P_B, workspace_id: WS_B, name: "Another Workspace's Plan" },
    ],
    project_deliverables: [
      {
        id: "d-mine-overdue",
        project_id: P1,
        title: "Existing conditions memo",
        summary: null,
        status: "in_progress",
        due_date: "2026-08-01",
        owner_label: null,
        assignee_user_id: ME,
      },
      {
        id: "d-mine-upcoming",
        project_id: P1,
        title: "Draft alternatives",
        summary: null,
        status: "not_started",
        due_date: "2026-09-01",
        owner_label: null,
        assignee_user_id: ME,
      },
      {
        id: "d-teammate",
        project_id: P2,
        title: "Field review notes",
        summary: null,
        status: "in_progress",
        due_date: "2026-08-05",
        owner_label: null,
        assignee_user_id: TEAMMATE,
      },
      {
        id: "d-unassigned",
        project_id: P2,
        title: "Public meeting materials",
        summary: null,
        status: "not_started",
        due_date: "2026-08-20",
        owner_label: "Outside design consultant",
        assignee_user_id: null,
      },
      {
        id: "d-departed",
        project_id: P1,
        title: "Traffic count summary",
        summary: null,
        status: "in_progress",
        due_date: "2026-08-02",
        owner_label: null,
        assignee_user_id: DEPARTED,
      },
      {
        id: "d-complete",
        project_id: P1,
        title: "Kickoff agenda",
        summary: null,
        status: "complete",
        due_date: "2026-07-01",
        owner_label: null,
        assignee_user_id: ME,
      },
      {
        // THE DECOY: another workspace's deliverable, assigned to the same
        // person. Only the `!inner` embed keeps it off this queue.
        id: "d-decoy",
        project_id: P_B,
        title: "Decoy deliverable from another workspace",
        summary: null,
        status: "in_progress",
        due_date: "2026-08-03",
        owner_label: null,
        assignee_user_id: ME,
      },
    ],
    project_milestones: [
      {
        id: "m-mine",
        project_id: P1,
        title: "Environmental scoping complete",
        status: "in_progress",
        target_date: "2026-08-15",
        owner_label: null,
        assignee_user_id: ME,
        milestone_type: "schedule",
        phase_code: "environmental",
        funding_award_id: null,
      },
      {
        id: "m-obligation",
        project_id: P1,
        title: "Obligate construction funds",
        status: "not_started",
        target_date: "2026-09-10",
        owner_label: null,
        assignee_user_id: ME,
        milestone_type: "obligation",
        phase_code: "programming",
        funding_award_id: AWARD_MIRRORED,
      },
      {
        id: "m-decoy",
        project_id: P_B,
        title: "Decoy milestone",
        status: "in_progress",
        target_date: "2026-08-04",
        owner_label: null,
        assignee_user_id: ME,
        milestone_type: "schedule",
        phase_code: "initiation",
        funding_award_id: null,
      },
    ],
    project_submittals: [
      {
        id: "s-mine",
        project_id: P1,
        title: "Authorization packet",
        status: "internal_review",
        due_date: "2026-08-12",
        agency_label: "State DOT district office",
        submittal_type: "authorization_packet",
        assignee_user_id: ME,
      },
      {
        id: "s-accepted",
        project_id: P1,
        title: "Progress report 1",
        status: "accepted",
        due_date: "2026-07-01",
        agency_label: "State DOT district office",
        submittal_type: "progress_report",
        assignee_user_id: ME,
      },
      {
        id: "s-decoy",
        project_id: P_B,
        title: "Decoy submittal",
        status: "draft",
        due_date: "2026-08-06",
        agency_label: null,
        submittal_type: "other",
        assignee_user_id: ME,
      },
    ],
    project_issues: [
      {
        id: "i-mine",
        project_id: P1,
        title: "Right-of-way conflict at the north approach",
        status: "open",
        severity: "high",
        owner_label: null,
        assignee_user_id: ME,
        created_at: "2026-08-01T00:00:00Z",
      },
      {
        id: "i-resolved",
        project_id: P1,
        title: "Survey access resolved",
        status: "resolved",
        severity: "low",
        owner_label: null,
        assignee_user_id: ME,
        created_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "i-decoy",
        project_id: P_B,
        title: "Decoy issue",
        status: "open",
        severity: "critical",
        owner_label: null,
        assignee_user_id: ME,
        created_at: "2026-08-02T00:00:00Z",
      },
    ],
    stage_gate_decisions: [
      {
        id: "g-hold-p1",
        workspace_id: WS_A,
        project_id: P1,
        gate_id: "environmental_clearance",
        decision: "HOLD",
        rationale: "Cultural resources survey outstanding",
        decided_at: "2026-08-05T00:00:00Z",
      },
      {
        // Held in July, PASSED in August. The project is not blocked, and a
        // queue that showed the July row would send someone to unblock it.
        id: "g-pass-p2",
        workspace_id: WS_A,
        project_id: P2,
        gate_id: "programming",
        decision: "PASS",
        rationale: "Programming confirmed",
        decided_at: "2026-08-06T00:00:00Z",
      },
      {
        id: "g-hold-p2-old",
        workspace_id: WS_A,
        project_id: P2,
        gate_id: "programming",
        decision: "HOLD",
        rationale: "Awaiting programming confirmation",
        decided_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "g-orphan",
        workspace_id: WS_A,
        project_id: null,
        gate_id: "environmental_clearance",
        decision: "HOLD",
        rationale: "Unattributed legacy decision",
        decided_at: "2026-08-07T00:00:00Z",
      },
      {
        id: "g-decoy",
        workspace_id: WS_B,
        project_id: P_B,
        gate_id: "environmental_clearance",
        decision: "HOLD",
        rationale: "Decoy hold",
        decided_at: "2026-08-08T00:00:00Z",
      },
    ],
    funding_opportunities: [
      {
        id: "f-pending",
        workspace_id: WS_A,
        project_id: P1,
        title: "Active transportation program call",
        opportunity_status: "open",
        decision_state: "monitor",
        closes_at: "2026-08-30T00:00:00Z",
        decision_due_at: "2026-08-01T00:00:00Z",
        agency_name: "State transportation agency",
      },
      {
        id: "f-decided",
        workspace_id: WS_A,
        project_id: P2,
        title: "Bridge program call",
        opportunity_status: "open",
        decision_state: "pursue",
        closes_at: "2026-09-30T00:00:00Z",
        decision_due_at: "2026-08-20T00:00:00Z",
        agency_name: "State transportation agency",
      },
      {
        id: "f-decoy",
        workspace_id: WS_B,
        project_id: P_B,
        title: "Decoy opportunity",
        opportunity_status: "open",
        decision_state: "monitor",
        closes_at: "2026-08-30T00:00:00Z",
        decision_due_at: "2026-08-02T00:00:00Z",
        agency_name: null,
      },
    ],
    funding_awards: [
      {
        id: AWARD_MIRRORED,
        workspace_id: WS_A,
        project_id: P1,
        title: "Construction award",
        obligation_due_at: "2026-09-10T00:00:00Z",
        spending_status: "not_started",
        risk_flag: "watch",
      },
      {
        id: AWARD_PLAIN,
        workspace_id: WS_A,
        project_id: P2,
        title: "Planning award",
        obligation_due_at: "2026-08-25T00:00:00Z",
        spending_status: "active",
        risk_flag: "none",
      },
      {
        id: "a-spent",
        workspace_id: WS_A,
        project_id: P1,
        title: "Closed-out award",
        obligation_due_at: "2026-08-09T00:00:00Z",
        spending_status: "fully_spent",
        risk_flag: "none",
      },
      {
        id: "a-decoy",
        workspace_id: WS_B,
        project_id: P_B,
        title: "Decoy award",
        obligation_due_at: "2026-08-03T00:00:00Z",
        spending_status: "active",
        risk_flag: "none",
      },
    ],
    engagement_campaigns: [
      { id: CAMPAIGN_A, workspace_id: WS_A, title: "Downtown circulation study", project_id: P1 },
      {
        id: CAMPAIGN_UNLINKED,
        workspace_id: WS_A,
        title: "Countywide bike survey",
        project_id: null,
      },
      { id: CAMPAIGN_B, workspace_id: WS_B, title: "Decoy campaign", project_id: P_B },
    ],
    engagement_items: [
      {
        // Oldest pending, so it must sort FIRST — this queue answers "who has
        // been waiting longest", the opposite of every other source here.
        id: "c-pending-oldest",
        campaign_id: CAMPAIGN_A,
        title: null,
        body: "The crossing at 4th and Main is impossible to use with a stroller and the signal is far too short for anyone walking slowly.",
        status: "pending",
        source_type: "public",
        created_at: "2026-07-20T00:00:00Z",
      },
      {
        id: "c-flagged",
        campaign_id: CAMPAIGN_A,
        title: "Speeding on Elm",
        body: "Cars regularly exceed the limit here.",
        status: "flagged",
        source_type: "public",
        created_at: "2026-08-02T00:00:00Z",
      },
      {
        id: "c-pending-unlinked",
        campaign_id: CAMPAIGN_UNLINKED,
        title: "Bike lane request",
        body: "Please stripe a lane on Ridge Road.",
        status: "pending",
        source_type: "internal",
        created_at: "2026-08-04T00:00:00Z",
      },
      {
        // Already moderated — neither pending nor flagged, so it is off the queue.
        id: "c-approved",
        campaign_id: CAMPAIGN_A,
        title: "Thanks for the new signal",
        body: "It works well.",
        status: "approved",
        source_type: "public",
        created_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "c-rejected",
        campaign_id: CAMPAIGN_A,
        title: "Off topic",
        body: "Unrelated.",
        status: "rejected",
        source_type: "public",
        created_at: "2026-07-02T00:00:00Z",
      },
      {
        // THE DECOY: another workspace's resident, waiting for moderation.
        // `engagement_items` has no workspace_id — only the `!inner` embed on
        // engagement_campaigns keeps this off WS_A's queue, and leaking it
        // would put one agency's residents in another agency's inbox.
        id: "c-decoy",
        campaign_id: CAMPAIGN_B,
        title: "Decoy comment from another workspace",
        body: "Should never appear.",
        status: "pending",
        source_type: "public",
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    model_runs: [
      {
        id: "r-failed-recent",
        workspace_id: WS_A,
        model_id: MODEL_A,
        run_title: "Corridor screening — build alternative",
        status: "failed",
        error_message: "Worker exited before writing skims",
        engine_key: "aequilibrae",
        created_at: "2026-08-09T00:00:00Z",
      },
      {
        // Failed with NO recorded cause. The queue must say so rather than
        // inventing one — the recorded "a failed run said Run recorded" defect.
        id: "r-failed-no-cause",
        workspace_id: WS_A,
        model_id: MODEL_A,
        run_title: "Corridor screening — no build",
        status: "failed",
        error_message: null,
        engine_key: "activitysim",
        created_at: "2026-08-08T00:00:00Z",
      },
      {
        // Failed in JUNE — outside the window, so it is history rather than
        // inbox. Its absence is what keeps this block emptiable.
        id: "r-failed-stale",
        workspace_id: WS_A,
        model_id: MODEL_A,
        run_title: "Old screening attempt",
        status: "failed",
        error_message: "Network package missing",
        engine_key: "aequilibrae",
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "r-succeeded",
        workspace_id: WS_A,
        model_id: MODEL_A,
        run_title: "Corridor screening — baseline",
        status: "succeeded",
        error_message: null,
        engine_key: "aequilibrae",
        created_at: "2026-08-10T00:00:00Z",
      },
      {
        id: "r-decoy",
        workspace_id: WS_B,
        model_id: MODEL_A,
        run_title: "Decoy failed run",
        status: "failed",
        error_message: "Should never appear",
        engine_key: "aequilibrae",
        created_at: "2026-08-09T00:00:00Z",
      },
    ],
    document_narrative_drafts: [
      {
        id: "n-draft-report",
        workspace_id: WS_A,
        status: "draft",
        target_kind: "report_section",
        target_id: REPORT_A,
        section_key: "existing_conditions",
        model: "claude-opus-5",
        grounded_sentence_count: 7,
        total_sentence_count: 11,
        created_at: "2026-08-07T00:00:00Z",
      },
      {
        // An RTP CHAPTER draft. Genuinely awaiting a human — and deliberately
        // NOT on the queue, because this row cannot name a page a planner can
        // open (see LINKABLE_DRAFT_TARGET_KIND).
        id: "n-draft-chapter",
        workspace_id: WS_A,
        status: "draft",
        target_kind: "rtp_chapter",
        target_id: RTP_CHAPTER_A,
        section_key: null,
        model: "claude-opus-5",
        grounded_sentence_count: 4,
        total_sentence_count: 9,
        created_at: "2026-08-06T00:00:00Z",
      },
      {
        id: "n-accepted",
        workspace_id: WS_A,
        status: "accepted",
        target_kind: "report_section",
        target_id: REPORT_A,
        section_key: "recommendations",
        model: "claude-opus-5",
        grounded_sentence_count: 9,
        total_sentence_count: 9,
        created_at: "2026-08-05T00:00:00Z",
      },
      {
        id: "n-dismissed",
        workspace_id: WS_A,
        status: "dismissed",
        target_kind: "report_section",
        target_id: REPORT_A,
        section_key: "methodology",
        model: "claude-opus-5",
        grounded_sentence_count: 1,
        total_sentence_count: 8,
        created_at: "2026-08-04T00:00:00Z",
      },
      {
        id: "n-decoy",
        workspace_id: WS_B,
        status: "draft",
        target_kind: "report_section",
        target_id: REPORT_A,
        section_key: "existing_conditions",
        model: "claude-opus-5",
        grounded_sentence_count: 3,
        total_sentence_count: 3,
        created_at: "2026-08-07T00:00:00Z",
      },
    ],
    billing_invoice_records: [
      {
        id: "inv-open",
        workspace_id: WS_A,
        project_id: P1,
        invoice_number: "2026-004",
        status: "submitted",
        due_date: "2026-08-08",
        submitted_to: "Grant administrator",
      },
      {
        id: "inv-paid",
        workspace_id: WS_A,
        project_id: P1,
        invoice_number: "2026-003",
        status: "paid",
        due_date: "2026-08-01",
        submitted_to: "Grant administrator",
      },
      {
        id: "inv-decoy",
        workspace_id: WS_B,
        project_id: P_B,
        invoice_number: "9999-001",
        status: "submitted",
        due_date: "2026-08-04",
        submitted_to: null,
      },
    ],
  };
}


export async function loadSeededMyWork(
  options: {
    scope?: MyWorkScope;
    roster?: ProjectAssigneeRoster;
    failures?: Record<string, string>;
    limitPerSource?: number;
    db?: Db;
  } = {}
): Promise<{
  result: MyWorkResult;
  selects: Record<string, string>;
  limits: Record<string, number>;
}> {
  const { client, selects, limits } = createFakeSupabase(options.db ?? buildDb(), options.failures);
  const result = await loadMyWork(client, {
    workspaceId: WS_A,
    userId: ME,
    scope: options.scope,
    roster: options.roster ?? ROSTER,
    limitPerSource: options.limitPerSource,
    now: NOW,
  });
  return { result, selects, limits };
}

export const idsOf = (items: MyWorkItem[]) => items.map((item) => item.id);
