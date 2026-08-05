/**
 * THE DETECTORS BEHIND "A … MAY NOT DISCARD A READ ERROR".
 *
 * A Supabase read hands back `null` data for both "there is nothing here" and
 * "this query failed". Code that keeps only the rows cannot tell the two apart,
 * so every empty-state sentence, every `0`, every "Not linked" it renders states
 * a failure as a fact about the world. This product has shipped that sentence to
 * the PUBLIC twice.
 *
 * WHY THIS FILE EXISTS. The same five detectors are now run over three different
 * surfaces — pages, API routes, and library/component code — and each surface
 * has its own ratchet because each has its own fix. Three copies of a parser
 * would drift, and a detector that silently stopped matching real syntax makes
 * every ratchet above it pass while proving nothing. So the parsing lives here
 * once and the guards own only their scope, their ratchet, and their evidence.
 *
 * ALL THREE GUARDS NOW READ THEIR DETECTORS FROM HERE (2026-08-04). The route
 * guard predated this file and carried its OWN copy of R1 and R2; that copy is
 * gone, and collapsing it was not a tidy-up — it was how the route surface got
 * asked R3, R4 and R5 for the first time, which found five array-destructure
 * sites nobody had ever looked for. A duplicated parser does not just drift;
 * it fixes the questions its copy happens to ask.
 *
 * The two places the old route copy differed are now the shared behaviour: R1
 * blanks comments first, and a read may be an `.rpc(` call as well as `.from(`.
 * Neither changed any route count.
 *
 * EVERY DETECTOR BALANCES DELIMITERS RATHER THAN PATTERN-MATCHING, because the
 * shapes nest — an array destructure holds arbitrary object patterns, a
 * classifier call takes an expression that can itself contain parentheses, and a
 * declaration's initializer holds `Promise.all([...])`. A regex that "mostly"
 * matched would undercount silently, which is the failure mode that makes a
 * guard stop being read.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Source hygiene
// ---------------------------------------------------------------------------

/**
 * Blank out comments while PRESERVING every offset, so a scan can still slice by
 * index. A comment naming `result.error` must not vouch for a read, and a
 * comment naming `result.data` must not incriminate one — `read-outcome.ts`
 * documents the defect it fixes by writing the defect out in prose, and would
 * otherwise be counted as an instance of it.
 *
 * Whole-line `//` comments only: a trailing `//` cannot be stripped without a
 * real lexer, because `"https://…"` would go with it.
 */
export function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

/** Identifiers are matched by name, and `$` is legal in one but special in a regex. */
export function escapeIdentifier(name: string): string {
  return name.replace(/\$/g, "\\$");
}

/** Index just past the delimiter that closes the one opened before `from`. */
export function balancedEnd(source: string, from: number, open: string, close: string): number {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) depth -= 1;
    i += 1;
  }
  return i;
}

