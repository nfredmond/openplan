import fs from "node:fs";
import path from "node:path";

/**
 * A fake Supabase surface for the deadline sweep — small, but with two
 * properties that decide whether the tests above it prove anything.
 *
 * 1. IT APPLIES THE FILTERS. A recorder that returns its fixture whatever was
 *    asked (`.eq()` ignored) is this repo's recorded reason 34 of 64 mutations
 *    tested nothing: the assertion passes with the filter deleted. So `eq`,
 *    `neq`, `not(is null)`, `not(in …)`, `lte`, `in`, `order` and `limit` all
 *    do what they say, and a fixture row that should have been filtered out is
 *    genuinely absent.
 *
 * 2. ITS UNIQUENESS COMES FROM THE MIGRATIONS. Stage one retains the index
 *    from 20260811000007 and adds the kind-aware key in 20261018000001.
 *    A fake that de-duplicated on a
 *    hardcoded key would keep the double-run test green with the index deleted,
 *    which is the exact shape of a guard that proves nothing. {@link
 *    workNotificationUniqueKey} reads each index out of the corpus, with SQL
 *    comments blanked first, because a `--` line describing the index is not
 *    the index. Legacy targeted upserts still model 42P10 and non-target
 *    23505. The batch RPC instead models targetless insertion and explicitly
 *    classifies each request. This does not execute PostgreSQL or PostgREST.
 */

import { blankComments, migrationFiles, readMigration } from "../migrations/read-migrations";

export const WORK_NOTIFICATIONS_MIGRATION = "20260811000007_work_notifications.sql";

/**
 * The columns of the unique index on `work_notifications`, as the migration
 * declares them. Empty when there is no such index — which is what makes the
 * mutation visible rather than absorbed.
 */
export function workNotificationUniqueKey(index = "ux_work_notifications_subject_recipient_kind"): string[] {
  let key: string[] = [];
  for (const file of migrationFiles()) {
    const sql = blankComments(readMigration(file));
    if (new RegExp(`DROP\\s+INDEX\\s+(?:public\\.)?${index}\\b`, "i").test(sql)) key = [];
    const match = sql.match(new RegExp(`CREATE\\s+UNIQUE\\s+INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${index}\\s+ON\\s+(?:public\\.)?work_notifications\\s*\\(([^)]*)\\)`, "i"));
    if (match) key = match[1].split(",").map((column) => column.trim());
  }
  return key;
}

/**
 * The `kind` values the CHECK constraint accepts AFTER the whole corpus has
 * been applied. The code holds a copy; this is what stops the copy drifting
 * into a sweep whose every insert is rejected.
 *
 * WHY IT SCANS EVERY MIGRATION rather than only the create-table one. The
 * vocabulary grows: 20260812000010 drops the inline CHECK and re-adds it with a
 * seventh kind, and a reader pinned to 20260811000007 would report the
 * six-value list — i.e. it would call the NEW kind illegal and fail a sweep
 * that the database accepts, or (worse, in the other direction) pass a stale
 * list while the constraint had moved on. Files are walked in filename order,
 * which is application order, and the LAST declaration wins exactly as it does
 * in Postgres.
 */
