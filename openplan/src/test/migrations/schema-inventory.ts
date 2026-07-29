import {
  MIGRATIONS_DIR,
  blankComments,
  matchingParen,
  migrationFiles,
  readMigration,
  splitTopLevel,
} from "./read-migrations";

/**
 * What columns each relation has, which ones enable RLS, and which tables point
 * at which — read from the migrations rather than from a database.
 *
 * This exists because of a defect no unit test could see: the project-delete
 * precondition counted rows with `.select("id", { count: "exact", head: true })`
 * over a DYNAMIC table name, and two of the 33 tables in that list have no `id`
 * column at all (`data_dataset_project_links` is a pure join table,
 * `aerial_project_posture` is keyed by `project_id`). Every delete answered 503.
 * A mocked Supabase client cannot catch it, because a mock returns whatever
 * column it is asked for.
 *
 * Reading the migrations rather than the database is the point: `npm run
 * qa:gate` has no database, and the live RLS job runs nightly. A guard that
 * cannot block a merge cannot prevent this class of defect.
 *
 * VIEWS ARE DELIBERATELY NOT COLUMN-PARSED. Four of the five in this repo would
 * need a real SELECT-list parser (CTEs, `SELECT *`, `DISTINCT ON`, expression
 * aliases) and a half-working one would report a smaller column set, which is
 * the silent-shrink failure this whole module tree exists to avoid. Instead a
 * view is a known relation with UNKNOWN columns: `columns()` returns undefined,
 * callers must handle that explicitly, and `migration-schema-drift.test.ts`
 * checks views against `information_schema` in the nightly live run.
 */

const CONSTRAINT_KEYWORDS = new Set([
  "constraint",
  "primary",
  "unique",
  "foreign",
  "check",
  "exclude",
  "like",
]);

export type SchemaInventory = {
  /** Tables and views the migrations declare. */
  relations(): string[];
  tables(): string[];
  views(): string[];
  isView(name: string): boolean;
  /** Undefined when the relation is unknown, or is a view (columns not parsed). */
  columns(relation: string): ReadonlySet<string> | undefined;
  hasColumn(relation: string, column: string): boolean;
  rlsEnabled(table: string): boolean;
  /** Tables carrying a foreign key into `parent`. */
  childrenOf(parent: string): string[];
};

function bare(name: string): string {
  return name.replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
}

export function loadSchemaInventory(options: { dir?: string } = {}): SchemaInventory {
  const dir = options.dir ?? MIGRATIONS_DIR;

  const tableColumns = new Map<string, Set<string>>();
  const viewNames = new Set<string>();
  const rlsTables = new Set<string>();
  const parents = new Map<string, Set<string>>();

  const noteReferences = (child: string, ddl: string) => {
    for (const match of ddl.matchAll(/\bREFERENCES\s+(?:public\.)?"?([A-Za-z0-9_]+)"?/gi)) {
      const parent = bare(match[1]);
      const existing = parents.get(parent) ?? new Set<string>();
      existing.add(child);
      parents.set(parent, existing);
    }
  };

  for (const file of migrationFiles(dir)) {
    const sql = blankComments(readMigration(file, dir));

    // CREATE TABLE [IF NOT EXISTS] [public.]<name> ( … )
    for (const match of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi
    )) {
      const table = bare(match[1]);
      const open = (match.index ?? 0) + match[0].length - 1;
      const afterClose = matchingParen(sql, open);
      if (afterClose === -1) continue;

      const body = sql.slice(open + 1, afterClose - 1);
      const columns = tableColumns.get(table) ?? new Set<string>();

      for (const part of splitTopLevel(body, ",")) {
        const trimmed = part.trim();
        const name = trimmed.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+\S/);
        if (!name) continue;
        if (CONSTRAINT_KEYWORDS.has(name[1].toLowerCase())) continue;
        columns.add(name[1].toLowerCase());
      }

      tableColumns.set(table, columns);
      noteReferences(table, body);
    }

    // CREATE [OR REPLACE] VIEW [public.]<name>
    for (const match of sql.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?([A-Za-z0-9_]+)"?/gi
    )) {
      viewNames.add(bare(match[1]));
    }

    // ALTER TABLE [IF EXISTS] [ONLY] [public.]<name> <clause>[, <clause>…];
    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?([^;]*);/gi
    )) {
      const table = bare(match[1]);
      const clauses = match[2];

      if (/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(clauses)) rlsTables.add(table);
      if (/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(clauses)) rlsTables.delete(table);

      const columns = tableColumns.get(table) ?? new Set<string>();
      for (const clause of splitTopLevel(clauses, ",")) {
        const added = clause.match(
          /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/i
        );
        if (added) columns.add(added[1].toLowerCase());

        const dropped = clause.match(
          /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/i
        );
        if (dropped) columns.delete(dropped[1].toLowerCase());
      }
      if (columns.size) tableColumns.set(table, columns);

      noteReferences(table, clauses);
    }
  }

  const relations = [...new Set([...tableColumns.keys(), ...viewNames])].sort();

  const columnsOf = (relation: string) => {
    const key = bare(relation);
    if (viewNames.has(key)) return undefined;
    return tableColumns.get(key);
  };

  return {
    relations: () => relations,
    tables: () => [...tableColumns.keys()].sort(),
    views: () => [...viewNames].sort(),
    isView: (name) => viewNames.has(bare(name)),
    columns: columnsOf,
    hasColumn: (relation, column) => columnsOf(relation)?.has(column.toLowerCase()) ?? false,
    rlsEnabled: (table) => rlsTables.has(bare(table)),
    childrenOf: (parent) => [...(parents.get(bare(parent)) ?? new Set<string>())].sort(),
  };
}
