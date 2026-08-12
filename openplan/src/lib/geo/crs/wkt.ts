/**
 * A small reader for the WKT that lives in a shapefile's `.prj`.
 *
 * ═══ WHY THIS IS A PARSER AND NOT A REGULAR EXPRESSION ═══
 *
 * The obvious way to find a `.prj`'s EPSG code is to search the text for
 * `AUTHORITY["EPSG","…"]` and take the last match, because WKT 1 puts the
 * outermost element's authority last. That is right often enough to look
 * correct and wrong in the case that matters most.
 *
 * An ESRI `.prj` for a State Plane zone routinely carries NO authority on the
 * PROJCS at all, while carrying one on the GEOGCS inside it. The last match is
 * then `EPSG:4269` — NAD83 GEOGRAPHIC — and a reader that trusts it concludes
 * the file is in degrees. It then draws eastings of 6,400,000 survey feet as
 * longitudes, and every feature is silently discarded or, worse, clamped. The
 * planner sees an empty map and no explanation.
 *
 * So the structure has to be read: which element the authority belongs to is
 * the whole question, and only a parser can answer it. This is deliberately not
 * a general WKT implementation — it recognizes quoted strings, brackets and
 * commas, which is all a `.prj` is.
 */

export type WktNode = {
  /** `PROJCS`, `GEOGCS`, `AUTHORITY`, … — always upper case. */
  keyword: string;
  /** The first quoted string, which in every WKT element is its name. */
  name: string | null;
  /** Quoted and bare values in order, as written. */
  values: string[];
  children: WktNode[];
};

/**
 * Parse a `.prj`'s contents, or return null if it is not WKT at all.
 *
 * Bounded rather than trusting: `.prj` files are a few hundred bytes, and a
 * pathological input that is nothing but opening brackets must not be able to
 * exhaust the stack of a parser running inside an import.
 */
export function parseWkt(text: string): WktNode | null {
  // ESRI writes a UTF-8 byte-order mark often enough that a leading U+FEFF
  // would otherwise sit in front of the first keyword.
  const source = text.replace(/﻿/g, "").trim();
  if (source.length === 0 || source.length > 200_000) return null;

  let cursor = 0;
  let depth = 0;

  const skipSpace = (): void => {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  };

  const parseNode = (): WktNode | null => {
    if (depth > 64) return null;
    skipSpace();

    const keywordStart = cursor;
    while (cursor < source.length && /[A-Za-z0-9_]/.test(source[cursor])) cursor += 1;
    const keyword = source.slice(keywordStart, cursor).toUpperCase();
    if (keyword.length === 0) return null;

    skipSpace();
    if (source[cursor] !== "[" && source[cursor] !== "(") {
      // A bare keyword with no bracket is a WKT2 flag such as `NORTH`; it is a
      // value of its parent rather than an element of its own.
      return { keyword, name: null, values: [], children: [] };
    }
    const closing = source[cursor] === "[" ? "]" : ")";
    cursor += 1;
    depth += 1;

    const values: string[] = [];
    const children: WktNode[] = [];
    let name: string | null = null;

    for (;;) {
      skipSpace();
      if (cursor >= source.length) break;
      if (source[cursor] === closing) {
        cursor += 1;
        break;
      }
      if (source[cursor] === ",") {
        cursor += 1;
        continue;
      }

      if (source[cursor] === '"') {
        cursor += 1;
        const start = cursor;
        while (cursor < source.length && source[cursor] !== '"') cursor += 1;
        const value = source.slice(start, cursor);
        cursor += 1;
        values.push(value);
        if (name === null) name = value;
        continue;
      }

      if (/[A-Za-z]/.test(source[cursor])) {
        const child = parseNode();
        if (!child) break;
        if (child.values.length === 0 && child.children.length === 0) {
          values.push(child.keyword);
        } else {
          children.push(child);
        }
        continue;
      }

      const start = cursor;
      while (cursor < source.length && !/[,\])]/.test(source[cursor])) cursor += 1;
      values.push(source.slice(start, cursor).trim());
    }

    depth -= 1;
    return { keyword, name, values, children };
  };

  const node = parseNode();
  return node && node.keyword.length > 0 ? node : null;
}

/** WKT 1 and WKT 2 spellings of a projected coordinate reference system. */
const PROJECTED_KEYWORDS = new Set(["PROJCS", "PROJCRS"]);
/** WKT 1 and WKT 2 spellings of a geographic coordinate reference system. */
const GEOGRAPHIC_KEYWORDS = new Set(["GEOGCS", "GEOGCRS", "GEODCRS", "BASEGEOGCRS", "GEOCCS"]);

/**
 * Step past the wrappers a `.prj` can arrive inside.
 *
 * `BOUNDCRS` wraps the CRS the file is actually in together with a
 * transformation to a hub; the file's own system is the `SOURCECRS`, and
 * reading the hub instead would identify every such file as WGS 84.
 */
function unwrap(node: WktNode): WktNode {
  if (node.keyword === "BOUNDCRS" || node.keyword === "COMPOUNDCRS" || node.keyword === "COMPD_CS") {
    const source = node.children.find((child) => child.keyword === "SOURCECRS");
    const inner = source?.children[0] ?? node.children[0];
    return inner ? unwrap(inner) : node;
  }
  return node;
}

export type WktCrs = {
  kind: "geographic" | "projected";
  /** The element's own name, e.g. `NAD_1983_StatePlane_California_II_FIPS_0402_Feet`. */
  name: string;
  /**
   * The authority on the CRS ELEMENT ITSELF — never one borrowed from a child.
   * Null when the file states none, which is the normal case for ESRI output.
   */
  authority: { authority: string; code: string } | null;
  /**
   * The declared linear unit's conversion factor to metres, for a projected
   * CRS. Used to choose between the metre and survey-foot forms of the same
   * zone when a file identifies itself only by name.
   */
  unitToMetres: number | null;
};

/** The CRS a `.prj` describes, as much of it as the file actually states. */
export function readWktCrs(text: string): WktCrs | null {
  const parsed = parseWkt(text);
  if (!parsed) return null;
  const node = unwrap(parsed);

  const kind = PROJECTED_KEYWORDS.has(node.keyword)
    ? ("projected" as const)
    : GEOGRAPHIC_KEYWORDS.has(node.keyword)
      ? ("geographic" as const)
      : null;
  if (!kind || !node.name) return null;

  // ONLY a direct child. See this file's header: an AUTHORITY nested inside the
  // GEOGCS of a PROJCS identifies the datum's geographic system, not the
  // projected one, and acting on it turns feet into degrees.
  const identifier = node.children.find((child) => child.keyword === "AUTHORITY" || child.keyword === "ID");
  const authority =
    identifier && identifier.values.length >= 2
      ? { authority: identifier.values[0], code: identifier.values[1].replace(/^"|"$/g, "") }
      : null;

  let unitToMetres: number | null = null;
  if (kind === "projected") {
    const unit = node.children.find(
      (child) => child.keyword === "UNIT" || child.keyword === "LENGTHUNIT"
    );
    const factor = unit ? Number(unit.values[1]) : NaN;
    if (Number.isFinite(factor) && factor > 0) unitToMetres = factor;
  }

  return { kind, name: node.name, authority, unitToMetres };
}
