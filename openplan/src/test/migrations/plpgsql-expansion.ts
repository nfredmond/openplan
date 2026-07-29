import { lineAt, matchingParen, splitTopLevel, unquoteLiteral } from "./read-migrations";

/**
 * Rendering the policies a migration builds at RUNTIME into concrete SQL.
 *
 * OpenPlan creates 252 of its policies inside `DO $$ … EXECUTE format(…) $$`
 * loops. A regex looking for `CREATE POLICY <name>` cannot see any of them,
 * because what is written in the file is `CREATE POLICY %I ON %I`. That is not a
 * theoretical gap: 12 of those policies belong to the three
 * `scenario_*` spine tables, 9 of them role-blind workspace writes, and
 * `viewer-write-denial-guard.test.ts` was green only because a LATER migration
 * happened to list those tables by hand. Delete three lines from that migration
 * and the guard stayed green while viewers regained write access.
 *
 * The failure mode that hid them is the one this module exists to eliminate: a
 * parser that cannot read something reports a SMALLER WORLD rather than an
 * error. So the contract here is inverted — anything an `EXECUTE` builds that
 * this module cannot render concretely throws `UnexpandableDynamicSqlError`
 * naming the file and line. A guard is allowed to fail. It is not allowed to
 * shrink.
 *
 * Two loop shapes exist in the migration set, and both are handled:
 *
 *   Form A  FOREACH v IN ARRAY ARRAY['a','b'] LOOP … EXECUTE format(…, v || '_read', v)
 *           — 20260410000045_scenario_shared_spine.sql
 *
 *   Form B  FOR r IN SELECT * FROM (VALUES ('a','x'),('b','y')) AS t(tbl, ws_expr) LOOP
 *           — 20260728000006 / 20260728000007, the writer-gate migrations
 *
 * `IF NOT EXISTS (SELECT 1 FROM pg_policies …) THEN` wrappers are ignored on
 * purpose: they are idempotency, not a branch. The policy is what the migration
 * intends the schema to have.
 */

export class UnexpandableDynamicSqlError extends Error {
  constructor(file: string, line: number, detail: string) {
    super(
      `${file}:${line} builds a policy with SQL this parser cannot render: ${detail}\n` +
        "Teach src/test/migrations/plpgsql-expansion.ts the new shape. Do not silently skip it — " +
        "a policy the inventory cannot see is a policy no guard can require."
    );
    this.name = "UnexpandableDynamicSqlError";
  }
}

export type ExpandedStatement = {
  file: string;
  /** Byte offset of the enclosing DO block, so these interleave with literal statements. */
  blockOffset: number;
  /** Loop iteration, then position of the EXECUTE within the block body. Row-major = execution order. */
  row: number;
  site: number;
  /** A concrete, terminated statement, ready for the literal policy parser. */
  sql: string;
  line: number;
};

type Bindings = Record<string, string>;

/**
 * Byte ranges of every single-quoted string literal in the file.
 *
 * The literal `CREATE POLICY` scanner skips matches that begin inside one of
 * these. Today `%I` cannot match an identifier pattern anyway, so the exclusion
 * is invisible — but once this module also EMITS those statements, a template
 * whose policy name happened to be literal would be counted twice. Making the
 * exclusion explicit is what keeps that from being an accident.
 */
export function stringLiteralRanges(sql: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    if (!inString) {
      if (sql[i] === "'") {
        inString = true;
        start = i;
      }
      continue;
    }
    if (sql[i] === "'") {
      // A doubled quote is an escape, not a terminator.
      if (sql[i + 1] === "'") {
        i += 1;
        continue;
      }
      inString = false;
      ranges.push([start, i + 1]);
    }
  }

  return ranges;
}

export function isInsideRange(ranges: Array<[number, number]>, offset: number): boolean {
  return ranges.some(([from, to]) => offset >= from && offset < to);
}

/** `DO $tag$ … $tag$` bodies, with the absolute offset of each body. */
function doBlocks(sql: string): Array<{ body: string; offset: number }> {
  const blocks: Array<{ body: string; offset: number }> = [];
  const opener = /\bDO\s+\$([A-Za-z0-9_]*)\$/gi;

  for (const match of sql.matchAll(opener)) {
    const tag = `$${match[1]}$`;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const end = sql.indexOf(tag, bodyStart);
    if (end === -1) continue;
    blocks.push({ body: sql.slice(bodyStart, end), offset: bodyStart });
  }

  return blocks;
}

