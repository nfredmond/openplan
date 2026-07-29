import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reading the migration set, once.
 *
 * Several guards answer questions about the schema by parsing the migrations on
 * disk rather than by querying a database — because `npm run qa:gate` has no
 * database, and a guard that only runs in the nightly live job cannot block a
 * merge. This module is the bottom of that stack: file listing, file reading,
 * and the one piece of lexing every parser above it needs.
 */

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** Every migration, in filename order — which is the order Postgres applies them. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function readMigration(name: string, dir: string = MIGRATIONS_DIR): string {
  return readFileSync(path.join(dir, name), "utf8");
}

/**
 * Replace every SQL comment with spaces, preserving length and therefore every
 * byte offset in the original.
 *
 * Blanking rather than deleting matters: creates and drops are replayed in the
 * order they appear in a file, and that ordering is by byte offset. A parser
 * working on de-commented text and a caller holding offsets into the original
 * would silently disagree.
 *
 * The scanner tracks single-quoted strings so that an apostrophe inside a
 * comment (`-- the agency's own`) cannot desynchronise quote state, and so that
 * a `--` inside a string literal — which is real SQL in a `format()` template —
 * is not mistaken for a comment. Dollar-quoted bodies are deliberately NOT
 * treated as opaque: `CREATE POLICY` statements written literally inside a
 * `DO $$ … $$` block are real policies and the parsers above must see them.
 */
export function blankComments(sql: string): string {
  const out = sql.split("");
  let state: "normal" | "single" | "line" | "block" = "normal";

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === "normal") {
      if (ch === "-" && next === "-") {
        state = "line";
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
      } else if (ch === "/" && next === "*") {
        state = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
      } else if (ch === "'") {
        state = "single";
      }
      continue;
    }

    if (state === "single") {
      // A doubled quote exits and immediately re-enters, which lands in the
      // right state without needing a special case.
      if (ch === "'") state = "normal";
      continue;
    }

    if (state === "line") {
      if (ch === "\n") {
        state = "normal";
      } else {
        out[i] = " ";
      }
      continue;
    }

    // block
    if (ch === "*" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 1;
      state = "normal";
    } else if (ch !== "\n") {
      out[i] = " ";
    }
  }

  return out.join("");
}

/**
 * The index of the character after the `)` matching an `(` at `openIndex`,
 * skipping parentheses inside single-quoted strings. Returns -1 when unmatched.
 */
export function matchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }

    if (ch === "'") {
      inString = true;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

/**
 * Split on a separator that appears at paren depth 0 and outside strings.
 *
 * The reason this exists rather than a `split(",")`: the writer-gate migrations
 * carry workspace expressions like
 * `'coalesce((SELECT …), (SELECT …))'` inside their VALUES rows — parentheses
 * AND commas inside a single-quoted string. A naive split truncates them, and a
 * truncated expression parses into a policy body that looks scoped when it is
 * not.
 */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }

    if (ch === "'") {
      inString = true;
    } else if (ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "]") {
      depth -= 1;
    } else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/** `'a''b'` → `a'b`. Returns null when the text is not a single quoted literal. */
export function unquoteLiteral(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || !trimmed.startsWith("'") || !trimmed.endsWith("'")) return null;

  const inner = trimmed.slice(1, -1);
  // A lone (unpaired) quote inside means this was not one literal but several.
  if (/(^|[^'])'($|[^'])/.test(inner)) return null;

  return inner.replace(/''/g, "'");
}

/** 1-indexed line number of a byte offset, for error messages that a human can act on. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}