/** Split on top-level commas only, so nested patterns stay whole. */
export function splitTopLevel(block: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of block) {
    if ("{[(".includes(char)) depth += 1;
    else if ("}])".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------
// R1 — data-only destructure
// ---------------------------------------------------------------------------

/**
 * `const { data } = await …`, `const { data: rows } = await …`, and the
 * CONDITIONAL spelling `const { data: rows } = ids.length ? await … : { data: [] }`.
 *
 * The renamed form requires a plain IDENTIFIER after the colon on purpose. It is
 * what excludes `const { data: { user } } = await supabase.auth.getUser()`,
 * which binds nothing called `data` and is the standard session read in this
 * tree.
 *
 * THE TERNARY BRANCH WAS ADDED 2026-08-04, ON EVIDENCE, and it is the reason
 * this is worth reading twice. The pattern used to anchor on `= await`, so the
 * "skip the query when there is nothing to look up" spelling — which is the same
 * defect, with the error just as unbound — was invisible. It was written down as
 * a known miss and asserted as one; re-measuring the tree after the fix lanes
 * landed found FOUR live instances of it, all on pages whose R1 ratchet was
 * empty and whose header said the debt was paid. A miss that is documented is
 * still a miss, and this one was hiding real sites on the surface the class has
 * twice reached the public through.
 *
 * `[^;{}]*?` is what keeps the condition inside its own statement without a
 * balanced scan: it cannot run past the `;` that ends the declaration, and it
 * cannot swallow a block. The price is that a condition containing braces (an
 * object literal or a callback) is not seen — no instance in this tree is
 * written that way, and widening it to a balanced scan would make an unterminated
 * final declaration reach for `await` in unrelated code below it.
 */
export const DATA_ONLY =
  /const\s*\{\s*data(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*(?:await\b|[^;{}]*?\?\s*await\b)/g;

/**
 * STRICTER THAN THE ROUTE GUARD'S COPY, deliberately: comments are blanked
 * first. Library code documents this very defect by quoting it — `read-outcome.ts`
 * and `read-failures.ts` both write `const { data } = await …` into a doc block
 * to explain what they exist to prevent — and counting a warning as the thing it
 * warns about is how a ratchet acquires debt nobody can pay off.
 */
export function dataOnlyCount(source: string): number {
  return blankComments(source).match(DATA_ONLY)?.length ?? 0;
}

// ---------------------------------------------------------------------------
// R2 — unchecked result reads
// ---------------------------------------------------------------------------

/**
 * Index of the `;` that ends the statement starting at `from`.
 *
 * A balanced scan, not a regex. An initializer holds `Promise.all([...])` with
 * arbitrary nesting, and object literals full of semicolon-free commas.
 */
export function statementEnd(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === ";" && depth === 0) return i;
  }
  return source.length;
}

/** `const x =`, `let x =`, and `const [a, b, c] =`. Object patterns are R1's job. */
const DECLARATION = /\b(?:const|let|var)\s+(?:([A-Za-z_$][\w$]*)|\[([^\]]*)\])\s*(?::[^=]*)?=/g;

export type Declaration = { names: string[]; start: number; end: number; initializer: string };

export function declarations(source: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of source.matchAll(DECLARATION)) {
    const start = match.index ?? 0;
    const afterEquals = start + match[0].length;
    const end = statementEnd(source, afterEquals);
    const names = match[1]
      ? [match[1]]
      : match[2]
          .split(",")
          .map((part) => part.trim())
          .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
    found.push({ names, start, end, initializer: source.slice(afterEquals, end) });
  }
  return found;
}

/**
 * A database read, in any of the spellings that matter: `await supabase.from(…)`,
 * the `cond ? await supabase.from(…) : { data: [], error: null }` ternary,
 * `await Promise.all([… .from(…) …])`, and `await supabase.rpc(…)`.
 *
 * WHY `.rpc(` IS HERE AND NOT IN THE ROUTE GUARD'S COPY: routes read tables,
 * but library code reaches for stored functions — the engagement demographics,
 * near-duplicate, hotspot and behavioural-onramp KPI loaders are all `.rpc(`
 * reads, and every one of them returns the same `{ data, error }` shape with the
 * same way of discarding the error. Excluding them would have made this guard
 * blind to a whole lane of the module it was written for.
 */
