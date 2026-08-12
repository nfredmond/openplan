import {
  MIGRATIONS_DIR,
  blankComments,
  migrationFiles,
  readMigration,
} from "./read-migrations";
import {
  expandDynamicPolicyStatements,
  isInsideRange,
  stringLiteralRanges,
} from "./plpgsql-expansion";

/**
 * Every RLS policy the migrations declare, as one queryable inventory.
 *
 * This replaces two divergent regex parsers — one in
 * `viewer-write-denial-guard.test.ts`, one implied by the class-1 write
 * coverage guard — with a single reading of the schema, for a reason the
 * project learned the hard way: two parsers disagree silently, and the guard
 * with the weaker one stays green.
 *
 * Three things it knows that the parser it replaces did not:
 *
 *   1. PERMISSIVE vs RESTRICTIVE. The old parser had no concept of it, so "the
 *      table has an UPDATE policy" and "the table can be UPDATEd" were the same
 *      question. They are not: a RESTRICTIVE policy only ever SUBTRACTS, so a
 *      table carrying a restrictive UPDATE gate and no permissive UPDATE policy
 *      accepts no updates at all — while supabase-js reports `error: null` over
 *      the zero rows it matched. That is exactly how `runs` silently discarded
 *      every saved map view.
 *   2. Policies built at runtime, via `plpgsql-expansion`.
 *   3. Which idiom a policy uses to scope to a workspace or to consult a role —
 *      as a closed set of recognised patterns with a LOUD residue, rather than
 *      a substring test that answers "no" for anything it has not seen.
 *
 * `FOR ALL` is a write grant. A policy with no `FOR` clause at all is also a
 * write grant, because that is Postgres's default. Both are counted.
 */

export type PolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
export type WriteCommand = "INSERT" | "UPDATE" | "DELETE";
export type PolicyKind = "PERMISSIVE" | "RESTRICTIVE";

export const WRITE_COMMANDS: readonly WriteCommand[] = ["INSERT", "UPDATE", "DELETE"];

export type PolicyStatement = {
  file: string;
  /** Sort key: file order, then byte offset, then loop row, then site. */
  order: readonly [number, number, number, number];
  origin: "literal" | "expanded";
  policy: string;
  table: string;
  command: PolicyCommand;
  kind: PolicyKind;
  /**
   * The roles the policy is addressed to, lowercased. `["public"]` when the
   * statement has no `TO` clause, which is Postgres's default and means every
   * role — that is every policy in this repo today.
   *
   * It matters because a policy is only half of an access decision: the other
   * half is the GRANT, and the two are checked against the SAME role. A policy
   * addressed to a role that holds no privilege is a door with no handle.
   */
  roles: readonly string[];
  /** Everything after the table name — the AS/FOR/USING/WITH CHECK clauses. */
  body: string;
};

type RawStatement =
  | { type: "create"; statement: PolicyStatement }
  | { type: "drop"; order: readonly [number, number, number, number]; table: string; policy: string };

/**
 * A `CREATE POLICY` written literally. The schema qualifier is captured
 * generically rather than as an optional `public.` literal: with the latter,
 * `ON storage.objects` matched no schema and reported a table named "storage",
 * which is how Supabase's own storage policies leaked into a guard about
 * workspace content.
 */
const CREATE_POLICY =
  /CREATE\s+POLICY\s+"?([A-Za-z0-9_]+)"?\s+ON\s+(?:([A-Za-z0-9_]+)\.)?"?([A-Za-z0-9_]+)"?([^;]*);/gi;

const DROP_POLICY =
  /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+(?:([A-Za-z0-9_]+)\.)?"?([A-Za-z0-9_]+)"?/gi;

/**
 * The roles a `CREATE POLICY` addresses, read out of the clauses between the
 * table name and the first `USING` / `WITH CHECK`.
 *
 * That head is a closed grammar — `[AS PERMISSIVE|RESTRICTIVE] [FOR cmd]
 * [TO roles]` — so anything left over after removing those three is something
 * this parser does not understand, and it throws. The alternative is the silent
 * shrink this module tree exists to prevent: a head it misreads would report
 * `["public"]`, i.e. "addressed to everyone", which is the answer that makes
 * every downstream check pass.
 */
