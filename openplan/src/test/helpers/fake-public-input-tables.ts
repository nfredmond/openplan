/**
 * A small in-memory database that EVALUATES the PostgREST filters the public
 * engagement routes send, for the abuse-limit tests.
 *
 * The limits in those routes are only as good as the filters they send: a cap
 * counted with the wrong column, a missing `item_id`, or a `like` pattern that
 * matches nothing all pass a mock that answers a fixed count. This fake keeps
 * rows, applies each filter to them, enforces the unique keys it is told about,
 * caps responses at 1,000 rows as PostgREST does, and records every query so a
 * test can also assert what was asked.
 *
 * Supported: select (with `count: "exact"` and `head`), insert, update, delete,
 * upsert; eq, neq, gt, gte, lt, lte, in, is, like, or (eq and like members),
 * order, limit, range, single, maybeSingle. Columns may use `a->>b` JSON paths.
 * Projections are recorded, not applied, except `alias:a->>b`, which is.
 *
 * Every await yields to the event loop first, so parallel requests interleave
 * the way they do against a real database.
 */

import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;
export type FakeError = { message: string; code?: string };

export type FakeQuery = {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  projection: string | null;
  countMode: string | null;
  head: boolean;
  ops: Array<{ verb: string; args: unknown[] }>;
};

type Filter = (row: Row) => boolean;

export type FakeDatabaseOptions = {
  /** Unique keys per table, each a list of columns. */
  unique?: Record<string, string[][]>;
  /** Clock for default timestamps. */
  now?: () => Date;
  /** Return an error for a query instead of running it. */
  failWhen?: (query: FakeQuery) => FakeError | null;
  maxRows?: number;
};