export function migrationKindVocabulary(): string[] {
  // Both spellings the corpus uses for this constraint: the inline column CHECK
  // in the create-table, and a named ADD CONSTRAINT that replaces it. Anchored
  // on `work_notifications` in the same statement so another table's `kind`
  // vocabulary can never answer here.
  const declarations = [
    /CREATE\s+TABLE[^;]*?\bwork_notifications\b[^;]*?\bkind\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/gi,
    /ALTER\s+TABLE\s+(?:public\.)?work_notifications\s+ADD\s+CONSTRAINT\s+[A-Za-z0-9_]+\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/gi,
  ];

  let latest: string | null = null;
  for (const file of migrationFiles()) {
    const sql = blankComments(readMigration(file));
    if (!/work_notifications/i.test(sql)) continue;
    // Within a file, order is byte offset — two declarations in one migration
    // apply in the order they are written, not in the order this array lists
    // the two spellings.
    const inFile: Array<{ at: number; values: string }> = [];
    for (const pattern of declarations) {
      pattern.lastIndex = 0;
      for (const match of sql.matchAll(pattern)) {
        inFile.push({ at: match.index ?? 0, values: match[1] });
      }
    }
    inFile.sort((left, right) => left.at - right.at);
    if (inFile.length > 0) latest = inFile[inFile.length - 1].values;
  }

  if (latest === null) return [];
  return latest
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

/** Reminder dates remain required; recorded changes have a separate event key. */
export function migrationRequiresReminderDueOn(): boolean {
  const sql = blankComments(readMigration("20261018000001_grant_deadline_changes.sql"));
  return /kind <> 'grant_deadline_changed' AND deadline_change_id IS NULL AND due_on IS NOT NULL/.test(sql);
}

/** Every migration file, so a test can assert this one is actually present. */
export function migrationExists(): boolean {
  return fs.existsSync(
    path.join(process.cwd(), "supabase", "migrations", WORK_NOTIFICATIONS_MIGRATION)
  );
}

type Row = Record<string, unknown>;

/** Model only the relational row cap, not byte limits or real HTTP behavior. */
export function capWorkRpcRows(data: unknown, maxRows: number): unknown {
  return Array.isArray(data) ? data.slice(0, maxRows) : data;
}

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "notNull"; column: string }
  | { kind: "notIn"; column: string; values: string[] }
  | { kind: "lte"; column: string; value: string }
  | { kind: "in"; column: string; values: readonly string[] };

