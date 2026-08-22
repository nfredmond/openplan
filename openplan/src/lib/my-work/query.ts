/**
 * `loadMyWork` — the one read path of the personal work queue.
 *
 * A LIVE UNION over the source tables, never a mirror: each source is read in
 * parallel with the CALLER'S client, capped per source, and classified per
 * source. There is deliberately NO service-role client anywhere in this module
 * (a test greps for it): four of the eight sources have no workspace_id column
 * of their own, so a service-role read of them would be a cross-tenant leak —
 * the caller's RLS is the outer wall and the descriptor's workspace filter,
 * through the `!inner` embed, is the inner one.
 *
 * THE ROSTER IS NOT READ HERE, AND THAT IS DELIBERATE. `workspace_members`'
 * only SELECT policy is `members_read_own`, so an RLS roster read returns
 * exactly one row — the caller — and any feature built on it silently believes
 * the caller is the whole team. The roster therefore has one legitimate reader
 * (`loadWorkspaceRoster`, service role behind its own caller-membership check),
 * and the PAGE does that read and hands the result in. This module stays
 * RLS-only, and a failed roster read arrives as `{ ok: false }` rather than as
 * an empty team — against an empty member list every assigned record would
 * resolve to "departed", i.e. the product telling a planner that everyone left.
 *
 * READ-FAILURE ≠ EMPTY, PER SOURCE. One module's failed read must not empty the
 * whole queue, and must not let its own lane render as "nothing due". Each
 * read's error is bound into the source's outcome: `pending` when the
 * deployment is behind a migration (a known state with a named operator move —
 * `assignee_user_id` arrived in 20260811000006 and IS in three of these select
 * strings), `failed` for everything else — collected into the `ReadFailureLog`
 * so the page can say which lanes to disbelieve.
 *
 * THIS MODULE WRITES NOTHING. No insert, no update, no status change. A queue
 * that could tick its own items off would be a queue nobody could trust.
 */

import type { ProjectAssigneeRoster } from "@/lib/projects/assignee-roster";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { sortDeadlineItemsBy } from "@/lib/work/deadlines";

import { MY_WORK_SOURCES, type MyWorkSource } from "./sources";
import {
  DEFAULT_MY_WORK_SCOPE,
  MY_WORK_BLOCK_IDS,
  type MyWorkBlockId,
  type MyWorkItem,
  type MyWorkResult,
  type MyWorkScope,
  type MyWorkSourceId,
  type MyWorkSourceOutcome,
} from "./types";

/**
 * Default per-source cap. A work queue is a page you act from, not an export:
 * the twenty soonest of each kind is a week's work, and eight uncapped reads on
 * one render is how a page falls over on an agency's thousandth milestone.
 */
export const MY_WORK_DEFAULT_LIMIT_PER_SOURCE = 20;
export const MY_WORK_MAX_LIMIT_PER_SOURCE = 100;

/**
 * How large a roster the "unassigned" scope can carry into its filter.
 *
 * Including work left behind by a DEPARTED member means asking the database for
 * rows whose assignee is not on the roster, which means sending the roster's
 * ids. That URL grows with the team, and a request that fails because a
 * workspace has a lot of people is worse than a disclosed narrowing — so past
 * this size the scope falls back to strictly-null assignees and the result says
 * `departedIncludedInUnassigned: false`, which the page discloses.
 */
export const MY_WORK_DEPARTED_FILTER_MAX_ROSTER = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The slice of a supabase-js query chain this module uses. Structural, like
 * every per-domain access module in this repo (`src/lib/models/api.ts`
 * convention): the client is untyped by design and results are cast.
 */
type WorkReadResult = {
  data: unknown;
  error: { message?: string | null } | null;
};

type WorkQuery = PromiseLike<WorkReadResult> & {
  eq(column: string, value: string): WorkQuery;
  neq(column: string, value: string): WorkQuery;
  in(column: string, values: readonly string[]): WorkQuery;
  is(column: string, value: null): WorkQuery;
  not(column: string, operator: string, value: unknown): WorkQuery;
  or(filter: string): WorkQuery;
  order(column: string, options: { ascending: boolean }): WorkQuery;
  limit(count: number): WorkQuery;
};

type WorkReadClient = {
  from(table: string): { select(columns: string): WorkQuery };
};

