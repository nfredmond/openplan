import { MIGRATIONS_DIR, blankComments, lineAt, migrationFiles, readMigration, splitTopLevel } from "./read-migrations";
import { expandDynamicGrantStatements } from "./plpgsql-expansion";
import { loadSchemaInventory } from "./schema-inventory";

/**
 * Replaying every table GRANT and REVOKE the migrations issue against the client
 * roles, in application order.
 *
 * WHY THIS EXISTS. On 2026-08-04, `20260804000002` restored client grants the
 * Supabase CLI had dropped by looping every table in `public` and issuing
 * `GRANT SELECT, INSERT, UPDATE, DELETE … TO anon, authenticated`. It then
 * re-asserted the deliberate revocations from two earlier migrations. The
 * repository contains roughly twenty-six such revocations. The other twenty-odd
 * were silently widened — including the column-scoped UPDATE gate on
 * `document_narrative_drafts`, which is the control that keeps a member from
 * writing a narrative draft's own grounding record.
 *
 * The lesson is not "blanket grants are bad". A platform can change default
 * privileges under a project at any time, and the answer to that WILL be another
 * blanket grant. The lesson is that a blanket grant is only correct if it
 * composes back to the audited posture, and nothing checked that.
 *
 * So the invariant this module serves is deliberately not a shape rule and not a
 * list of table names:
 *
 *   Any (table, role, privilege) that some migration REVOKED may be held at HEAD
 *   only if a later statement granted it BY NAME.
 *
 * A blanket grant can never satisfy a previously-denied triple, because a blanket
 * grant is by definition not about any particular table. The intended posture is
 * therefore derived from the migration corpus itself rather than copied into an
 * allowlist beside it — which matters, because guarding a COPY of the artifact is
 * exactly how the unarmed GTFS policies survived four months.
 *
 * Deliberately out of scope, each for a reason:
 *   - FUNCTION / SEQUENCE / SCHEMA privileges. Different object classes; a table
 *     inventory that silently absorbed them would answer questions it cannot.
 *   - `ALTER DEFAULT PRIVILEGES`. That governs tables which do not exist yet, and
 *     `20260804000001` already has its own live assertion in
 *     `policies-are-enforced-guard.test.ts`.
 *   - Roles other than the three client roles. `service_role` bypasses RLS by
 *     design and is not a client.
 *   - Privileges no migration ever revoked. Converging the bootstrap `arwdDxtm`
 *     residue on ~110 never-revoked tables is a much larger change with its own
 *     blast radius; see `20260805000005`'s header, where that is recorded as a
 *     decision rather than an oversight.
 */

/** The roles a browser or an anonymous visitor can ever be acting as. */
export const CLIENT_ROLES = ["anon", "authenticated", "public"] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];

/**
 * The table privileges `ALL` expands to.
 *
 * PostgreSQL 18's `MAINTAIN` is deliberately absent: Supabase runs 15/17, and a
 * privilege the server does not have would produce denials that can never be
 * checked against a live catalog.
 */
export const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;
export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

export type GrantEvent = {
  file: string;
  line: number;
  kind: "grant" | "revoke";
  /**
   * `named` — the statement names this table.
   * `blanket` — it reached the table through `ALL TABLES IN SCHEMA` or a loop
   * over the schema, and so says nothing about this table in particular.
   */
  reach: "named" | "blanket";
  table: string;
  role: ClientRole;
  privilege: TablePrivilege;
  /** Non-empty when the statement is column-scoped, which never confers the table privilege. */
  columns: readonly string[];
};

export type Denial = {
  table: string;
  role: ClientRole;
  privilege: TablePrivilege;
  /** The most recent statement that revoked it. */
  revokedBy: GrantEvent;
  /** The statement responsible for it being held at HEAD, or null when it is not held. */
  heldBy: GrantEvent | null;
  /** True when it is held and no by-name grant re-established it after the revoke. */
  violation: boolean;
};

/**
 * A privilege held on SOME columns of a table rather than the whole table.
 *
 * This is not a footnote. `document_narrative_drafts` is writable by members on
 * exactly four columns, and that column list is what stops a member editing the
 * grounding record their own draft is later accepted on. `has_table_privilege`
 * cannot see column grants at all, so a guard built only on table privileges
 * would report that control as present when it had been erased.
 */
export type ColumnGrant = {
  table: string;
  role: ClientRole;
  privilege: TablePrivilege;
  column: string;
  grantedBy: GrantEvent;
};

