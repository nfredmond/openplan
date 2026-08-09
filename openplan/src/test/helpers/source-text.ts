/**
 * STRIPPING COMMENTS BEFORE A GUARD SCANS SOURCE.
 *
 * ====================================================== WHY THIS EXISTS
 *
 * A guard that greps source is asserting something about the CODE. A comment is
 * a paragraph ABOUT the code, and letting one reach the matcher has now broken
 * guards in both directions, five times:
 *
 *   - `every-api-route-has-a-caller` matched a route path written inside an
 *     operator-facing sentence, and excused a route nothing called (recorded in
 *     CLAUDE.md);
 *   - a `county_runs` projection guard passed with the column REMOVED, because
 *     the comment above the query explained why the column was needed;
 *   - a body-limit guard flagged a route whose only offence was a comment
 *     naming the forbidden call in order to warn against it;
 *   - a registry/CSS sync check failed on a palette id of "x" that exists
 *     nowhere, lifted out of a comment demonstrating a selector;
 *   - and the two "false pass" cases above are the mirror of the two "false
 *     fail" ones — the same root either way.
 *
 * ============================================ WHY IT IS A SHARED HELPER
 *
 * Because three separate implementations had grown in `src/test/`, and no two
 * behaved alike:
 *
 *   A. dropped whole LINES beginning with `//` — missed trailing comments
 *      (`const x = 1; // …`) and shifted every line number after the first one;
 *   B. regexed to end of line and protected `://` — caught trailing comments
 *      but collapsed offsets;
 *   C. blanked comments to spaces so offsets survived — but only matched `//`
 *      at the start of a line, so it missed trailing comments too.
 *
 * A guard's author could not tell which behaviour they were getting, and two of
 * the three could still be defeated by a trailing comment. This does all three
 * jobs: catches trailing comments, preserves offsets, and protects `://`.
 *
 * ============================ WHY SQL IS NOT HANDLED HERE, AND MUST NOT BE
 *
 * SQL comments start with `--`, and the migrations are full of them. Bolting
 * that onto this function would be actively dangerous: `--` is the DECREMENT
 * OPERATOR in TypeScript, so blanking from `--` to end of line would delete
 * real code from every `.ts` file this helper is pointed at (`for (let i = n;
 * i > 0; i--)` loses the rest of its line). A SQL stripper has to be a separate
 * function with its own name, chosen deliberately by a caller who knows what
 * they are reading. Do not add a `sql: true` flag to this one either — a flag
 * that changes what counts as code is a flag somebody will pass by accident.
 *
 * CSS is safe to pass through here. It has no `//` comments, so the only `//`
 * in a stylesheet is inside a URL, which the `://` guard already protects.
 *
 * ================================================== KNOWN LIMIT, STATED
 *
 * A `//` inside a STRING LITERAL is blanked too — `const s = "a // b"` becomes
 * `const s = "a `. Distinguishing that needs a real lexer, which is not worth
 * it for a test helper. The consequence is a possible false NEGATIVE (a guard
 * missing a violation hidden inside such a string), never a false positive, so
 * it fails in the safer direction. `://` is protected because URLs in code are
 * common and would otherwise be truncated.
 */

/**
 * Replace every comment with spaces, leaving the source the same length.
 *
 * Blanking rather than deleting is deliberate: line numbers and character
 * offsets survive, so a guard can still report WHERE it found something, and a
 * regex that spans lines behaves the same as it would on the original.
 */
export function stripSourceComments(source: string): string {
  return (
    source
      // Block comments, including JSDoc. Newlines are preserved so line numbers
      // do not move; everything else becomes a space.
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
      // Line comments, INCLUDING trailing ones. The `[^:]` guard keeps `://`
      // (URLs) intact; the capture is put back so the preceding character is
      // not eaten.
      .replace(/(^|[^:])(\/\/[^\n]*)/g, (_match, prefix: string, comment: string) =>
        `${prefix}${" ".repeat(comment.length)}`
      )
  );
}

/**
 * Convenience for the common case: does the CODE contain this text, ignoring
 * anything written about it in a comment?
 */
export function codeIncludes(source: string, needle: string): boolean {
  return stripSourceComments(source).includes(needle);
}