export type LoadMyWorkOptions = {
  workspaceId: string;
  /** The signed-in caller — whose queue "assigned to me" means. */
  userId: string;
  scope?: MyWorkScope;
  /**
   * The workspace roster as the page read it (service role, behind
   * `loadWorkspaceRoster`'s caller-membership check). Only the `unassigned`
   * scope consults it, to include work left by departed members.
   */
  roster: ProjectAssigneeRoster;
  /** Per-source cap, clamped to 1..MY_WORK_MAX_LIMIT_PER_SOURCE. */
  limitPerSource?: number;
  /** Injectable clock — every overdue test in this module reads it, none calls Date.now() directly. */
  now?: Date;
};

function clampLimit(requested: number | undefined): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    !Number.isInteger(requested) ||
    requested < 1
  ) {
    return MY_WORK_DEFAULT_LIMIT_PER_SOURCE;
  }
  return Math.min(requested, MY_WORK_MAX_LIMIT_PER_SOURCE);
}

/**
 * What "unassigned" can be asked of the database, given what is known about the
 * team. Returns null when the roster cannot support the departed clause — the
 * caller then narrows to strictly-null and discloses it.
 */
export function buildDepartedAwareUnassignedFilter(
  roster: ProjectAssigneeRoster,
  column: string
): string | null {
  if (!roster.ok) return null;
  if (roster.members.length > MY_WORK_DEPARTED_FILTER_MAX_ROSTER) return null;

  const ids = roster.members.map((member) => member.userId);
  // Ids are interpolated into a PostgREST filter string, so they are checked
  // against the uuid shape first. They come from the database, not from a
  // request — this is the belt to that braces, and a roster that somehow
  // carried anything else narrows the scope honestly instead of building a
  // filter out of it.
  if (!ids.every((id) => UUID_PATTERN.test(id))) return null;
  if (ids.length === 0) return `${column}.is.null`;

  return `${column}.is.null,${column}.not.in.(${ids.join(",")})`;
}

function applyScope(
  query: WorkQuery,
  source: MyWorkSource,
  options: { scope: MyWorkScope; userId: string; roster: ProjectAssigneeRoster }
): { query: WorkQuery; departedIncluded: boolean } {
  const column = source.assigneeColumn;
  // A source with no assignee column is not a statement about people, so no
  // scope applies to it: the workspace's grant, obligation and invoice
  // deadlines are the same list whichever toggle is selected.
  if (!column) return { query, departedIncluded: true };

  if (options.scope === "assigned") {
    return { query: query.eq(column, options.userId), departedIncluded: true };
  }

  if (options.scope === "unassigned") {
    const filter = buildDepartedAwareUnassignedFilter(options.roster, column);
    if (!filter) return { query: query.is(column, null), departedIncluded: false };
    return { query: query.or(filter), departedIncluded: true };
  }

  return { query, departedIncluded: true };
}

function applyStaticFilters(query: WorkQuery, source: MyWorkSource): WorkQuery {
  let next = query;
  for (const filter of source.staticFilters) {
    if (filter.kind === "eq") next = next.eq(filter.column, filter.value);
    else if (filter.kind === "neq") next = next.neq(filter.column, filter.value);
    else if (filter.kind === "notNull") next = next.not(filter.column, "is", null);
    else if (filter.kind === "in") next = next.in(filter.column, filter.values);
    else next = next.not(filter.column, "in", `(${filter.values.join(",")})`);
  }
  return next;
}

async function readSource(
  client: WorkReadClient,
  source: MyWorkSource,
  options: {
    workspaceId: string;
    userId: string;
    scope: MyWorkScope;
    roster: ProjectAssigneeRoster;
    limitPerSource: number;
  }
): Promise<{ result: WorkReadResult; departedIncluded: boolean }> {
  try {
    const base = client
      .from(source.table)
      .select(source.select)
      .eq(source.workspaceFilterColumn, options.workspaceId);
    const scoped = applyScope(base, source, options);
    const filtered = applyStaticFilters(scoped.query, source);
    const readLimit = source.readLimit
      ? source.readLimit(options.limitPerSource)
      : options.limitPerSource;
    const result = await filtered
      .order(source.orderColumn, { ascending: source.orderAscending })
      .limit(readLimit);
    return { result, departedIncluded: scoped.departedIncluded };
  } catch (error) {
    // A thrown read (network, malformed response) is still a failed read, not
    // an empty source; shape it like one so the classification below sees it.
    return {
      result: {
        data: null,
        error: { message: error instanceof Error ? error.message : "read threw" },
      },
      departedIncluded: true,
    };
  }
}

