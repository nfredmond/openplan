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
 *
 * ---------------------------------------------------------------------------
 * A SECOND QUESTION, ADDED 2026-08-11: what does a client role HOLD at HEAD?
 *
 * The denial invariant above only ever looks at triples some migration revoked.
 * A table that revoked nothing has no denial, so nothing here could see
 * `work_notifications` ship in v0.14.0 with RLS, two permissive policies and no
 * GRANT at all — a locked door that reported `permission denied for table
 * work_notifications` to every signed-in planner who opened their inbox.
 *
 * Answering "is this privilege held" needs one thing the denial replay did not:
 * the privileges a table is born with. Two rules, both read out of the corpus
 * rather than assumed:
 *
 *   1. DEFAULT PRIVILEGES AT BIRTH. Supabase's bootstrap grants full DML on
 *      every new table in `public` to `anon` and `authenticated`; `20260804000001`
 *      revoked that default, so tables created from that migration onward are
 *      born with nothing. `ALTER DEFAULT PRIVILEGES … ON TABLES` statements are
 *      parsed in file order and applied to the tables created after them, so the
 *      boundary is derived, never a hardcoded filename.
 *   2. A BLANKET GRANT CANNOT REACH A TABLE THAT DID NOT EXIST YET.
 *      `20260804000002` loops `pg_tables`; the expander renders that against
 *      every table in the corpus, INCLUDING tables created months later. Left
 *      uncorrected, every post-2026-08-04 table would look fully granted and the
 *      locked-door guard would be vacuous on exactly the tables it exists for.
 *
 * Both refinements are invisible to `denials()` by construction: a birth grant
 * precedes every statement in its own creation migration, and any REVOKE wipes
 * it, so no denial's `heldBy` can be a birth grant or a pre-birth blanket.
 *
 * One deliberate imprecision, harmless and recorded: the birth set is modelled
 * as the OLD bootstrap's full DML. Newer Supabase CLIs bootstrap `Dxtm` only and
 * `20260804000002` grants the four DML privileges back by loop, so the two paths
 * agree on SELECT/INSERT/UPDATE/DELETE — the only privileges an RLS policy can
 * ever be about — and differ only on TRUNCATE/REFERENCES/TRIGGER for tables born
 * before that migration.
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
  /**
   * `statement` — a GRANT/REVOKE somebody wrote.
   * `default-privileges` — no statement at all: the privileges the table was
   * born holding, under the default privileges in force at its creation.
   */
  origin: "statement" | "default-privileges";
  table: string;
  role: ClientRole;
  privilege: TablePrivilege;
  /** Non-empty when the statement is column-scoped, which never confers the table privilege. */
  columns: readonly string[];
};

/**
 * Whether a client role can reach a table's rows at all for one command.
 *
 * `column` is a real and deliberate answer, not a near-miss:
 * `document_narrative_drafts` grants members UPDATE on exactly four columns, so
 * its permissive UPDATE policy is reachable even though the table-level
 * privilege is correctly absent.
 */
export type PrivilegeHold = "table" | "column" | "none";

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
  /** Whether `role` can exercise `privilege` on `table` at HEAD, and how. */
  holds(table: string, role: ClientRole, privilege: TablePrivilege): PrivilegeHold;
  /** The statement (or birth) responsible for a table-level hold, or null. */
  heldBy(table: string, role: ClientRole, privilege: TablePrivilege): GrantEvent | null;
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

/**
 * `ALTER DEFAULT PRIVILEGES [FOR ROLE r] [IN SCHEMA s] GRANT|REVOKE … ON TABLES TO|FROM …`
 *
 * Only the `postgres` role in `public` is modelled, because that is the role
 * every CLI-applied migration and every Studio statement creates tables as —
 * `20260804000001`'s header says so and gives the reason. A statement `FOR ROLE
 * supabase_admin` governs objects the application never creates.
 */
const DEFAULT_PRIVILEGES_ON_TABLES =
  /ALTER\s+DEFAULT\s+PRIVILEGES\s+(?:FOR\s+(?:ROLE|USER)\s+([A-Za-z0-9_"]+)\s+)?(?:IN\s+SCHEMA\s+([A-Za-z0-9_"]+)\s+)?(GRANT|REVOKE)\s+([\s\S]*?)\s+ON\s+TABLES\s+(?:TO|FROM)\s+([\s\S]*?);/gi;

type BirthPrivileges = ReadonlyMap<ClientRole, ReadonlySet<TablePrivilege>>;

function snapshot(state: Map<ClientRole, Set<TablePrivilege>>): BirthPrivileges {
  return new Map([...state].map(([role, privileges]) => [role, new Set(privileges)]));
}

/**
 * The privileges a table created by each migration is born holding, per client role.
 *
 * Index i answers for tables created by `files[i]`. The state advances only
 * BETWEEN files, so a migration that both flips the defaults and creates a table
 * would be modelled a file too late — which is why that combination throws
 * rather than being quietly rounded off.
 */
