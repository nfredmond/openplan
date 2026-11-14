/**
 * A stand-in for TIGERweb's attribute query that applies the request to
 * recorded rows, so a test proves what a built request MATCHES rather than
 * which text it contains.
 *
 * It reads the where-clause grammar the place resolver and county catalog
 * send: AND, OR, parentheses, `UPPER(F) LIKE UPPER('...')` with real LIKE
 * wildcards (`%` any run, `_` one character, so a wildcard that slipped past
 * the sanitizer widens the match here as it would on the server), `F='v'`,
 * `F<>'v'`, `F IN (...)`, `F NOT IN (...)` and `1=1`. Anything else, or a field
 * the layer's rows do not carry, answers the way ArcGIS reports a rejected
 * query: a 200 with an `error` object and no `features`.
 *
 * Rows are ordered by `orderByFields` (one field, ASC or DESC, then GEOID so a
 * tie is stable), then cut by `resultOffset` and `resultRecordCount`, which is
 * the truncation the resolver has to survive.
 */

export type TigerRow = Record<string, string | number | null>;

type Token =
  | { kind: "string"; value: string }
  | { kind: "word"; value: string }
  | { kind: "number"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," | "=" | "<>" };

class WhereSyntaxError extends Error {}

function tokenize(where: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < where.length) {
    const char = where[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === "'") {
      let value = "";
      index += 1;
      for (;;) {
        if (index >= where.length) throw new WhereSyntaxError("unterminated string literal");
        if (where[index] === "'") {
          if (where[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        value += where[index];
        index += 1;
      }
      tokens.push({ kind: "string", value });
    } else if (char === "<" && where[index + 1] === ">") {
      tokens.push({ kind: "punct", value: "<>" });
      index += 2;
    } else if (char === "(" || char === ")" || char === "," || char === "=") {
      tokens.push({ kind: "punct", value: char });
      index += 1;
    } else if (/[0-9]/.test(char)) {
      const match = /^[0-9]+/.exec(where.slice(index))![0];
      tokens.push({ kind: "number", value: match });
      index += match.length;
    } else if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(where.slice(index))![0];
      tokens.push({ kind: "word", value: match });
      index += match.length;
    } else {
      throw new WhereSyntaxError(`unexpected character ${JSON.stringify(char)}`);
    }
  }
  return tokens;
}

type Predicate = (row: TigerRow) => boolean;

function likeToRegExp(pattern: string): RegExp {
  let source = "";
  for (const char of pattern) {
    if (char === "%") source += "[\\s\\S]*";
    else if (char === "_") source += "[\\s\\S]";
    else source += char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

function parseWhere(where: string, fields: ReadonlySet<string>): Predicate {
  const tokens = tokenize(where);
  let position = 0;

  const peek = () => tokens[position];
  const next = () => {
    const token = tokens[position];
    if (!token) throw new WhereSyntaxError("unexpected end of where clause");
    position += 1;
    return token;
  };
  const expectPunct = (value: string) => {
    const token = next();
    if (token.kind !== "punct" || token.value !== value) throw new WhereSyntaxError(`expected ${value}`);
  };
  const expectWord = (value: string) => {
    const token = next();
    if (token.kind !== "word" || token.value.toUpperCase() !== value) throw new WhereSyntaxError(`expected ${value}`);
  };
  const isWord = (token: Token | undefined, value: string) =>
    token?.kind === "word" && token.value.toUpperCase() === value;
  const field = () => {
    const token = next();
    if (token.kind !== "word") throw new WhereSyntaxError("expected a field");
    if (!fields.has(token.value)) throw new WhereSyntaxError(`unknown field ${token.value}`);
    return token.value;
  };
  const literal = () => {
    const token = next();
    if (token.kind !== "string") throw new WhereSyntaxError("expected a string literal");
    return token.value;
  };
  const literalList = () => {
    expectPunct("(");
    const values = [literal()];
    while (peek()?.kind === "punct" && peek()?.value === ",") {
      next();
      values.push(literal());
    }
    expectPunct(")");
    return values;
  };
  const text = (row: TigerRow, name: string) => (row[name] == null ? null : String(row[name]));

  function primary(): Predicate {
    const token = peek();
    if (token?.kind === "punct" && token.value === "(") {
      next();
      const inner = orExpression();
      expectPunct(")");
      return inner;
    }
    if (token?.kind === "number") {
      const left = next().value;
      expectPunct("=");
      const right = next();
      if (right.kind !== "number") throw new WhereSyntaxError("expected a number");
      const result = left === right.value;
      return () => result;
    }
    if (isWord(token, "UPPER")) {
      next();
      expectPunct("(");
      const name = field();
      expectPunct(")");
      expectWord("LIKE");
      expectWord("UPPER");
      expectPunct("(");
      const pattern = likeToRegExp(literal().toUpperCase());
      expectPunct(")");
      return (row) => {
        const value = text(row, name);
        return value !== null && pattern.test(value.toUpperCase());
      };
    }
    const name = field();
    const operator = peek();
    if (operator?.kind === "punct" && (operator.value === "=" || operator.value === "<>")) {
      next();
      const value = literal();
      return operator.value === "=" ? (row) => text(row, name) === value : (row) => text(row, name) !== value;
    }
    if (isWord(operator, "NOT")) {
      next();
      expectWord("IN");
      const values = literalList();
      return (row) => !values.includes(text(row, name) ?? "");
    }
    expectWord("IN");
    const values = literalList();
    return (row) => values.includes(text(row, name) ?? "");
  }

  function andExpression(): Predicate {
    let left = primary();
    while (isWord(peek(), "AND")) {
      next();
      const right = primary();
      const before = left;
      left = (row) => before(row) && right(row);
    }
    return left;
  }

  function orExpression(): Predicate {
    let left = andExpression();
    while (isWord(peek(), "OR")) {
      next();
      const right = andExpression();
      const before = left;
      left = (row) => before(row) || right(row);
    }
    return left;
  }

  const predicate = orExpression();
  if (position !== tokens.length) throw new WhereSyntaxError("trailing tokens in where clause");
  return predicate;
}

/**
 * Answer one TIGERweb attribute query from `rowsByLayer` (layer id -> rows).
 * Returns `{ features: [] }` for a layer with no recorded rows, and an ArcGIS
 * style `{ error }` for a request the grammar or the layer's fields reject.
 * `onError` sees every rejected request, so a test can insist there were none.
 */
export function answerTigerQuery(
  url: string,
  rowsByLayer: Record<string, readonly TigerRow[]>,
  onError?: (message: string, where: string) => void
): { features: Array<{ attributes: TigerRow }>; exceededTransferLimit?: boolean } | { error: { code: number; message: string } } {
  const parsed = new URL(url);
  const layer = /\/MapServer\/(\d+)\/query/.exec(parsed.pathname)?.[1] ?? "";
  const where = parsed.searchParams.get("where") ?? "";
  const rows = rowsByLayer[layer] ?? [];
  const fields = new Set(rows.flatMap((row) => Object.keys(row)));

  let predicate: Predicate;
  try {
    // A layer with no recorded rows still has to read the clause, so fall back
    // to the fields every layer here carries.
    predicate = parseWhere(where, rows.length > 0 ? fields : new Set(["GEOID", "NAME", "BASENAME", "STATE", "COUNTY", "FUNCSTAT", "LSADC"]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError?.(message, where);
    return { error: { code: 400, message } };
  }

  const [orderField, direction] = (parsed.searchParams.get("orderByFields") ?? "GEOID").split(/\s+/);
  const sign = direction?.toUpperCase() === "DESC" ? -1 : 1;
  const sorted = rows.filter(predicate).sort((left, right) => {
    const a = left[orderField];
    const b = right[orderField];
    if (a !== b) {
      if (typeof a === "number" && typeof b === "number") return sign * (a - b);
      return sign * String(a ?? "").localeCompare(String(b ?? ""), "en");
    }
    return String(left.GEOID ?? "").localeCompare(String(right.GEOID ?? ""), "en");
  });

  const offset = Number(parsed.searchParams.get("resultOffset") ?? 0);
  const countParam = parsed.searchParams.get("resultRecordCount");
  const count = countParam === null ? sorted.length : Number(countParam);
  const page = sorted.slice(offset, offset + count);
  return { features: page.map((attributes) => ({ attributes })) };
}
