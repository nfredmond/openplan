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
 * 2. ITS UNIQUENESS COMES FROM THE MIGRATION. `work_notifications`' idempotency
 *    is a unique index in 20260811000007. A fake that de-duplicated on a
 *    hardcoded key would keep the double-run test green with the index deleted,
 *    which is the exact shape of a guard that proves nothing. {@link
 *    workNotificationUniqueKey} reads the index out of the migration — SQL
 *    comments blanked first, because a `--` line describing the index is not
 *    the index — so removing the line from the SQL removes the de-duplication
 *    here and the double-run test fails.
 */

import { blankComments, readMigration } from "../migrations/read-migrations";

export const WORK_NOTIFICATIONS_MIGRATION = "20260811000007_work_notifications.sql";

/**
 * The columns of the unique index on `work_notifications`, as the migration
 * declares them. Empty when there is no such index — which is what makes the
 * mutation visible rather than absorbed.
 */
export function workNotificationUniqueKey(): string[] {
  const sql = blankComments(readMigration(WORK_NOTIFICATIONS_MIGRATION));
  const match = sql.match(
    /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[A-Za-z0-9_]+\s+ON\s+(?:public\.)?work_notifications\s*\(([^)]*)\)/i
  );
  if (!match) return [];
  return match[1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

/**
 * The `kind` values the CHECK constraint accepts, as the migration declares
 * them. The code holds a copy; this is what stops the copy drifting into a
 * sweep whose every insert is rejected.
 */
export function migrationKindVocabulary(): string[] {
  const sql = blankComments(readMigration(WORK_NOTIFICATIONS_MIGRATION));
  const match = sql.match(/kind\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

/** Whether `due_on` is declared NOT NULL — see the test that asks. */
export function migrationDeclaresNotNullDueOn(): boolean {
  const sql = blankComments(readMigration(WORK_NOTIFICATIONS_MIGRATION));
  return /\bdue_on\s+date\s+NOT\s+NULL\b/i.test(sql);
}

/** Every migration file, so a test can assert this one is actually present. */
export function migrationExists(): boolean {
  return fs.existsSync(
    path.join(process.cwd(), "supabase", "migrations", WORK_NOTIFICATIONS_MIGRATION)
  );
}

type Row = Record<string, unknown>;

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
  /** Overrides the migration-derived key; only the guard-the-guard test uses it. */
  uniqueKey?: string[];
};

export class FakeWorkDb {
  readonly reads: RecordedRead[] = [];
  readonly notifications: Row[] = [];
  readonly outbox: Row[] = [];
  /** Every upsert attempt, whether or not it created anything. */
  readonly upsertCalls: Array<{ rows: Row[]; onConflict: string; ignoreDuplicates: boolean }> = [];

  private readonly tables: Record<string, Row[]>;
  private readonly errors: Record<string, { message: string }>;
  private readonly uniqueKey: string[];
  private outboxSequence = 0;

  constructor(options: FakeWorkDbOptions) {
    this.tables = options.tables;
    this.errors = options.errors ?? {};
    this.uniqueKey = options.uniqueKey ?? workNotificationUniqueKey();
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
          select: async (_columns: string) => {
            if (this.errors[table]) return { data: null, error: this.errors[table] };
            const created: Row[] = [];
            for (const row of rows) {
              // No key columns (the index was removed) => nothing is a
              // duplicate, which is precisely the regression.
              const key = this.uniqueKey.map((column) => String(row[column])).join("::");
              const exists =
                this.uniqueKey.length > 0 &&
                this.notifications.some(
                  (existing) => this.uniqueKey.map((column) => String(existing[column])).join("::") === key
                );
              if (exists && options.ignoreDuplicates) continue;
              const stored = { id: `notification-${this.notifications.length + 1}`, ...row };
              this.notifications.push(stored);
              created.push(stored);
            }
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