function birthPrivilegesByFile(
  files: readonly string[],
  dir: string,
  createdInFile: ReadonlySet<string>
): BirthPrivileges[] {
  // Supabase's bootstrap: every table `postgres` creates in `public` is granted
  // full DML to anon and authenticated. PUBLIC is granted nothing on tables by
  // any Postgres default, which is why it starts empty.
  const state = new Map<ClientRole, Set<TablePrivilege>>([
    ["anon", new Set(TABLE_PRIVILEGES)],
    ["authenticated", new Set(TABLE_PRIVILEGES)],
    ["public", new Set()],
  ]);

  return files.map((file) => {
    const atCreation = snapshot(state);
    const sql = blankComments(readMigration(file, dir));
    let flips = 0;

    for (const match of sql.matchAll(DEFAULT_PRIVILEGES_ON_TABLES)) {
      const [, forRole, inSchema, verb, privilegeText, roleText] = match;
      if (forRole && forRole.replace(/"/g, "").toLowerCase() !== "postgres") continue;
      if (inSchema && inSchema.replace(/"/g, "").toLowerCase() !== "public") continue;

      const roles = splitTopLevel(roleText, ",")
        .map((role) => role.trim().replace(/"/g, "").toLowerCase())
        .filter((role): role is ClientRole => (CLIENT_ROLES as readonly string[]).includes(role));
      if (!roles.length) continue;

      const privileges = /^\s*ALL\b/i.test(privilegeText)
        ? [...TABLE_PRIVILEGES]
        : splitTopLevel(privilegeText, ",")
            .map((part) => part.trim().toUpperCase())
            .filter((part): part is TablePrivilege => (TABLE_PRIVILEGES as readonly string[]).includes(part));

      if (!privileges.length) {
        throw new Error(
          `grant-inventory could not read the default privileges in ${file}: "${match[0].trim().slice(0, 160)}".\n` +
            "Teach birthPrivilegesByFile the new spelling. A default-privilege change it cannot read makes " +
            "every table created afterwards look more granted than it is."
        );
      }

      flips += 1;
      for (const role of roles) {
        const held = state.get(role) ?? new Set<TablePrivilege>();
        privileges.forEach((privilege) =>
          verb.toUpperCase() === "GRANT" ? held.add(privilege) : held.delete(privilege)
        );
        state.set(role, held);
      }
    }

    if (flips && createdInFile.has(file)) {
      throw new Error(
        `${file} both changes ALTER DEFAULT PRIVILEGES for a client role and creates a table. ` +
          "grant-inventory models the default-privilege state per FILE, so it cannot say whether that " +
          "table was born before or after the flip. Split the two into separate migrations."
      );
    }

    return atCreation;
  });
}

export function loadGrantInventory(options: { dir?: string } = {}): GrantInventory {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const schema = loadSchemaInventory({ dir });
  const tables = schema.tables();
  const files = migrationFiles(dir);

  const fileIndexOf = new Map(files.map((file, index) => [file, index]));
  const bornAt = new Map<string, number>();
  for (const table of tables) {
    const file = schema.createdIn(table);
    const index = file === undefined ? undefined : fileIndexOf.get(file);
    if (index === undefined) {
      throw new Error(
        `grant-inventory cannot place the birth of public.${table}: the schema inventory lists it as a ` +
          "table but names no CREATE TABLE migration for it. Without a birth order every schema-wide " +
          "GRANT would be credited to it, including ones issued before it existed."
      );
    }
    bornAt.set(table, index);
  }

  const filesThatCreateTables = new Set([...bornAt.values()].map((index) => files[index]));
  const birthPrivileges = birthPrivilegesByFile(files, dir, filesThatCreateTables);

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
      // A grant cannot reach a table that did not exist when it ran. Only blanket
      // reach can produce such a pairing — a by-name grant on a future table is a
      // migration that fails to apply — so this never silences a real statement.
      if (parsed.reach === "blanket" && (bornAt.get(table) ?? 0) > order[0]) continue;

      for (const role of parsed.roles) {
        for (const { privilege, columns } of parsed.privileges) {
          ordered.push({
            order,
            event: {
              file,
              line,
              kind: parsed.kind,
              reach: parsed.reach,
              origin: "statement",
              table,
              role,
              privilege,
              columns,
            },
          });
        }
      }
    }
  };

  // The privileges each table is born with, ordered before every statement in
  // its own creation migration (offset -1) so the replay below sees them first.
  for (const [table, index] of bornAt) {
    for (const [role, privileges] of birthPrivileges[index]) {
      for (const privilege of privileges) {
        ordered.push({
          order: [index, -1, 0, 0],
          event: {
            file: files[index],
            line: 0,
            kind: "grant",
            // Never `named`: a default privilege is about every new table, so it
            // can no more re-establish a deliberate denial than a blanket grant can.
            reach: "blanket",
            origin: "default-privileges",
            table,
            role,
            privilege,
            columns: [],
          },
        });
      }
    }
  }

  files.forEach((file, fileIndex) => {
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
    holds: (table, role, privilege) => {
      const key = keyOf(bareTable(table), role, privilege);
      if (held.has(key)) return "table";
      return (heldColumns.get(key)?.size ?? 0) > 0 ? "column" : "none";
    },
    heldBy: (table, role, privilege) => held.get(keyOf(bareTable(table), role, privilege)) ?? null,
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