export function parsePolicyRoles(file: string, policy: string, body: string): readonly string[] {
  const head = body.split(/\bUSING\b|\bWITH\s+CHECK\b/i)[0];

  const roleClause = head.match(/\bTO\s+([A-Za-z0-9_",\s]+)$/i);
  const residue = head
    .replace(/\bAS\s+(?:PERMISSIVE|RESTRICTIVE)\b/i, " ")
    .replace(/\bFOR\s+(?:INSERT|UPDATE|DELETE|SELECT|ALL)\b/i, " ")
    .replace(/\bTO\s+[A-Za-z0-9_",\s]+$/i, " ")
    .trim();

  if (residue) {
    throw new Error(
      `${file}: policy "${policy}" has a clause this parser cannot read before its USING/WITH CHECK: ` +
        `"${residue.slice(0, 120)}".\nTeach parsePolicyRoles in src/test/migrations/policy-inventory.ts. ` +
        "Guessing would report the policy as addressed to PUBLIC, which silently satisfies every " +
        "check built on it."
    );
  }

  if (!roleClause) return ["public"];

  return roleClause[1]
    .split(",")
    .map((role) => role.trim().replace(/"/g, "").toLowerCase())
    .filter(Boolean);
}

function parseCreates(
  file: string,
  sql: string,
  fileIndex: number,
  origin: PolicyStatement["origin"],
  skipRanges: Array<[number, number]>,
  baseOffset: number,
  row: number,
  site: number
): RawStatement[] {
  const out: RawStatement[] = [];

  for (const match of sql.matchAll(CREATE_POLICY)) {
    const at = match.index ?? 0;
    if (isInsideRange(skipRanges, at)) continue;

    const [, policy, schema, table, rest] = match;
    if (schema !== undefined && schema.toLowerCase() !== "public") continue;

    const command = (rest.match(/\bFOR\s+(INSERT|UPDATE|DELETE|SELECT|ALL)\b/i)?.[1] ?? "ALL").toUpperCase();

    out.push({
      type: "create",
      statement: {
        file,
        order: [fileIndex, baseOffset + at, row, site],
        origin,
        policy,
        table,
        command: command as PolicyCommand,
        kind: /\bAS\s+RESTRICTIVE\b/i.test(rest) ? "RESTRICTIVE" : "PERMISSIVE",
        roles: parsePolicyRoles(file, policy, rest),
        body: rest,
      },
    });
  }

  return out;
}

function parseDrops(
  sql: string,
  fileIndex: number,
  skipRanges: Array<[number, number]>,
  baseOffset: number,
  row: number,
  site: number
): RawStatement[] {
  const out: RawStatement[] = [];

  for (const match of sql.matchAll(DROP_POLICY)) {
    const at = match.index ?? 0;
    if (isInsideRange(skipRanges, at)) continue;

    const [, policy, schema, table] = match;
    if (schema !== undefined && schema.toLowerCase() !== "public") continue;

    out.push({ type: "drop", order: [fileIndex, baseOffset + at, row, site], table, policy });
  }

  return out;
}

export type PolicyInventory = {
  all(): PolicyStatement[];
  tables(): string[];
  forTable(table: string): PolicyStatement[];
  /** PERMISSIVE policies that GRANT this command — `FOR <cmd>` or `FOR ALL`. */
  permissiveGrants(table: string, command: PolicyCommand): PolicyStatement[];
  /** RESTRICTIVE policies that CONSTRAIN this command. */
  restrictiveGates(table: string, command: PolicyCommand): PolicyStatement[];
};

function covers(statement: PolicyStatement, command: PolicyCommand): boolean {
  return statement.command === command || statement.command === "ALL";
}

export function loadPolicyInventory(options: { dir?: string } = {}): PolicyInventory {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const events: RawStatement[] = [];

  migrationFiles(dir).forEach((file, fileIndex) => {
    const sql = blankComments(readMigration(file, dir));
    const skipRanges = stringLiteralRanges(sql);

    events.push(...parseCreates(file, sql, fileIndex, "literal", skipRanges, 0, 0, 0));
    events.push(...parseDrops(sql, fileIndex, skipRanges, 0, 0, 0));

    for (const expanded of expandDynamicPolicyStatements(file, sql)) {
      // The rendered statement is its own little document; nothing inside it is
      // skipped, and its offset is the DO block's so it interleaves correctly
      // with literal statements elsewhere in the same file.
      events.push(
        ...parseCreates(file, expanded.sql, fileIndex, "expanded", [], expanded.blockOffset, expanded.row, expanded.site)
      );
      events.push(...parseDrops(expanded.sql, fileIndex, [], expanded.blockOffset, expanded.row, expanded.site));
    }
  });

  const orderOf = (event: RawStatement): readonly [number, number, number, number] =>
    event.type === "create" ? event.statement.order : event.order;

  events.sort((left, right) => {
    const a = orderOf(left);
    const b = orderOf(right);
    for (let i = 0; i < 4; i += 1) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  });

  /**
   * Replay creates and drops in application order, keyed by (table, policy), so
   * a later `DROP POLICY IF EXISTS x; CREATE POLICY x` REPLACES rather than
   * duplicates. Without this, `billing_invoice_records` would register as
   * role-blind forever on the strength of its original 20260424000072
   * definition, even though 20260717000082 rewrote those same policies to be
   * role-aware. The question is about the schema that exists, not every schema
   * that ever existed.
   */
  const latest = new Map<string, PolicyStatement>();
  for (const event of events) {
    if (event.type === "create") {
      latest.set(`${event.statement.table}.${event.statement.policy}`, event.statement);
    } else {
      latest.delete(`${event.table}.${event.policy}`);
    }
  }

  const survivors = [...latest.values()];
  const byTable = new Map<string, PolicyStatement[]>();
  for (const statement of survivors) {
    const existing = byTable.get(statement.table) ?? [];
    existing.push(statement);
    byTable.set(statement.table, existing);
  }

  return {
    all: () => survivors,
    tables: () => [...byTable.keys()].sort(),
    forTable: (table) => byTable.get(table) ?? [],
    permissiveGrants: (table, command) =>
      (byTable.get(table) ?? []).filter((p) => p.kind === "PERMISSIVE" && covers(p, command)),
    restrictiveGates: (table, command) =>
      (byTable.get(table) ?? []).filter((p) => p.kind === "RESTRICTIVE" && covers(p, command)),
  };
}

/* ------------------------------------------------------------------ *
 * Classifiers
 * ------------------------------------------------------------------ */

/**
 * How a policy body reaches a workspace.
 *
 * The parser this replaces asked `body.includes("workspace_members")`. That was
 * true of all 186 write policies at the time and is therefore invisible today —
 * but `public.workspace_member_can_write(uuid)` now exists and is granted to
 * `authenticated`, so it is the obvious idiom for the next policy anyone writes.
 * The first one written that way would have silently left the inventory.
 */
export const WORKSPACE_SCOPE_IDIOMS = [
  // No `s` flag anywhere: `[\s\S]` already crosses newlines, and dotAll would
  // raise this file's required target for no gain.
  { id: "membership-in", pattern: /\bIN\s*\(\s*SELECT\s+[A-Za-z0-9_.]*workspace_id\s+FROM\s+(?:public\.)?workspace_members\b/i },
  { id: "membership-exists", pattern: /\bEXISTS\s*\(\s*SELECT\b[\s\S]*?\bFROM\s+(?:public\.)?workspace_members\b/i },
  { id: "membership-join", pattern: /\bJOIN\s+(?:public\.)?workspace_members\b/i },
  { id: "writer-helper", pattern: /\bpublic\.workspace_member_can_write\s*\(/i },
] as const;

/**
 * Whether a policy consults the member's ROLE.
 *
 * A bare `\brole\b` test cannot do this job. It has to accept `wm.role IN (…)`,
 * which is a real check, so it cannot simply exclude qualified names — and once
 * it accepts a bare mention, any policy body that happens to contain the word
 * exempts itself from the guard. Silently. The asymmetry is what makes it
 * dangerous: a false positive here is loud (a table gets flagged and someone
 * adds a gate), a false negative is invisible.
 *
 * `workspace_member_can_write` appears in both lists deliberately — it scopes to
 * the workspace AND consults the role, which is the whole point of the helper.
 */
export const ROLE_AWARE_IDIOMS = [
  { id: "role-in-list", pattern: /\brole\s+IN\s*\(/i },
  { id: "role-compare", pattern: /\brole\s*(?:=|<>|!=)\s*'/i },
  { id: "role-rank", pattern: /\bpublic\.workspace_role_rank\s*\(/i },
  { id: "writer-helper", pattern: /\bpublic\.workspace_member_can_write\s*\(/i },
] as const;

export type Classification =
  | { kind: "matched"; idiom: string }
  | { kind: "absent" }
  /** It looks like it is doing this, but by no pattern we recognise. Fail loudly. */
  | { kind: "unclassifiable"; hint: string };

function classify(
  body: string,
  idioms: ReadonlyArray<{ id: string; pattern: RegExp }>,
  suspicion: RegExp
): Classification {
  for (const idiom of idioms) {
    if (idiom.pattern.test(body)) return { kind: "matched", idiom: idiom.id };
  }
  const suspicious = body.match(suspicion);
  if (suspicious) {
    return { kind: "unclassifiable", hint: suspicious[0].trim().slice(0, 80) };
  }
  return { kind: "absent" };
}

export function classifyWorkspaceScope(statement: PolicyStatement): Classification {
  return classify(statement.body, WORKSPACE_SCOPE_IDIOMS, /workspace_members?\b|workspace_id\b|workspace_member_can_write/i);
}

export function classifyRoleAwareness(statement: PolicyStatement): Classification {
  // `service_role` is excluded by name: it is by far the most common incidental
  // appearance of the substring and never denotes a role CHECK.
  return classify(statement.body, ROLE_AWARE_IDIOMS, /(?<!service_)\brole\b/i);
}

export function isWriteCommand(statement: PolicyStatement): boolean {
  return statement.command === "ALL" || (WRITE_COMMANDS as readonly string[]).includes(statement.command);
}