export type GrantInventory = {
  events(): readonly GrantEvent[];
  /** Every (table, role, privilege) some migration revoked, with its state at HEAD. */
  denials(): readonly Denial[];
  violations(): readonly Denial[];
  /** Column-scoped privileges held at HEAD. */
  columnGrants(): readonly ColumnGrant[];
  /** Tables named by at least one revoke. */
  revokedTables(): readonly string[];
};

const NON_TABLE_OBJECTS =
  /^\s*(?:ALL\s+(?:FUNCTIONS|SEQUENCES|ROUTINES|PROCEDURES)\b|FUNCTION\b|PROCEDURE\b|ROUTINE\b|SEQUENCE\b|SCHEMA\b|DATABASE\b|DOMAIN\b|TYPE\b|LARGE\s+OBJECT\b|TABLESPACE\b|FOREIGN\b|PARAMETER\b)/i;

function bareTable(name: string): string {
  return name.trim().replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
}

/** Index of `keyword` as a standalone word at paren depth 0 and outside strings, or -1. */
function findKeyword(text: string, keyword: string, from = 0): number {
  const pattern = new RegExp(`\\b${keyword}\\b`, "gi");
  let depth = 0;
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && i >= from) {
      pattern.lastIndex = i;
      const match = pattern.exec(text);
      if (match && match.index === i) return i;
    }
  }

  return -1;
}

type ParsedStatement = {
  kind: "grant" | "revoke";
  reach: "named" | "blanket";
  tables: string[];
  roles: ClientRole[];
  privileges: Array<{ privilege: TablePrivilege; columns: string[] }>;
};

/**
 * One GRANT/REVOKE statement, or null when it is not a table grant to a client role.
 *
 * Returning null is the ONLY silent outcome permitted here, and it is reserved for
 * statements that are provably not about table privileges for client roles. A
 * statement this function cannot understand at all must not become a null — it
 * would shrink the denial set, which is the failure mode the whole module exists
 * to avoid. Hence `throw` on a malformed table grant.
 */
export function parseGrantStatement(input: string): ParsedStatement | null {
  // The dynamic expander hands back terminated statements while the literal
  // scanner splits ON the terminator. Normalising here rather than at each call
  // site is not tidiness: without it `TO anon, authenticated;` parses its last
  // role as `authenticated;`, which matches no known role and is dropped — so
  // every `authenticated` denial silently vanished from the inventory while the
  // `anon` ones stayed. A parser that reports a smaller world is the one failure
  // this module may not have, and it had it.
  const text = input.replace(/;\s*$/, "");

  const verb = text.match(/^\s*(GRANT|REVOKE)\b/i);
  if (!verb) return null;

  const kind = verb[1].toLowerCase() === "grant" ? "grant" : "revoke";
  let rest = text.slice(verb.index! + verb[0].length);

  // `REVOKE GRANT OPTION FOR …` revokes the ability to re-grant, not the privilege.
  if (kind === "revoke") rest = rest.replace(/^\s*GRANT\s+OPTION\s+FOR\b/i, "");

  const onAt = findKeyword(rest, "ON");
  if (onAt === -1) return null;

  const privilegeText = rest.slice(0, onAt);
  const afterOn = rest.slice(onAt + 2);

  const connector = kind === "grant" ? "TO" : "FROM";
  const connectorAt = findKeyword(afterOn, connector);
  if (connectorAt === -1) return null;

  const objectText = afterOn.slice(0, connectorAt);
  const roleText = afterOn
    .slice(connectorAt + connector.length)
    .replace(/\bWITH\s+GRANT\s+OPTION\b/i, "")
    .replace(/\b(?:CASCADE|RESTRICT)\b/i, "");

  if (NON_TABLE_OBJECTS.test(objectText)) return null;

  let reach: ParsedStatement["reach"];
  let tables: string[];
  if (/^\s*ALL\s+TABLES\s+IN\s+SCHEMA\b/i.test(objectText)) {
    reach = "blanket";
    tables = [];
  } else {
    reach = "named";
    tables = splitTopLevel(objectText.replace(/^\s*TABLE\b/i, ""), ",")
      .map(bareTable)
      .filter(Boolean);
    if (!tables.length) return null;
  }

  const roles = splitTopLevel(roleText, ",")
    .map((role) => role.trim().replace(/"/g, "").toLowerCase())
    .filter((role): role is ClientRole => (CLIENT_ROLES as readonly string[]).includes(role));
  if (!roles.length) return null;

  const privileges: ParsedStatement["privileges"] = [];
  for (const part of splitTopLevel(privilegeText, ",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (/^ALL\b/i.test(trimmed)) {
      TABLE_PRIVILEGES.forEach((privilege) => privileges.push({ privilege, columns: [] }));
      continue;
    }

    const named = trimmed.match(/^([A-Za-z]+)\s*(?:\(([^)]*)\))?$/);
    if (!named) {
      throw new Error(
        `grant-inventory could not read the privilege "${trimmed}" in: ${text.trim().slice(0, 160)}\n` +
          "Teach src/test/migrations/grant-inventory.ts the new spelling. A privilege it cannot read " +
          "would silently shrink the denial set, which is the failure this guard exists to prevent."
      );
    }

    const privilege = named[1].toUpperCase();
    if (!(TABLE_PRIVILEGES as readonly string[]).includes(privilege)) {
      throw new Error(
        `grant-inventory met the unknown table privilege "${privilege}" in: ${text.trim().slice(0, 160)}`
      );
    }

    privileges.push({
      privilege: privilege as TablePrivilege,
      columns: named[2] ? named[2].split(",").map((column) => column.trim().toLowerCase()).filter(Boolean) : [],
    });
  }

  return privileges.length ? { kind, reach, tables, roles, privileges } : null;
}

/** Statements split at semicolons that sit at paren depth 0 and outside string literals. */
function topLevelStatements(sql: string): Array<{ text: string; offset: number }> {
  const statements: Array<{ text: string; offset: number }> = [];
  let start = 0;
  let depth = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === ";" && depth === 0) {
      statements.push(withoutLeadingSpace(sql, start, i));
      start = i + 1;
    }
  }

  if (start < sql.length) statements.push(withoutLeadingSpace(sql, start, sql.length));
  return statements;
}