/**
 * Two sources can describe the SAME obligation: a funding award's
 * `obligation_due_at` and the obligation milestone mirroring it
 * (20260416000053). When both are present the PROJECT RECORD wins, because it
 * is the one a person can be assigned and the one that carries a status — and
 * the award row is dropped rather than shown a second time in the workspace
 * block. When the milestone is filtered out by the current scope (it belongs to
 * someone else), the award row survives, which is right: the workspace still
 * has that deadline.
 */
function deduplicate(items: MyWorkItem[]): MyWorkItem[] {
  const claimedByProjectRecord = new Set(
    items
      .filter((item) => item.block !== "workspace_deadlines" && item.dedupKey)
      .map((item) => item.dedupKey as string)
  );
  return items.filter(
    (item) =>
      !(
        item.block === "workspace_deadlines" &&
        item.dedupKey !== null &&
        claimedByProjectRecord.has(item.dedupKey)
      )
  );
}

/** Blocks that are ordered by deadline; the other two keep their read order. */
const DEADLINE_ORDERED_BLOCKS: readonly MyWorkBlockId[] = ["deadlines", "workspace_deadlines"];

function orderBlock(blockId: MyWorkBlockId, items: MyWorkItem[]): MyWorkItem[] {
  if (!DEADLINE_ORDERED_BLOCKS.includes(blockId)) return items;
  return sortDeadlineItemsBy(items, (item) => ({
    // The far-future sentinel `sortByEarliestDate` uses, so an item that
    // somehow arrives undated sorts last rather than as the epoch — i.e. as
    // the most overdue thing on the page.
    deadlineAt: item.dueOn ?? "9999-12-31",
    isOverdue: item.isOverdue,
  }));
}

/**
 * Read the queue. Every queried source appears in `perSource` — with its item
 * count, or with the honest reason it contributed nothing — and `items` holds
 * the per-source-capped union, grouped by block, ordered within each block.
 */
export async function loadMyWork(
  supabase: unknown,
  options: LoadMyWorkOptions
): Promise<MyWorkResult> {
  const client = supabase as WorkReadClient;
  const limitPerSource = clampLimit(options.limitPerSource);
  const scope = options.scope ?? DEFAULT_MY_WORK_SCOPE;
  const now = options.now ?? new Date();

  const reads = new ReadFailureLog();
  const outcomes = await Promise.all(
    MY_WORK_SOURCES.map((source) =>
      readSource(client, source, {
        workspaceId: options.workspaceId,
        userId: options.userId,
        scope,
        roster: options.roster,
        limitPerSource,
      })
    )
  );

  const collected: MyWorkItem[] = [];
  const perSource: Partial<Record<MyWorkSourceId, MyWorkSourceOutcome>> = {};
  let departedIncludedInUnassigned = true;

  MY_WORK_SOURCES.forEach((source, index) => {
    const { result, departedIncluded } = outcomes[index];
    if (!departedIncluded) departedIncludedInUnassigned = false;
    // Classify first (a pending migration has a truer thing to say than "could
    // not be read"), collect what is left.
    const pending = looksLikePendingSchema(result.error?.message);
    const failed = pending ? false : reads.check(source.readLabel, result);
    const rows = pending || failed ? [] : ((result.data ?? []) as Array<Record<string, unknown>>);
    collected.push(...source.toItems(rows, { now, limitPerSource }));
    perSource[source.id] = { count: 0, pending, failed };
  });

  const kept = deduplicate(collected);

  // Counts are what RENDERS, so they are taken after de-duplication — an
  // outcome saying "3" beside two visible rows is a report about the loader
  // rather than about the workspace.
  for (const item of kept) {
    const outcome = perSource[item.sourceId];
    if (outcome) outcome.count += 1;
  }

  const items = MY_WORK_BLOCK_IDS.flatMap((blockId) =>
    orderBlock(
      blockId,
      kept.filter((item) => item.block === blockId)
    )
  );

  return {
    scope,
    items,
    reads,
    perSource,
    limitPerSource,
    departedIncludedInUnassigned: scope === "unassigned" ? departedIncludedInUnassigned : true,
  };
}