export type RecordedRead = {
  table: string;
  select: string;
  filters: Filter[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
};

function compare(left: unknown, right: unknown): number {
  const leftTime = Date.parse(String(left));
  const rightTime = Date.parse(String(right));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function passes(row: Row, filter: Filter): boolean {
  const value = row[filter.column];
  switch (filter.kind) {
    case "eq":
      return value === filter.value;
    case "neq":
      return value !== filter.value;
    case "notNull":
      return value !== null && value !== undefined;
    case "notIn":
      return !filter.values.includes(String(value));
    case "lte":
      return compare(value, filter.value) <= 0;
    case "in":
      return filter.values.includes(String(value));
  }
}

export type FakeWorkDbOptions = {
  tables: Record<string, Row[]>;
  /** Per-table read errors, so a source can fail while the others succeed. */
  errors?: Record<string, { message: string }>;
  /** Overrides all migration-derived keys for guard controls. */
  uniqueKey?: string[];
  /** The corpus installs bridge. Active models the separate proposed migration. */
  reminderStage?: "bridge" | "active";
  activationResult?: { data: unknown; error: { message: string } | null };
  reminderWriteResult?: (envelope: Row) => unknown;
  activateBeforeWrite?: boolean;
  rpcMaxRows?: number;
};

export class FakeWorkDb {
  readonly reads: RecordedRead[] = [];
  readonly notifications: Row[] = [];
  readonly outbox: Row[] = [];
  /** Every upsert attempt, whether or not it created anything. */
  readonly upsertCalls: Array<{ rows: Row[]; onConflict: string; ignoreDuplicates: boolean }> = [];
  readonly rpcCalls: string[] = [];
  readonly reminderWriteCalls: Array<{ rows: readonly Row[] }> = [];
  readonly reminderWriteResponses: unknown[] = [];

  private readonly tables: Record<string, Row[]>;
  private readonly errors: Record<string, { message: string }>;
  private readonly uniqueKeys: string[][];
  private readonly activationResult: { data: unknown; error: { message: string } | null };
  private readonly reminderWriteResult?: (envelope: Row) => unknown;
  private readonly activateBeforeWrite: boolean;
  private readonly rpcMaxRows: number;
  private outboxSequence = 0;

  constructor(options: FakeWorkDbOptions) {
    this.tables = options.tables;
    this.errors = options.errors ?? {};
    this.uniqueKeys = options.uniqueKey ? [options.uniqueKey] : [
      workNotificationUniqueKey(),
      ...(options.reminderStage === "active" ? [] : [workNotificationUniqueKey("ux_work_notifications_subject_recipient")]),
    ];
    this.activationResult = options.activationResult ?? { data: options.reminderStage === "active", error: null };
    this.reminderWriteResult = options.reminderWriteResult;
    this.activateBeforeWrite = options.activateBeforeWrite ?? false;
    this.rpcMaxRows = options.rpcMaxRows ?? 1000;
  }

  async rpc(name: string, args?: { p_rows: readonly Row[] }) {
    this.rpcCalls.push(name);
    if (name === "work_notification_kind_activation") return this.activationResult;
    if (name !== "insert_work_notification_reminders" || !args) throw new Error(`Unexpected RPC: ${name}`);
    this.reminderWriteCalls.push({ rows: args.p_rows });
    if (this.errors.work_notifications) return { data: null, error: this.errors.work_notifications };
    const keys = this.activateBeforeWrite ? [workNotificationUniqueKey()] : this.uniqueKeys;
    if (!keys.some((key) => key.length === 5 && key.includes("kind"))) {
      return { data: null, error: { message: "work_reminder_kind_key_missing" } };
    }
    const staged: Row[] = [];
    const inserted = new Set<Row>();
    const equal = (left: Row, right: Row, key: readonly string[]) => key.length > 0 && key.every((field) =>
      left[field] !== null && left[field] !== undefined && left[field] === right[field]);
    // One targetless insert, then a separate classification read of current rows.
    for (const row of args.p_rows) {
      if ([...this.notifications, ...staged].some((existing) => keys.some((key) => equal(row, existing, key)))) continue;
      staged.push({ id: `notification-${this.notifications.length + staged.length + 1}`, ...row });
      inserted.add(row);
    }
    const outcomes: Row[] = [];
    const full = ["workspace_id", "subject_table", "subject_id", "recipient_user_id", "due_on", "kind"];
    const legacy = keys.find((key) => key.length === 4 && !key.includes("kind"));
    for (const row of args.p_rows) {
      const current = [...this.notifications, ...staged];
      const same = current.find((stored) => equal(row, stored, full));
      const opposite = legacy && current.find((stored) => stored.workspace_id === row.workspace_id && stored.kind !== row.kind && equal(row, stored, legacy));
      const classification = inserted.has(row) ? "inserted" : same ? "duplicate" : opposite ? "deferred_old_key" : null;
      if (!classification) return { data: null, error: { message: "work_reminder_classification_missing" } };
      outcomes.push({ ...row, classification, blocking_kind: classification === "deferred_old_key" && opposite ? opposite.kind : null });
    }
    this.notifications.push(...staged);
    const envelope = { protocol: "work_reminder_batch_v1", requested_count: args.p_rows.length,
      inserted_count: outcomes.filter((row) => row.classification === "inserted").length,
      duplicate_count: outcomes.filter((row) => row.classification === "duplicate").length,
      deferred_count: outcomes.filter((row) => row.classification === "deferred_old_key").length, outcomes };
    const data = capWorkRpcRows(this.reminderWriteResult ? this.reminderWriteResult(envelope) : envelope, this.rpcMaxRows);
    this.reminderWriteResponses.push(data);
    return { data, error: null };
  }

  /** The auth-admin surface the real roster helper resolves emails through. */
  readonly auth = {
    admin: {
      getUserById: async (id: string) => ({
        data: { user: { email: this.emails.get(id) ?? null } },
      }),
    },
  };

  readonly emails = new Map<string, string | null>();

  from(table: string) {
    return {
      select: (columns: string) => this.query(table, columns),
      upsert: (rows: Row[], options: { onConflict: string; ignoreDuplicates: boolean }) => {
        this.upsertCalls.push({ rows, ...options });
        return {
          // Stored rows stay complete; callers receive the flat columns they requested.
          select: async (columns: string) => {
            if (this.errors[table]) return { data: null, error: this.errors[table] };
            const target = options.onConflict.split(",").map((column) => column.trim()).sort().join(",");
            if (!this.uniqueKeys.some((key) => key.length > 0 && [...key].sort().join(",") === target)) {
              return { data: null, error: { message: "42P10: no unique or exclusion constraint matching the ON CONFLICT specification" } };
            }
            const created: Row[] = [];
            const staged: Row[] = [];
            for (const row of rows) {
              const conflicts = this.uniqueKeys.filter((key) => key.length > 0 &&
                key.every((column) => row[column] !== null && row[column] !== undefined) &&
                [...this.notifications, ...staged].some((existing) => key.every((column) => existing[column] === row[column])));
              const targetConflict = conflicts.some((key) => [...key].sort().join(",") === target);
              if (targetConflict && options.ignoreDuplicates) continue;
              if (conflicts.length > 0) return { data: null, error: { message: "23505: conflict with a different unique index" } };
              const stored: Row = { id: `notification-${this.notifications.length + staged.length + 1}`, ...row };
              staged.push(stored);
              created.push(columns.trim() === "*" ? { ...stored } : Object.fromEntries(
                columns.split(",").map((column) => column.trim()).map((column) => [column, stored[column]])
              ));
            }
            this.notifications.push(...staged);
            return { data: created, error: null };
          },
        };
      },
      insert: (row: Row) => ({
        select: (_columns: string) => ({
          single: async () => {
            this.outboxSequence += 1;
            const stored = { id: `outbox-${this.outboxSequence}`, ...row };
            if (table === "engagement_email_outbox") this.outbox.push(stored);
            return { data: { id: stored.id }, error: null };
          },
        }),
      }),
      update: (patch: Row) => {
        const apply = (id: unknown) => {
          const target = this.outbox.find((row) => row.id === id);
          if (target) Object.assign(target, patch);
          return { data: null, error: null };
        };
        const chain = {
          eq: (_column: string, value: unknown) => ({
            then: (resolve: (result: unknown) => unknown) => resolve(apply(value)),
          }),
        };
        return chain;
      },
    };
  }

  private query(table: string, columns: string) {
    const record: RecordedRead = { table, select: columns, filters: [], order: null, limit: null };
    this.reads.push(record);

    const resolve = () => {
      if (this.errors[table]) return { data: null, error: this.errors[table] };
      let rows = (this.tables[table] ?? []).filter((row) =>
        record.filters.every((filter) => passes(row, filter))
      );
      if (record.order) {
        const { column, ascending } = record.order;
        rows = [...rows].sort((left, right) => compare(left[column], right[column]) * (ascending ? 1 : -1));
      }
      if (record.limit !== null) rows = rows.slice(0, record.limit);
      return { data: rows, error: null };
    };

    const chain = {
      eq(column: string, value: unknown) {
        record.filters.push({ kind: "eq", column, value });
        return chain;
      },
      neq(column: string, value: unknown) {
        record.filters.push({ kind: "neq", column, value });
        return chain;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator === "is") record.filters.push({ kind: "notNull", column });
        else {
          const values = String(value).replace(/^\(|\)$/g, "").split(",").filter(Boolean);
          record.filters.push({ kind: "notIn", column, values });
        }
        return chain;
      },
      lte(column: string, value: string) {
        record.filters.push({ kind: "lte", column, value });
        return chain;
      },
      in(column: string, values: readonly string[]) {
        record.filters.push({ kind: "in", column, values });
        return chain;
      },
      order(column: string, options: { ascending: boolean }) {
        record.order = { column, ascending: options.ascending };
        return chain;
      },
      limit(count: number) {
        record.limit = count;
        return chain;
      },
      maybeSingle: async () => {
        const result = resolve();
        if (result.error) return { data: null, error: result.error };
        return { data: (result.data ?? [])[0] ?? null, error: null };
      },
      then: (onFulfilled: (result: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled),
    };

    return chain;
  }
}