/**
 * A statement's text with its offset moved past leading whitespace.
 *
 * The offset is what the reported line number is derived from, and a statement
 * begins at the character after the previous `;` — which is a newline. Reporting
 * that offset names the line ABOVE the statement, so every citation in a failure
 * message would point one line off and send a reader to the wrong REVOKE.
 */
function withoutLeadingSpace(sql: string, start: number, end: number): { text: string; offset: number } {
  let cursor = start;
  while (cursor < end && /\s/.test(sql[cursor])) cursor += 1;
  return { text: sql.slice(cursor, end), offset: cursor };
}

const keyOf = (table: string, role: ClientRole, privilege: TablePrivilege) => `${table}|${role}|${privilege}`;

export function loadGrantInventory(options: { dir?: string } = {}): GrantInventory {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const tables = loadSchemaInventory({ dir }).tables();

  type Ordered = { order: readonly [number, number, number, number]; event: GrantEvent };
  const ordered: Ordered[] = [];

  const emit = (
    order: readonly [number, number, number, number],
    file: string,
    line: number,
    parsed: ParsedStatement,
    tableNames: readonly string[]
  ) => {
    for (const table of tableNames) {
      for (const role of parsed.roles) {
        for (const { privilege, columns } of parsed.privileges) {
          ordered.push({
            order,
            event: { file, line, kind: parsed.kind, reach: parsed.reach, table, role, privilege, columns },
          });
        }
      }
    }
  };

  migrationFiles(dir).forEach((file, fileIndex) => {
    const sql = blankComments(readMigration(file, dir));

    for (const statement of topLevelStatements(sql)) {
      // `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES TO …` governs tables that do
      // not exist yet. It is a different question, with its own live assertion.
      if (/^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(statement.text)) continue;

      const parsed = parseGrantStatement(statement.text);
      if (!parsed) continue;

      emit(
        [fileIndex, statement.offset, 0, 0],
        file,
        lineAt(sql, statement.offset),
        parsed,
        parsed.reach === "blanket" ? tables : parsed.tables
      );
    }

    for (const expanded of expandDynamicGrantStatements(file, sql, tables)) {
      const parsed = parseGrantStatement(expanded.sql);
      if (!parsed) continue;

      // A loop over every table in the schema names no table in particular, even
      // though the rendered statement does. That is precisely what makes it
      // unable to re-establish a deliberate denial.
      emit(
        [fileIndex, expanded.blockOffset, expanded.row, expanded.site],
        file,
        expanded.line,
        { ...parsed, reach: "blanket" },
        parsed.tables
      );
    }
  });

  ordered.sort((left, right) => {
    for (let i = 0; i < 4; i += 1) {
      if (left.order[i] !== right.order[i]) return left.order[i] - right.order[i];
    }
    return 0;
  });

  /**
   * Replay. Three pieces of state per (table, role, privilege):
   *   held        — the statement responsible for it being held right now
   *   revokedBy   — the most recent revoke, which is what makes it a denial
   *   namedSince  — whether a BY-NAME grant re-established it after that revoke
   *
   * `namedSince` is the subtle one and it prevents a false positive. A migration
   * may legitimately revoke a privilege and later re-grant it by name; a blanket
   * grant landing on top of that must not retroactively make the deliberate
   * re-grant look like an accident. So a blanket grant sets `held` but never
   * clears `namedSince`.
   */
  const held = new Map<string, GrantEvent>();
  const heldColumns = new Map<string, Map<string, GrantEvent>>();
  const revokedBy = new Map<string, GrantEvent>();
  const namedSince = new Set<string>();

  for (const { event } of ordered) {
    const key = keyOf(event.table, event.role, event.privilege);

    if (event.kind === "grant") {
      if (event.columns.length) {
        // A column grant confers the privilege on those columns and never on the
        // table, so it cannot satisfy a table-level denial.
        const columns = heldColumns.get(key) ?? new Map<string, GrantEvent>();
        event.columns.forEach((column) => columns.set(column, event));
        heldColumns.set(key, columns);
        continue;
      }
      held.set(key, event);
      if (event.reach === "named") namedSince.add(key);
      continue;
    }

    if (event.columns.length) {
      const columns = heldColumns.get(key);
      event.columns.forEach((column) => columns?.delete(column));
      continue;
    }

    // Postgres: revoking a table privilege also revokes it on every column.
    held.delete(key);
    heldColumns.delete(key);
    namedSince.delete(key);
    revokedBy.set(key, event);
  }

  const denials: Denial[] = [];
  for (const [key, revoke] of revokedBy) {
    const holder = held.get(key) ?? null;
    denials.push({
      table: revoke.table,
      role: revoke.role,
      privilege: revoke.privilege,
      revokedBy: revoke,
      heldBy: holder,
      violation: holder !== null && !namedSince.has(key),
    });
  }

  denials.sort(
    (left, right) =>
      left.table.localeCompare(right.table) ||
      left.role.localeCompare(right.role) ||
      left.privilege.localeCompare(right.privilege)
  );

  const columnGrants: ColumnGrant[] = [];
  for (const [key, columns] of heldColumns) {
    const [table, role, privilege] = key.split("|");
    for (const [column, grantedBy] of columns) {
      columnGrants.push({
        table,
        role: role as ClientRole,
        privilege: privilege as TablePrivilege,
        column,
        grantedBy,
      });
    }
  }
  columnGrants.sort(
    (left, right) =>
      left.table.localeCompare(right.table) ||
      left.role.localeCompare(right.role) ||
      left.privilege.localeCompare(right.privilege) ||
      left.column.localeCompare(right.column)
  );

  const events = ordered.map(({ event }) => event);
  const revokedTables = [...new Set(denials.map((denial) => denial.table))].sort();

  return {
    events: () => events,
    denials: () => denials,
    violations: () => denials.filter((denial) => denial.violation),
    columnGrants: () => columnGrants,
    revokedTables: () => revokedTables,
  };
}

/** The `REVOKE` block that would make every violation go away, ready to paste into a migration. */
export function describeViolations(violations: readonly Denial[]): string {
  const byTableRole = new Map<string, TablePrivilege[]>();
  for (const violation of violations) {
    const key = `${violation.table}|${violation.role}`;
    byTableRole.set(key, [...(byTableRole.get(key) ?? []), violation.privilege]);
  }

  return [...byTableRole.entries()]
    .map(([key, privileges]) => {
      const [table, role] = key.split("|");
      const source = violations.find((violation) => violation.table === table && violation.role === role);
      return (
        `REVOKE ${privileges.sort().join(", ")} ON public.${table} FROM ${role};` +
        `  -- revoked by ${source?.revokedBy.file}:${source?.revokedBy.line}, ` +
        `re-granted by ${source?.heldBy?.file}:${source?.heldBy?.line}`
      );
    })
    .sort()
    .join("\n");
}