export function isReadDeclaration(initializer: string): boolean {
  return /\bawait\b/.test(initializer) && (initializer.includes(".from(") || /\.rpc\s*\(/.test(initializer));
}

/**
 * What each use of `name` reads: the property name, or `null` for a bare use.
 *
 * The lookbehind excludes `.name`, so `row.result` is not counted as a use of a
 * variable called `result`.
 */
export function usesOf(source: string, name: string, from: number, to: number): Array<string | null> {
  const region = source.slice(from, to);
  const identifier = new RegExp(`(?<![\\w$.])${escapeIdentifier(name)}(?![\\w$])`, "g");
  const uses: Array<string | null> = [];
  for (const match of region.matchAll(identifier)) {
    const trailing = region.slice((match.index ?? 0) + name.length);
    const property = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(trailing);
    uses.push(property ? property[1] : null);
  }
  return uses;
}

/**
 * Read results whose error nobody looked at, with the offset just past each
 * declaration — so a responsiveness proof can insert a check into REAL source
 * and watch the count fall.
 *
 * THE SCOPE RULE IS THE SHADOWING ANSWER, and it is load-bearing: a
 * declaration's uses are counted only up to the NEXT declaration of the same
 * identifier, because a later, properly-checked declaration cannot vouch for an
 * earlier one. Thirteen real route defects hid from a plain grep behind exactly
 * that — a file-wide search for `fundingAwardsResult.error` found the second
 * declaration and concluded the first was fine.
 *
 * WHAT EXEMPTS A DECLARATION, and why one rule covers every benign pattern with
 * no special-casing. A declaration is flagged only when at least one use is
 * `IDENT.data` AND EVERY use is an `IDENT.data` access. Any `.error` read, any
 * bare-identifier use, or a reassignment exempts it — which spares, without
 * naming any of them: the tuple loop that checks the error under an alias;
 * classify-then-return; retry-then-reassign; the `[a, b].map(r => r.error)`
 * gate; count-only queries; and — the one that matters most for LIBRARY code —
 * the `{ rows, error }` seam a loader returns for its caller to surface, which
 * uses the result bare.
 *
 * THE MISS, STATED SO NOBODY MISTAKES GREEN FOR PROVEN: a result handed to a
 * FUNCTION that ignores its error is not flagged. The bare-identifier use
 * exempts it, and telling "passed to something that checks" from "passed to
 * something that swallows" needs an inter-procedural walk this does not do.
 */
export function uncheckedResults(source: string): Array<{ name: string; endsAt: number }> {
  const code = blankComments(source);
  const declared = declarations(code);
  const found: Array<{ name: string; endsAt: number }> = [];

  for (let i = 0; i < declared.length; i += 1) {
    const declaration = declared[i];
    if (!isReadDeclaration(declaration.initializer)) continue;

    for (const name of declaration.names) {
      const shadow = declared.slice(i + 1).find((later) => later.names.includes(name));
      const uses = usesOf(code, name, declaration.end, shadow ? shadow.start : code.length);
      if (uses.length === 0) continue;
      if (!uses.includes("data")) continue;
      if (!uses.every((use) => use === "data")) continue;
      found.push({ name, endsAt: declaration.end + 1 });
    }
  }

  return found;
}

export function uncheckedResultCount(source: string): number {
  return uncheckedResults(source).length;
}

// ---------------------------------------------------------------------------
// R3 — array destructuring that drops the error
// ---------------------------------------------------------------------------

/**
 * `const [{ data: a }, { data: b }] = await Promise.all([...])`.
 *
 * Counts only bindings that take `data` WITHOUT `error` — `{ data, error }` in
 * the same position is the correct shape. Destructuring to NAMED results and
 * checking `.error` later is also correct and ignored here; R2 is what judges
 * those.
 */
export function arrayDiscardedBindings(source: string): number {
  const code = blankComments(source);
  let count = 0;
  for (const match of code.matchAll(/const\s*\[/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = balancedEnd(code, start, "[", "]");
    if (!/^\s*=\s*await/.test(code.slice(end, end + 30))) continue;
    for (const part of splitTopLevel(code.slice(start, end - 1))) {
      const trimmed = part.trim();
      if (!trimmed.startsWith("{")) continue;
      if (/\bdata\b/.test(trimmed) && !/\berror\b/.test(trimmed)) count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// R4 / R5 — a classifier used as the only error branch
// ---------------------------------------------------------------------------

/** The false branch of the ternary whose `?` sits at `question`. */
export function ternaryFalseBranch(source: string, question: number): string {
  let depth = 0;
  for (let i = question + 1; i < source.length; i += 1) {
    const char = source[i];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === ":" && depth === 0) {
      let end = i + 1;
      let inner = 0;
      while (end < source.length) {
        const c = source[end];
        if ("([{".includes(c)) inner += 1;
        else if (")]}".includes(c)) {
          if (inner === 0) break;
          inner -= 1;
        } else if (c === ";" && inner === 0) break;
        end += 1;
      }
      return source.slice(i + 1, end);
    }
  }
  return "";
}

/**
 * Is the result named `subject` handed to anything that COLLECTS it?
 *
 * Any collector counts, not just `reads.check` literally — several lanes route
 * through `collectUnlessPending`, and matching only the inner call would mark
 * every extracted lane as unfixed and freeze the ratchet, the one thing a
 * ratchet must never be.
 */
export function isCollectedSomewhere(source: string, subject: string): boolean {
  return new RegExp(`\\b\\w*(?:check|collect)\\w*\\s*\\([^)]*\\b${escapeIdentifier(subject)}\\b`, "i").test(source);
}

/** The argument span of every `looksLikePendingSchema(…)` call in `code`. */
function classifierArgumentRanges(code: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const match of code.matchAll(/looksLikePendingSchema\s*\(/g)) {
    const start = (match.index ?? 0) + match[0].length;
    ranges.push([start, balancedEnd(code, start, "(", ")")] as const);
  }
  return ranges;
}

/**
 * Does this code do anything with `subject`'s error BESIDES classify it, inside
 * the scope of the declaration that reaches the classifier call at `at`?
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A CARVE-OUT. `isCollectedSomewhere` above
 * recognises one spelling of disclosure — handing the whole result to something
 * named `check`/`collect`. Re-measuring the tree on 2026-08-04, after the fix
 * lanes landed, found that SIX of the six R4/R5 sites still being reported were
 * CORRECT code that discloses its failure some other way:
 *
 *   - `loadAerialMissionsAndPackagesForProject` classifies, and RETURNS EARLY
 *     with an `unreadableReason` for every non-pending error, so the flag is only
 *     reachable when the failure really is a pending migration;
 *   - `loadProjectBudgetInputs` turns each error into `unreadableReason(r.error)`
 *     and returns the lot as `readFailures`;
 *   - `api/analysis/context` returns a 500 on `r.error && !pending` before the
 *     flag is ever used.
 *
 * A guard reporting those as defects would have been overridden, and after the
 * first override the real finding is overridden too. So the rule is generalised
 * rather than special-cased, to the SAME rule R2 already uses: reading the
 * subject's `.error` at all — for a return, a log, a reason string, anything —
 * exempts it. Nothing empty is being offered as an unqualified answer once the
 * code has looked at the failure a second time.
 *
 * THE SCOPE RULE IS LOAD-BEARING and is why this is not a file-wide grep.
 * `aerial/queries.ts` declares `missionsResult` in three different functions;
 * one of them checks its error and two swallow it. A file-wide search finds the
 * check and clears all three — the exact trap that hid thirteen route defects.
 * So the window runs from the declaration that reaches `at` to the NEXT
 * declaration of the same name, and `.error` reads inside a classifier argument
 * do not count, because classifying is the thing being judged.
 */
export function disclosesErrorOutsideClassifier(code: string, subject: string, at: number): boolean {
  const ranges = classifierArgumentRanges(code);
  const declared = declarations(code).filter((declaration) => declaration.names.includes(subject));
  const owningIndex = declared.map((declaration) => declaration.start <= at).lastIndexOf(true);
  const from = owningIndex >= 0 ? declared[owningIndex].end : 0;
  const next = declared[owningIndex + 1];
  const to = next ? next.start : code.length;

  const reads = new RegExp(`\\b${escapeIdentifier(subject)}\\s*\\??\\s*\\.\\s*error\\b`, "g");
  for (const match of code.matchAll(reads)) {
    const index = match.index ?? 0;
    if (index < from || index >= to) continue;
    if (ranges.some(([start, end]) => index >= start && index < end)) continue;
    return true;
  }
  return false;
}

/**
 * `looksLikePendingSchema(x.error?.message) ? [] : (x.data ?? [])`.
 *
 * This KEEPS the error and then throws it away. It classifies exactly one
 * failure — a migration this deployment has not run — and turns every other one,
 * a revoked grant or an RLS change or a dropped connection, into `[]`: an
 * answer. The rule is "classify FIRST, then collect what is left"; this
 * classifies and never collects.
 *
 * A ternary whose FALSE branch is the original RESULT is a RETRY, not this
 * defect, and is excluded: it preserves the untouched result, error and all, for
 * a collector further down. Flagging it would send someone to "fix" correct
 * code, which is how a guard loses its authority.
 */
export function classifierOnlyBranches(source: string): number {
  const code = blankComments(source);
  let count = 0;
  for (const match of code.matchAll(/looksLikePendingSchema\s*\(/g)) {
    const end = balancedEnd(code, (match.index ?? 0) + match[0].length, "(", ")");
    const question = /^\s*\?/.exec(code.slice(end, end + 10));
    if (!question) continue;
    if (!/\.data\b/.test(ternaryFalseBranch(code, end + question[0].length - 1))) continue;
    // ...UNLESS the same result is also collected, or its error is read again
    // outside the classifier. Once the failure is disclosed by name — however it
    // is spelled — resolving the rows to `[]` is correct: the surface is no
    // longer presenting that emptiness as an answer.
    const subject = /([A-Za-z_$][\w$]*)\s*\.\s*error/.exec(code.slice((match.index ?? 0) + match[0].length, end));
    if (subject && isCollectedSomewhere(code, subject[1])) continue;
    if (subject && disclosesErrorOutsideClassifier(code, subject[1], match.index ?? 0)) continue;
    count += 1;
  }
  return count;
}

/**
 * The same defect written across two statements:
 *
 *     const xPending = looksLikePendingSchema(r.error?.message);
 *     …fifty lines later…
 *     const rows = xPending ? [] : (r.data ?? []);
 *
 * Invisible to `classifierOnlyBranches`, which requires the `?` within ten
 * characters of the call. Six lanes on the project detail page were written this
 * way and read as clean while the board they fed stamped each one "Not linked"
 * over reads that had failed.
 *
 * A declaration counts only when all four hold: the classifier's argument names
 * a result (`SUBJ.error`); the flag is not ALSO true for every other failure;
 * the declared flag is used somewhere as a ternary condition whose FALSE branch
 * yields `.data`; and that result is never handed to a collector. The retry
 * shape is excluded for free, because its false branch yields the original
 * RESULT rather than its `.data`.
 *
 * THE SECOND CONDITION WAS ADDED 2026-08-04, ON EVIDENCE, and it is a rule
 * rather than a carve-out. `const statedBudgetPending =
 * looksLikePendingSchema(r.error?.message) || Boolean(r.error)` reads as the
 * defect to a scanner that stops at the classifier call, but it is not one:
 * that flag is true for EVERY failure, so nothing empty is ever offered as an
 * answer. What is left wrong there — every failure being labelled "pending", so
 * an operator is told to run a migration that is already applied — is a
 * different and lesser defect, and flagging it under this name would teach
 * people that this guard reports correct code. A flag whose declaration reads
 * `SUBJ.error` again OUTSIDE the classifier's argument is therefore exempt.
 */
export function twoStepClassifierOnly(source: string): number {
  const code = blankComments(source);
  let count = 0;
  for (const match of code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*looksLikePendingSchema\s*\(/g)) {
    const flag = escapeIdentifier(match[1]);
    const argStart = (match.index ?? 0) + match[0].length;
    const argEnd = balancedEnd(code, argStart, "(", ")");
    const subject = /([A-Za-z_$][\w$]*)\s*\.\s*error/.exec(code.slice(argStart, argEnd));
    if (!subject) continue;

    // Does the REST of the declaration widen the flag to every failure?
    const restOfDeclaration = code.slice(argEnd, statementEnd(code, argEnd));
    if (new RegExp(`\\b${escapeIdentifier(subject[1])}\\s*\\??\\s*\\.\\s*error\\b`).test(restOfDeclaration)) continue;

    let discardsRows = false;
    for (const use of code.matchAll(new RegExp(`\\b${flag}\\b\\s*\\?`, "g"))) {
      const question = (use.index ?? 0) + use[0].length - 1;
      if (/\.data\b/.test(ternaryFalseBranch(code, question))) {
        discardsRows = true;
        break;
      }
    }
    if (!discardsRows) continue;
    if (isCollectedSomewhere(code, subject[1])) continue;
    if (disclosesErrorOutsideClassifier(code, subject[1], match.index ?? 0)) continue;
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// R6 — the error read that swallows anyway
// ---------------------------------------------------------------------------

/** Both branches of the ternary whose `?` sits at `question`. */
function ternaryBranches(source: string, question: number): { whenTrue: string; whenFalse: string } {
  let depth = 0;
  for (let i = question + 1; i < source.length; i += 1) {
    const char = source[i];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === ":" && depth === 0) {
      return { whenTrue: source.slice(question + 1, i), whenFalse: ternaryFalseBranch(source, question) };
    }
  }
  return { whenTrue: "", whenFalse: "" };
}

/**
 * `r.error ? [] : (r.data ?? [])` — and every ternary like it.
 *
 * WHY THIS EXISTS, AND WHY IT WAS THE SHARPEST HOLE FOUND ON 2026-08-04. Every
 * other detector in this file treats ANY read of `SUBJ.error` as disclosure, on
 * the stated assumption that code which has looked at the failure a second time
 * is no longer offering an empty result as an unqualified answer. This spelling
 * falsifies that assumption: it looks at the error and offers the empty answer
 * anyway. It is the shape a model that has half-learned the lesson writes —
 * "handle the error" understood as "branch on it" rather than "surface it" —
 * and a fresh instance planted in a route, a page, a library file and a client
 * component was invisible to every guard in this repo (Fable review, Part 1).
 *
 * WHAT COUNTS. A ternary whose CONDITION reads `SUBJ.error` (bare or wrapped in
 * closing parens, e.g. `Boolean(r.error)`) and where exactly ONE branch reads
 * `SUBJ.data`. The branch without `.data` is the answer given when the read
 * failed; if that branch does not itself mention `SUBJ.error`, the failure is
 * gone and whatever that branch yields — `[]`, `null`, `0`, a default object —
 * is presented as a fact about the world.
 *
 * WHAT IS SPARED, so this cannot flag correct code:
 *   - the inline disclosure: `r.error ? { rows: [], error: r.error } : …` — the
 *     swallow branch mentions the error, so the caller still receives it;
 *   - the retry: `r.error ? await narrowerRead() : r` — no branch reads `.data`,
 *     the original result survives whole;
 *   - a result that is COLLECTED (`reads.check(…, r)` or any check/collect call);
 *   - a result used BARE anywhere in the declaration's scope — the same rule R2
 *     applies, and it was added on the evidence of the first tree measurement:
 *     the RTP pages hand the whole result to `classifyRead(reads, …, result)`
 *     and THEN resolve rows with this ternary, which is the correct
 *     classify-then-collect shape, and `classifyRead` contains neither "check"
 *     nor "collect" for the collector heuristic to find. A detector that
 *     flagged those 20+ correct sites would be overridden once and then
 *     ignored. The price is the same one R2 pays and documents: a result
 *     handed to a function that IGNORES its error is not flagged either;
 *   - a result whose `.error` is read again somewhere else in the declaration's
 *     scope, outside classifier arguments and outside other ternary conditions
 *     of this same shape — a log, a returned reason, a thrown error all count;
 *   - `r.error?.message` (optional chain) and `r.error ?? x` (nullish
 *     coalescing), which contain no ternary at all.
 *
 * Scope-aware like R2/R4/R5: a later declaration of the same name cannot vouch
 * for an earlier one.
 */
export function errorTernarySwallows(source: string): number {
  const code = blankComments(source);
  const classifierRanges = (() => {
    const ranges: Array<readonly [number, number]> = [];
    for (const match of code.matchAll(/looksLikePendingSchema\s*\(/g)) {
      const start = (match.index ?? 0) + match[0].length;
      ranges.push([start, balancedEnd(code, start, "(", ")")] as const);
    }
    return ranges;
  })();

  // First pass: find every error-ternary condition, per subject, so the
  // disclosure check below can exclude ALL of them — two swallows of the same
  // result must not vouch for each other.
  type Candidate = { subject: string; errorReadAt: number; question: number };
  const candidates: Candidate[] = [];
  const conditionReadsBySubject = new Map<string, number[]>();

  for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*error\b/g)) {
    const subject = match[1];
    const index = match.index ?? 0;
    let i = index + match[0].length;
    while (i < code.length && /[\s)]/.test(code[i])) i += 1;
    if (code[i] !== "?" || code[i + 1] === "." || code[i + 1] === "?") continue;
    candidates.push({ subject, errorReadAt: index, question: i });
    const list = conditionReadsBySubject.get(subject) ?? [];
    list.push(index);
    conditionReadsBySubject.set(subject, list);
  }

  let count = 0;
  for (const { subject, errorReadAt, question } of candidates) {
    const { whenTrue, whenFalse } = ternaryBranches(code, question);
    const dataRead = new RegExp(`\\b${escapeIdentifier(subject)}\\s*\\??\\s*\\.\\s*data\\b`);
    const errorRead = new RegExp(`\\b${escapeIdentifier(subject)}\\s*\\??\\s*\\.\\s*error\\b`);
    const trueHasData = dataRead.test(whenTrue);
    const falseHasData = dataRead.test(whenFalse);
    if (trueHasData === falseHasData) continue;
    const swallowBranch = trueHasData ? whenFalse : whenTrue;
    if (errorRead.test(swallowBranch)) continue;
    // A branch that yields something NAMED for the failure is a disclosure, not
    // a swallow — `campaignPlace.error ? UNREADABLE_PORTAL_PLACE : …` hands the
    // caller a value whose whole meaning is "this could not be read". Found on
    // the first tree measurement in `public-portal-data.ts`, which is the module
    // that FIXED the public read-failure class; flagging its fix as the defect
    // would teach everyone to ignore this detector.
    if (/\b\w*(?:unreadable|unavailable)\w*\b/i.test(swallowBranch)) continue;
    if (isCollectedSomewhere(code, subject)) continue;

    // Disclosure elsewhere in this declaration's scope — excluding classifier
    // arguments and every error-ternary condition of this subject.
    const declared = declarations(code).filter((declaration) => declaration.names.includes(subject));
    const owningIndex = declared.map((declaration) => declaration.start <= errorReadAt).lastIndexOf(true);
    const from = owningIndex >= 0 ? declared[owningIndex].end : 0;
    const next = declared[owningIndex + 1];
    const to = next ? next.start : code.length;
    const conditionReads = conditionReadsBySubject.get(subject) ?? [];

    // A bare use anywhere in scope exempts — R2's rule, for R2's reason.
    if (usesOf(code, subject, from, to).some((use) => use === null)) continue;

    let disclosed = false;
    for (const read of code.matchAll(new RegExp(`\\b${escapeIdentifier(subject)}\\s*\\??\\s*\\.\\s*error\\b`, "g"))) {
      const readIndex = read.index ?? 0;
      if (readIndex < from || readIndex >= to) continue;
      if (conditionReads.includes(readIndex)) continue;
      if (classifierRanges.some(([start, end]) => readIndex >= start && readIndex < end)) continue;
      // A read inside one of this subject's swallow BRANCHES was already judged
      // above (the inline-disclosure exemption); reads inside the data branch
      // do not disclose — but distinguishing them here costs precision for no
      // real case, so any non-condition, non-classifier read counts.
      disclosed = true;
      break;
    }
    if (disclosed) continue;

    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Responsiveness machinery — what an EMPTY ratchet needs to stay meaningful
// ---------------------------------------------------------------------------

/** `const { data, error } = await …` — the correct shape, which R1 must not flag. */
export const KEPT_ERROR =
  /const(\s*\{\s*data(?:\s*:\s*[A-Za-z_$][\w$]*)?)\s*,\s*error(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*await/g;

/** Drop the `error` binding, leaving the `data` one exactly as it was written. */
export function droppingTheErrorBinding(source: string): string {
  return source.replace(KEPT_ERROR, "const$1 } = await");
}

/**
 * Read results a file both binds AND checks: every use is `.data` or `.error`,
 * with at least one of each.
 *
 * A result also used BARE is skipped, because R2 exempts those however they are
 * rewritten — including one in the candidate set would make a responsiveness
 * proof report a miss that is documented behaviour, not a broken detector.
 */
export function checkedResultNames(source: string): string[] {
  const code = blankComments(source);
  const declared = declarations(code);
  const names: string[] = [];

  for (let i = 0; i < declared.length; i += 1) {
    const declaration = declared[i];
    if (!isReadDeclaration(declaration.initializer)) continue;

    for (const name of declaration.names) {
      const shadow = declared.slice(i + 1).find((later) => later.names.includes(name));
      const uses = usesOf(code, name, declaration.end, shadow ? shadow.start : code.length);
      if (!uses.includes("error") || !uses.includes("data")) continue;
      if (!uses.every((use) => use === "error" || use === "data")) continue;
      names.push(name);
    }
  }

  return names;
}

/**
 * Results a file CLASSIFIES and also discloses — the population R4/R5 need in
 * order to prove themselves once their ratchets empty.
 *
 * A name qualifies when `looksLikePendingSchema(NAME.error…)` appears and the
 * same `NAME.error` is read somewhere outside that argument. Those are the sites
 * `disclosesErrorOutsideClassifier` spares, so removing the disclosure must put
 * them back — and the set GROWS as the remaining swallows are fixed, which a
 * "count what is left" proof can never do.
 */
export function classifiedAndDisclosedNames(source: string): string[] {
  const code = blankComments(source);
  const names = new Set<string>();
  for (const match of code.matchAll(/looksLikePendingSchema\s*\(/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const subject = /([A-Za-z_$][\w$]*)\s*\??\s*\.\s*error/.exec(code.slice(start, balancedEnd(code, start, "(", ")")));
    if (!subject) continue;
    if (disclosesErrorOutsideClassifier(code, subject[1], match.index ?? 0)) names.add(subject[1]);
  }
  return [...names];
}

/**
 * Turn every `NAME.error` read that is NOT a classifier argument into a `.data`
 * read — the smallest edit that strips a disclosure while leaving the
 * classification intact.
 */
export function removingTheErrorDisclosure(source: string, name: string): string {
  const ranges = classifierArgumentRanges(blankComments(source));
  const reads = new RegExp(`\\b${escapeIdentifier(name)}(\\s*\\??\\s*)\\.(\\s*)error\\b`, "g");
  let out = "";
  let last = 0;
  for (const match of source.matchAll(reads)) {
    const index = match.index ?? 0;
    if (ranges.some(([start, end]) => index >= start && index < end)) continue;
    out += source.slice(last, index) + `${name}${match[1]}.${match[2]}data`;
    last = index + match[0].length;
  }
  return out + source.slice(last);
}

/** Rewrite every `NAME.error` read into a `.data` read — the smallest edit that un-checks one result. */
export function removingTheErrorCheck(source: string, name: string): string {
  return source.replace(
    new RegExp(`\\b${escapeIdentifier(name)}(\\s*\\??\\s*)\\.(\\s*)error\\b`, "g"),
    `${name}$1.$2data`
  );
}

// ---------------------------------------------------------------------------
// Walking a tree, and the ratchet shape all three guards use
// ---------------------------------------------------------------------------

export const ROOT = process.cwd();

/** Repo-relative, forward-slashed, so a ratchet entry reads the same on any platform. */
export function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** Every file under `dir` the predicate accepts, recursively. Missing directories yield nothing. */
export function sourceFiles(dir: string, accept: (basename: string) => boolean): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full, accept);
    return accept(entry) ? [full] : [];
  });
}

export function countsBy(files: string[], detect: (source: string) => number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const found = detect(readFileSync(file, "utf8"));
    if (found > 0) counts.set(relative(file), found);
  }
  return counts;
}

/**
 * A ceiling that may only ever fall, in three assertions.
 *
 * The third — staleness — is the one people leave out and the one that keeps the
 * list honest: without it a fixed file sits on the ratchet forever claiming a
 * debt it no longer has, and the next reader trusts a number that quietly
 * stopped being true.
 */
export function ratchet(
  name: string,
  known: ReadonlyArray<readonly [string, number]>,
  files: () => string[],
  detect: (source: string) => number,
  fixHint: string,
  subject = "file"
) {
  const listed = new Map(known.map(([file, count]) => [file, count]));

  describe(name, () => {
    it(`adds no new ${subject}`, () => {
      expect([...countsBy(files(), detect).keys()].filter((file) => !listed.has(file)), fixHint).toEqual([]);
    });

    it(`lets no listed ${subject} get worse`, () => {
      const worsened = [...countsBy(files(), detect).entries()]
        .filter(([file, count]) => listed.has(file) && count > (listed.get(file) ?? 0))
        .map(([file, count]) => `${file}: ${listed.get(file)} → ${count}`);
      expect(worsened, `these ${subject}s added another discarded read error`).toEqual([]);
    });

    it(`keeps the ceiling honest — a fixed ${subject} must be removed from the list`, () => {
      const actual = countsBy(files(), detect);
      const stale = known
        .filter(([file, count]) => (actual.get(file) ?? 0) < count)
        .map(
          ([file, count]) =>
            `${file}: listed ${count}, actually ${actual.get(file) ?? 0} — lower or delete this entry`
        );
      expect(stale, "the ratchet moved; update the list").toEqual([]);
    });
  });
}