/** The argument expression of each `EXECUTE`, up to its terminating `;`. */
function executeSites(body: string): Array<{ argument: string; offset: number }> {
  const sites: Array<{ argument: string; offset: number }> = [];

  for (const match of body.matchAll(/\bEXECUTE\b/gi)) {
    const from = (match.index ?? 0) + match[0].length;
    let depth = 0;
    let inString = false;
    let end = body.length;

    for (let i = from; i < body.length; i += 1) {
      const ch = body[i];
      if (inString) {
        if (ch === "'") inString = false;
        continue;
      }
      if (ch === "'") inString = true;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === ";" && depth === 0) {
        end = i;
        break;
      }
    }

    sites.push({ argument: body.slice(from, end), offset: match.index ?? 0 });
  }

  return sites;
}

/** Form A — `FOREACH v IN ARRAY ARRAY['a','b','c']`. */
function foreachBindings(body: string): Bindings[] | null {
  const match = body.match(/\bFOREACH\s+([A-Za-z_]\w*)\s+IN\s+ARRAY\s+ARRAY\s*\[/i);
  if (!match) return null;

  const open = (match.index ?? 0) + match[0].length;
  let close = -1;
  let inString = false;
  for (let i = open; i < body.length; i += 1) {
    if (inString) {
      if (body[i] === "'") inString = false;
      continue;
    }
    if (body[i] === "'") inString = true;
    else if (body[i] === "]") {
      close = i;
      break;
    }
  }
  if (close === -1) return null;

  const variable = match[1];
  const values = splitTopLevel(body.slice(open, close), ",").map((cell) => unquoteLiteral(cell));
  if (!values.length || values.some((value) => value === null)) return null;

  return values.map((value) => ({ [variable]: value as string }));
}

/** Form B — `FOR r IN SELECT * FROM (VALUES (…),(…)) AS t(col, col)`. */
function forRecordBindings(body: string): Bindings[] | null {
  const header = body.match(/\bFOR\s+([A-Za-z_]\w*)\s+IN\b[\s\S]*?\bFROM\s*\(/i);
  if (!header) return null;

  const record = header[1];
  const open = (header.index ?? 0) + header[0].length - 1;
  const afterClose = matchingParen(body, open);
  if (afterClose === -1) return null;

  const inner = body.slice(open + 1, afterClose - 1);
  const valuesKeyword = inner.match(/\bVALUES\b/i);
  if (!valuesKeyword) return null;

  const alias = body.slice(afterClose).match(/^\s*AS\s+[A-Za-z_]\w*\s*\(([^)]*)\)/i);
  if (!alias) return null;
  const columns = alias[1].split(",").map((name) => name.trim());

  const rowsText = inner.slice((valuesKeyword.index ?? 0) + valuesKeyword[0].length);
  const rows: Bindings[] = [];

  for (let i = 0; i < rowsText.length; i += 1) {
    if (rowsText[i] !== "(") continue;
    const rowEnd = matchingParen(rowsText, i);
    if (rowEnd === -1) return null;

    const cells = splitTopLevel(rowsText.slice(i + 1, rowEnd - 1), ",").map((cell) => unquoteLiteral(cell));
    if (cells.length !== columns.length || cells.some((cell) => cell === null)) return null;

    const binding: Bindings = {};
    columns.forEach((column, index) => {
      binding[`${record}.${column}`] = cells[index] as string;
    });
    rows.push(binding);

    i = rowEnd - 1;
  }

  return rows.length ? rows : null;
}

/** Split on `||` at paren depth 0 and outside strings, so a `'a||b'` literal stays whole. */
function splitConcat(expression: string): string[] {
  const parts: string[] = [];
  let inString = false;
  let depth = 0;
  let start = 0;

  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "|" && expression[i + 1] === "|" && depth === 0) {
      parts.push(expression.slice(start, i));
      i += 1;
      start = i + 1;
    }
  }

  parts.push(expression.slice(start));
  return parts;
}