function read(row: Row, column: string): unknown {
  const arrow = column.indexOf("->>");
  if (arrow === -1) return row[column];
  const base = row[column.slice(0, arrow)];
  const key = column.slice(arrow + 3);
  if (!base || typeof base !== "object") return null;
  const value = (base as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function same(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return false;
  return String(left) === String(right);
}

function compare(left: unknown, right: unknown): number {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** `a.eq.x,b.like.y*` -> one predicate that passes when any member does. */
function parseOr(expression: string): Filter {
  const members = expression.split(",").map((part) => {
    const first = part.indexOf(".");
    const second = part.indexOf(".", first + 1);
    const column = part.slice(0, first);
    const operator = part.slice(first + 1, second);
    const value = part.slice(second + 1);
    if (operator === "eq") return (row: Row) => same(read(row, column), value);
    if (operator === "like") return (row: Row) => likeToRegExp(value).test(String(read(row, column) ?? ""));
    throw new Error(`fake or(): unsupported operator ${operator}`);
  });
  return (row) => members.some((member) => member(row));
}

export function createFakePublicInputDatabase(initial: Record<string, Row[]> = {}, options: FakeDatabaseOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((row) => ({ ...row }));
  const queries: FakeQuery[] = [];
  const now = options.now ?? (() => new Date());
  const maxRows = options.maxRows ?? 1000;
  const storage = new Map<string, Map<string, { created_at: string; size: number }>>();

  const table = (name: string) => (tables[name] ??= []);

  function withDefaults(name: string, row: Row): Row {
    const stamp = now().toISOString();
    return {
      id: randomUUID(),
      created_at: stamp,
      ...(name === "usage_events" ? { occurred_at: stamp } : {}),
      ...row,
    };
  }

  function violatesUnique(name: string, row: Row, ignore?: Row): boolean {
    return (options.unique?.[name] ?? []).some((columns) =>
      table(name).some((existing) => existing !== ignore && columns.every((column) => same(existing[column], row[column])))
    );
  }

  function from(name: string) {
    const query: FakeQuery = { table: name, action: "select", projection: null, countMode: null, head: false, ops: [] };
    queries.push(query);
    const filters: Filter[] = [];
    let payload: Row[] = [];
    let patch: Row = {};
    let returning = false;
    let single: "single" | "maybeSingle" | null = null;
    let order: { column: string; ascending: boolean } | null = null;
    let limit: number | null = null;
    let range: [number, number] | null = null;

    const record = (verb: string, args: unknown[]) => query.ops.push({ verb, args });

    const builder = {
      select(projection?: string, opts?: { count?: string; head?: boolean }) {
        if (query.action === "select") {
          query.projection = projection ?? null;
          query.countMode = opts?.count ?? null;
          query.head = Boolean(opts?.head);
        } else {
          returning = true;
        }
        record("select", [projection, opts]);
        return builder;
      },
      insert(rows: Row | Row[]) {
        query.action = "insert";
        payload = (Array.isArray(rows) ? rows : [rows]).map((row) => withDefaults(name, row));
        record("insert", [rows]);
        return builder;
      },
      upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
        query.action = "upsert";
        payload = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row }));
        record("upsert", [rows, opts]);
        return builder;
      },
      update(values: Row) {
        query.action = "update";
        patch = values;
        record("update", [values]);
        return builder;
      },
      delete() {
        query.action = "delete";
        record("delete", []);
        return builder;
      },
      eq(column: string, value: unknown) {
        record("eq", [column, value]);
        filters.push((row) => same(read(row, column), value));
        return builder;
      },
      neq(column: string, value: unknown) {
        record("neq", [column, value]);
        filters.push((row) => !same(read(row, column), value));
        return builder;
      },
      gt(column: string, value: unknown) {
        record("gt", [column, value]);
        filters.push((row) => read(row, column) != null && compare(read(row, column), value) > 0);
        return builder;
      },
      gte(column: string, value: unknown) {
        record("gte", [column, value]);
        filters.push((row) => read(row, column) != null && compare(read(row, column), value) >= 0);
        return builder;
      },
      lt(column: string, value: unknown) {
        record("lt", [column, value]);
        filters.push((row) => read(row, column) != null && compare(read(row, column), value) < 0);
        return builder;
      },
      lte(column: string, value: unknown) {
        record("lte", [column, value]);
        filters.push((row) => read(row, column) != null && compare(read(row, column), value) <= 0);
        return builder;
      },
      in(column: string, values: unknown[]) {
        record("in", [column, values]);
        filters.push((row) => values.some((value) => same(read(row, column), value)));
        return builder;
      },
      is(column: string, value: null) {
        record("is", [column, value]);
        filters.push((row) => (read(row, column) ?? null) === value);
        return builder;
      },
      like(column: string, pattern: string) {
        record("like", [column, pattern]);
        filters.push((row) => likeToRegExp(pattern).test(String(read(row, column) ?? "")));
        return builder;
      },
      or(expression: string) {
        record("or", [expression]);
        filters.push(parseOr(expression));
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        record("order", [column, opts]);
        order = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit(count: number) {
        record("limit", [count]);
        limit = count;
        return builder;
      },
      range(start: number, end: number) {
        record("range", [start, end]);
        range = [start, end];
        return builder;
      },
      single() {
        record("single", []);
        single = "single";
        return builder;
      },
      maybeSingle() {
        record("maybeSingle", []);
        single = "maybeSingle";
        return builder;
      },
      then<T1, T2>(
        resolve: (value: { data: unknown; error: FakeError | null; count: number | null }) => T1,
        reject?: (reason: unknown) => T2
      ) {
        return new Promise((done) => setTimeout(done, 0)).then(() => execute()).then(resolve, reject);
      },
    };

    function project(rows: Row[]): Row[] {
      const aliases = (query.projection ?? "")
        .split(",")
        .map((part) => part.trim().match(/^(\w+):(.+->>.+)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match));
      if (aliases.length === 0) return rows.map((row) => ({ ...row }));
      return rows.map((row) => {
        const copy: Row = { ...row };
        for (const [, alias, path] of aliases) copy[alias] = read(row, path);
        return copy;
      });
    }

    function shape(rows: Row[], count: number | null) {
      if (single) {
        if (rows.length === 0) {
          return single === "single"
            ? { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }, count }
            : { data: null, error: null, count };
        }
        return { data: rows[0], error: null, count };
      }
      return { data: rows, error: null, count };
    }

    function execute() {
      const failure = options.failWhen?.(query) ?? null;
      if (failure) return { data: null, error: failure, count: null };
      const matching = () => table(name).filter((row) => filters.every((filter) => filter(row)));

      if (query.action === "insert") {
        for (const row of payload) {
          if (violatesUnique(name, row)) {
            return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" }, count: null };
          }
        }
        table(name).push(...payload);
        return shape(returning ? project(payload) : [], null);
      }
      if (query.action === "upsert") {
        const conflict = String((query.ops[0].args[1] as { onConflict?: string } | undefined)?.onConflict ?? "id").split(",");
        for (const row of payload) {
          const existing = table(name).find((candidate) => conflict.every((column) => same(candidate[column], row[column])));
          if (existing) Object.assign(existing, row);
          else table(name).push(withDefaults(name, row));
        }
        return shape([], null);
      }
      if (query.action === "update") {
        const rows = matching();
        for (const row of rows) Object.assign(row, patch);
        return shape(returning ? project(rows) : [], null);
      }
      if (query.action === "delete") {
        const rows = matching();
        tables[name] = table(name).filter((row) => !rows.includes(row));
        return shape(returning ? project(rows) : [], null);
      }

      let rows = matching();
      const count = query.countMode === "exact" ? rows.length : null;
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort((a, b) => compare(read(a, column), read(b, column)) * (ascending ? 1 : -1));
      }
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit !== null) rows = rows.slice(0, limit);
      rows = rows.slice(0, maxRows);
      if (query.head) return { data: null, error: null, count };
      return shape(project(rows), count);
    }

    return builder;
  }

  const storageClient = {
    from(bucket: string) {
      const objects = storage.get(bucket) ?? new Map<string, { created_at: string; size: number }>();
      storage.set(bucket, objects);
      return {
        async upload(path: string, bytes: Uint8Array, opts?: { upsert?: boolean }) {
          await new Promise((done) => setTimeout(done, 0));
          if (objects.has(path) && !opts?.upsert) return { data: null, error: { message: "The resource already exists" } };
          objects.set(path, { created_at: now().toISOString(), size: bytes.byteLength });
          return { data: { path }, error: null };
        },
        async list(folder: string, opts?: { limit?: number; search?: string }) {
          const prefix = `${folder}/`;
          const data = [...objects.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
            .map(([path, object]) => ({ name: path.slice(prefix.length), created_at: object.created_at }))
            .filter((object) => !opts?.search || object.name.includes(opts.search))
            .slice(0, opts?.limit ?? 100);
          return { data, error: null };
        },
        async remove(paths: string[]) {
          await new Promise((done) => setTimeout(done, 0));
          const removed = paths.filter((path) => objects.delete(path));
          return { data: removed.map((name) => ({ name })), error: null };
        },
      };
    },
  };

  return {
    client: { from, storage: storageClient },
    tables,
    table,
    queries,
    /** Stored object paths in a bucket. */
    objects: (bucket: string) => [...(storage.get(bucket)?.keys() ?? [])].sort(),
    /** Put an object in storage directly, as an earlier upload would have. */
    putObject: (bucket: string, path: string, createdAt: string, size = 1) => {
      const objects = storage.get(bucket) ?? new Map();
      objects.set(path, { created_at: createdAt, size });
      storage.set(bucket, objects);
    },
    queriesFor: (name: string) => queries.filter((query) => query.table === name),
  };
}

export type FakePublicInputDatabase = ReturnType<typeof createFakePublicInputDatabase>;