/** `r.tbl || '_writer_only_insert'` → the concatenated string, under these bindings. */
function resolveArgument(expression: string, bindings: Bindings): string | null {
  const parts = splitConcat(expression);

  let out = "";
  for (const part of parts) {
    const trimmed = part.trim();
    const literal = unquoteLiteral(trimmed);
    if (literal !== null) {
      out += literal;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(bindings, trimmed)) {
      out += bindings[trimmed];
      continue;
    }
    return null;
  }

  return out;
}

/** Apply `%I` / `%s` / `%%` positionally, exactly as PL/pgSQL's `format()` does. */
function applyFormat(template: string, args: string[]): string | null {
  let out = "";
  let next = 0;

  for (let i = 0; i < template.length; i += 1) {
    if (template[i] !== "%") {
      out += template[i];
      continue;
    }

    const specifier = template[i + 1];
    i += 1;

    if (specifier === "%") {
      out += "%";
    } else if (specifier === "I" || specifier === "s") {
      // Every generated identifier in this repo is unquoted lower_snake, so an
      // %I renders bare. A name needing quoting would change that, which is why
      // the caller asserts the rendered statements parse.
      if (next >= args.length) return null;
      out += args[next];
      next += 1;
    } else {
      // %L would need literal quoting rules this module does not implement.
      return null;
    }
  }

  return next === args.length ? out : null;
}

export function expandDynamicPolicyStatements(file: string, sql: string): ExpandedStatement[] {
  const statements: ExpandedStatement[] = [];

  for (const block of doBlocks(sql)) {
    const sites = executeSites(block.body).filter((site) =>
      /\b(?:CREATE|DROP)\s+POLICY\b/i.test(site.argument)
    );
    if (!sites.length) continue;

    const unexpandable = (offset: number, detail: string) =>
      new UnexpandableDynamicSqlError(file, lineAt(sql, block.offset + offset), detail);

    const rows = foreachBindings(block.body) ?? forRecordBindings(block.body) ?? [{}];

    // Parse each EXECUTE once, into something that can be rendered per row.
    const prepared = sites.map((site) => {
      const call = site.argument.match(/\bformat\s*\(/i);

      // `EXECUTE '<literal statement>'` — no format() at all.
      if (!call) {
        const direct = unquoteLiteral(site.argument);
        if (direct === null) {
          throw unexpandable(site.offset, "an EXECUTE argument that is neither a format() call nor a string literal");
        }
        return { offset: site.offset, render: () => direct };
      }

      const open = (call.index ?? 0) + call[0].length - 1;
      const afterClose = matchingParen(site.argument, open);
      if (afterClose === -1) throw unexpandable(site.offset, "an unterminated format() call");

      const args = splitTopLevel(site.argument.slice(open + 1, afterClose - 1), ",");
      const template = unquoteLiteral(args[0] ?? "");
      if (template === null) {
        throw unexpandable(site.offset, "a format() template that is not a literal string");
      }

      return {
        offset: site.offset,
        render: (binding: Bindings) => {
          const resolved = args.slice(1).map((argument) => resolveArgument(argument, binding));
          if (resolved.some((value) => value === null)) {
            throw unexpandable(
              site.offset,
              `a format() argument that does not reduce to a constant (${args.slice(1).join(", ").trim()})`
            );
          }

          const rendered = applyFormat(template, resolved as string[]);
          if (rendered === null) {
            throw unexpandable(
              site.offset,
              "a format() specifier this parser does not implement, or an argument-count mismatch"
            );
          }
          return rendered;
        },
      };
    });

    // Row-major, because that is how the LOOP runs: a `DROP POLICY x` and the
    // `CREATE POLICY x` that follows it belong to the same iteration, and a
    // replay that reordered them would delete the policy it had just created.
    rows.forEach((binding, row) => {
      prepared.forEach((site, siteIndex) => {
        statements.push({
          file,
          blockOffset: block.offset,
          row,
          site: siteIndex,
          sql: `${site.render(binding)};`,
          line: lineAt(sql, block.offset + site.offset),
        });
      });
    });
  }

  return statements;
}
