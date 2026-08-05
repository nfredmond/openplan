import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PAGE MAY NOT DISCARD A READ ERROR.
 *
 * `const { data } = await supabase.from(...)` hands back `null` for both "there
 * is nothing here" and "this query failed". A page that destructures only `data`
 * cannot tell the two apart, so every empty-state sentence it renders — written
 * for the first case — states the second one as fact.
 *
 * This is not hypothetical and it is not rare. Two shipped instances, both on
 * surfaces the PUBLIC reads:
 *
 *   - the public plan page rendered "No projects have been published for this
 *     plan yet", an agency publicly stating it had funded nothing, because a
 *     read failed;
 *   - the engagement portal rendered "No published feedback yet. Be the first to
 *     share something", telling residents nobody in their community had taken
 *     part, on the strength of a broken query.
 *
 * WHY A RATCHET RATHER THAN A CLEAN ASSERTION. There were 23 of these across 13
 * pages when this guard was written. Fixing them all in one change would have
 * been a large, unreviewable diff, and a plain assertion would have had to be
 * disabled until that landed — which is how a guard becomes decoration. So the
 * list below was a CEILING that could only fall.
 *
 * THE DEBT IS PAID (2026-08-03). All 13 pages were fixed in one coordinated run
 * and `KNOWN_DISCARDED` is now EMPTY, which turns the first assertion into the
 * plain rule its name always claimed: no page under `src/app` may destructure
 * only `data`. The list is kept — empty — rather than deleted, because it is the
 * mechanism that made the cleanup possible and the next large refactor may need
 * it again. It may never grow: a page that reacquires a discarded read is a
 * regression to fix, not a number to record.
 *
 * THREE MORE SHAPES ARE NOW CAUGHT, each with its own ratchet below. They were
 * measured and disclosed here rather than guarded, which meant a green run did
 * NOT mean "no page discards a read error" — the guard's name outran what it
 * checked. All three are now enforced ceilings:
 *
 *   - ARRAY DESTRUCTURING. `const [{ data: a }, { data: b }] = await
 *     Promise.all([...])` never matches, because the regex anchors on `const {`.
 *     0 remain — safety, grants and the reports registry were all cleared
 *     2026-08-04, so this ratchet is empty too. Recounted
 *     2026-08-04 — an earlier draft of this header said 14 and named the
 *     dashboard as well, which was wrong: the dashboard destructures to NAMED
 *     results (`const [runsResult, …] = await Promise.all(…)`) and checks
 *     `homeGeographyResult.error`, which is the correct shape, not the defect.
 *     A number written into a comment is a claim like any other; this one was
 *     checked.
 *   - A CLASSIFIER USED AS THE ONLY ERROR BRANCH, INLINE. `looksLikePendingSchema(
 *     x.error?.message) ? [] : (x.data ?? [])` keeps the error and then throws it
 *     away: it classifies exactly one failure (a pending migration) and turns
 *     every other one — revoked grant, RLS change, dropped connection — into
 *     `[]`, i.e. an answer. `read-failures.ts` is "classify FIRST, then collect
 *     what is left"; these classify and never collect. There were 16, all on the
 *     project detail page, and all are now collected, so this ratchet is empty
 *     too. (An earlier count said 17 and included /rtp; that was WRONG — /rtp's
 *     ternary is a retry that preserves the original result for collection, and
 *     the detector excludes that shape.)
 *   - THE SAME THING IN TWO STEPS, which detector 3 could not see at all:
 *     `const xPending = looksLikePendingSchema(r.error?.message)` on one line and
 *     `xPending ? [] : (r.data ?? [])` fifty lines later. Detector 3 requires the
 *     `?` within ten characters of the call, so every lane written this way read
 *     as clean. Six of them sat on the project detail page — the corridor,
 *     linked-cycle, workspace-cycle, report, report-artifact and crash-ingest
 *     lanes. Five fed the spine crosslink board, which stamped each one "Not
 *     linked" directly under a banner promising that a failed read is shown as
 *     unavailable rather than as zero; the sixth fed the map presence panel.
 *     All six are collected now and this ratchet starts empty.
 *
 * WHY THESE NEEDED PARSING, NOT A BIGGER REGEX. All three shapes nest: an array
 * destructure holds arbitrary object patterns, and a classifier call takes an
 * expression that can itself contain parentheses. A regex that "mostly" matches
 * would undercount silently, which is the failure mode of a guard that makes
 * people stop looking. Every detector balances delimiters and is unit-tested
 * below on positive AND negative cases, because a detector that finds nothing
 * makes every ratchet above it pass.
 *
 * WHAT DETECTOR 4 DELIBERATELY DOES NOT DO, and why that is the safe choice. It
 * does NOT try to prove the flag reaches something that discloses it — flag flow
 * through object literals, props and RSC boundaries is not statically decidable,
 * and a guard that flags CORRECT code teaches people to override it, which is
 * how the real finding gets ignored the next time. It checks only that the
 * RESULT is collected, which is sufficient for honesty: once the failure is
 * disclosed by name, an empty rows array is no longer an unqualified answer.
 *
 * So it misses two things, stated here rather than implied:
 *   - a page that discloses the flag through a prop while never collecting the
 *     result (counted as debt, though nothing false is on screen); and
 *   - a compound condition — `pending || result.error ? [] : result.data` — where
 *     the flag is not the whole ternary test. The project detail page's
 *     recent-runs lane was exactly that, and it was found by reading, not by
 *     this guard.
 *
 * THE RATCHETS START AT THEIR TRUE COUNTS, NOT AT ZERO. Registering a lane as
 * "disclosed" without fixing the panel it feeds would make the banner itself lie
 * (`ReadFailureLog.describe()` promises "shown as unavailable rather than as
 * zero"). So the debt is recorded honestly and worked down page by page.
 *
 * WHY PAGES AND NOT ROUTES. An API route that swallows an error returns wrong
 * data or a wrong status — bad, but a different defect with a different fix. A
 * PAGE turns it into a sentence a human reads and believes. The route side got
 * the separate guard it wanted — `a-route-may-not-discard-a-read-error.test.ts`,
 * whose two ratchets are also empty as of 2026-08-04. Neither file checks the
 * other's surface, and neither should: the scopes are what keep both readable.
 *
 * TO FIX A PAGE: keep the whole result, check the error, and disclose it —
 * `ReadFailureLog` in `src/lib/ui/read-failures.ts` exists for exactly this and
 * both public pages now use it. Then lower the number here.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

/** `const { data } = await …` and `const { data: rows } = await …`. */
const DISCARDED_ERROR = /const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await/g;

/**
 * The ceiling — now EMPTY, and it may only ever shrink.
 *
 * The 13 pages that used to be listed here (county-runs, engagement campaign,
 * invoicing, models, plans, programs, projects detail and list, reports detail,
 * both RTP cycle pages, scenarios detail, and the public plan page) all keep
 * their read results and disclose their failures. The public plan page's
 * share-token lookup — the last entry, which used to 404 on a failed read — now
 * renders a shell that says the read failed and explicitly denies the inference
 * that the plan is missing, unpublished, or withdrawn.
 */
const KNOWN_DISCARDED: ReadonlyArray<readonly [string, number]> = [];

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === "page.tsx" || entry === "layout.tsx" ? [full] : [];
  });
}

function discardedCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of pageFiles(APP_DIR)) {
    const matches = readFileSync(file, "utf8").match(DISCARDED_ERROR);
    if (matches?.length) {
      counts.set(path.relative(process.cwd(), file).split(path.sep).join("/"), matches.length);
    }
  }
  return counts;
}

describe("a page may not discard a read error", () => {
  const known = new Map(KNOWN_DISCARDED.map(([file, count]) => [file, count]));

  it("adds no new page that renders a failed read as an answer", () => {
    const actual = discardedCounts();
    const added = [...actual.keys()].filter((file) => !known.has(file));

    expect(
      added,
      "these pages discard a Supabase read error — keep the result, check `error`, and disclose it with ReadFailureLog"
    ).toEqual([]);
  });

  it("lets no listed page get worse", () => {
    const actual = discardedCounts();
    const worsened = [...actual.entries()]
      .filter(([file, count]) => known.has(file) && count > (known.get(file) ?? 0))
      .map(([file, count]) => `${file}: ${known.get(file)} → ${count}`);

    expect(worsened, "these pages added another discarded read error").toEqual([]);
  });

  /**
   * The staleness half, and the reason the list can only shrink. Without it a
   * fixed page would sit here forever claiming a debt it no longer has, and the
   * next reader would trust a number that had quietly stopped being true.
   */
  it("keeps the ceiling honest — a fixed page must be removed from the list", () => {
    const actual = discardedCounts();
    const stale = KNOWN_DISCARDED.filter(([file, count]) => (actual.get(file) ?? 0) < count).map(
      ([file, count]) => `${file}: listed ${count}, actually ${actual.get(file) ?? 0} — lower or delete this entry`
    );

    expect(stale, "the ratchet moved; update the list").toEqual([]);
  });

  /**
   * The three assertions above all pass trivially if the scan finds nothing —
   * a broken pattern, a wrong directory, a rename. This is the floor.
   */
  it("guards the guard — the scan reaches real pages and the pattern still matches", () => {
    const files = pageFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.endsWith(path.join("(public)", "plan", "[shareToken]", "page.tsx")))).toBe(true);

    // The pattern must match the shape it names, in both spellings.
    expect(`const { data } = await supabase.from("x").select()`.match(DISCARDED_ERROR)).toHaveLength(1);
    expect(`const { data: rows } = await supabase.from("x").select()`.match(DISCARDED_ERROR)).toHaveLength(1);
    // And must NOT match a read that keeps its error.
    expect(`const { data, error } = await supabase.from("x").select()`.match(DISCARDED_ERROR)).toBeNull();
  });

  it("has fixed the public surfaces that shipped the defect", () => {
    const actual = discardedCounts();
    // The engagement portal page and its loader disclose read failures now; the
    // portal page must not reacquire one.
    expect(actual.get("src/app/(public)/engage/[shareToken]/page.tsx") ?? 0).toBe(0);
    expect(actual.get("src/app/(embed)/embed/[shareToken]/page.tsx") ?? 0).toBe(0);
    // The public plan page was the last entry on the ratchet. Named explicitly
    // so that emptying KNOWN_DISCARDED can never quietly un-guard it.
    expect(actual.get("src/app/(public)/plan/[shareToken]/page.tsx") ?? 0).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// SHAPE 2 — array destructuring; SHAPE 3 — a classifier used as the only error
// branch, inline; SHAPE 4 — the same thing split across two statements. All
// parse rather than pattern-match; see the header.
// ---------------------------------------------------------------------------

/** Index just past the delimiter that closes the one opened before `from`. */
function balancedEnd(source: string, from: number, open: string, close: string): number {
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
function splitTopLevel(block: string): string[] {
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

/**
 * `const [{ data: a }, { data: b }] = await Promise.all([...])`.
 *
 * Counts only bindings that take `data` WITHOUT `error` — `{ data, error }` in
 * the same position is the correct shape and must not be flagged. The dashboard
 * destructures to NAMED results and checks `.error` later, which this also
 * correctly ignores.
 */
function arrayDiscardedBindings(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/const\s*\[/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = balancedEnd(source, start, "[", "]");
    if (!/^\s*=\s*await/.test(source.slice(end, end + 30))) continue;
    for (const part of splitTopLevel(source.slice(start, end - 1))) {
      const trimmed = part.trim();
      if (!trimmed.startsWith("{")) continue;
      if (/\bdata\b/.test(trimmed) && !/\berror\b/.test(trimmed)) count += 1;
    }
  }
  return count;
}

/** Identifiers are matched by name, and `$` is legal in one but special in a regex. */
function escapeIdentifier(name: string): string {
  return name.replace(/\$/g, "\\$");
}

/**
 * Is the result named `subject` handed to anything that COLLECTS it?
 *
 * Any collector counts, not just `reads.check` literally — the projects page
 * routes several lanes through `collectUnlessPending`, and matching only the
 * inner call would mark every extracted lane as unfixed and freeze the ratchet,
 * the one thing a ratchet must never be. `laneRows`/`laneOutcome` collect too
 * but do not match this name, and do not need to: a lane routed through them
 * keeps no `looksLikePendingSchema` call of its own for either detector to find.
 */
function isCollectedSomewhere(source: string, subject: string): boolean {
  return new RegExp(`\\b\\w*(?:check|collect)\\w*\\s*\\([^)]*\\b${escapeIdentifier(subject)}\\b`, "i").test(source);
}

/**
 * `looksLikePendingSchema(x.error?.message) ? [] : (x.data ?? [])`.
 *
 * This KEEPS the error and then throws it away. It classifies exactly one
 * failure — a migration this deployment has not run — and turns every other one,
 * a revoked grant or an RLS change or a dropped connection, into `[]`: an answer.
 * `read-failures.ts` is "classify FIRST, then collect what is left"; this
 * classifies and never collects. The models page does it correctly with
 * `if (!schemaPending) reads.check(...)`.
 */
function classifierOnlyBranches(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/looksLikePendingSchema\s*\(/g)) {
    const end = balancedEnd(source, (match.index ?? 0) + match[0].length, "(", ")");
    const question = /^\s*\?/.exec(source.slice(end, end + 10));
    if (!question) continue;
    // Only a ternary whose FALSE branch yields rows is the defect. A ternary
    // whose false branch is the original RESULT is a retry — /rtp re-reads with
    // a narrower projection when the schema is pending and otherwise keeps the
    // untouched result, error and all, for `classifyRead` to collect. Flagging
    // that would have sent someone to "fix" correct code, which is how a guard
    // loses its authority.
    if (!/\.data\b/.test(ternaryFalseBranch(source, end + question[0].length - 1))) continue;
    // ...UNLESS the same result is also collected. `classify FIRST, then collect
    // what is left` leaves the ternary in place on purpose: once the failure is
    // disclosed, resolving the rows to `[]` is correct, because the page is no
    // longer presenting that emptiness as an answer. Counting a fixed lane would
    // make this ratchet unable to fall, which is the one thing a ratchet must do.
    const subject = /([A-Za-z_$][\w$]*)\s*\.\s*error/.exec(source.slice((match.index ?? 0) + match[0].length, end));
    if (subject && isCollectedSomewhere(source, subject[1])) continue;
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
 * Invisible to detector 3, which requires the `?` within ten characters of the
 * call — and this is the form the project detail page's crosslink feeders used,
 * so six lanes read as clean while the board they fed rendered "Not linked" over
 * reads that had failed.
 *
 * A declaration counts only when all three hold: the classifier's argument names
 * a result (`SUBJ.error`); the declared flag is used somewhere as a ternary
 * condition whose FALSE branch yields `.data`; and that result is never handed
 * to a collector. The retry shape is excluded for free, because its false branch
 * yields the original RESULT rather than its `.data`. See the header for the two
 * things this deliberately does not attempt.
 */
function twoStepClassifierOnly(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*looksLikePendingSchema\s*\(/g)) {
    const flag = escapeIdentifier(match[1]);
    const argStart = (match.index ?? 0) + match[0].length;
    const argEnd = balancedEnd(source, argStart, "(", ")");
    const subject = /([A-Za-z_$][\w$]*)\s*\.\s*error/.exec(source.slice(argStart, argEnd));
    if (!subject) continue;

    let discardsRows = false;
    for (const use of source.matchAll(new RegExp(`\\b${flag}\\b\\s*\\?`, "g"))) {
      const question = (use.index ?? 0) + use[0].length - 1;
      if (/\.data\b/.test(ternaryFalseBranch(source, question))) {
        discardsRows = true;
        break;
      }
    }
    if (!discardsRows) continue;
    if (isCollectedSomewhere(source, subject[1])) continue;
    count += 1;
  }
  return count;
}

/** The false branch of the ternary whose `?` sits at `question`. */
function ternaryFalseBranch(source: string, question: number): string {
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

function countsBy(detect: (source: string) => number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of pageFiles(APP_DIR)) {
    const found = detect(readFileSync(file, "utf8"));
    if (found > 0) counts.set(path.relative(process.cwd(), file).split(path.sep).join("/"), found);
  }
  return counts;
}

/** Measured 2026-08-04. May only shrink. */
const KNOWN_ARRAY_DISCARDED: ReadonlyArray<readonly [string, number]> = [
];

/** Measured 2026-08-04. May only shrink. */
const KNOWN_CLASSIFIER_ONLY: ReadonlyArray<readonly [string, number]> = [];

/**
 * Measured 2026-08-04, AFTER the six project-detail feeders were collected. May
 * only shrink. It starts empty because the debt it was written for was paid in
 * the same change — which is the honest number, not an aspiration: the detector
 * proves itself against the synthetic cases below and against the tree scan.
 */
const KNOWN_TWO_STEP_CLASSIFIER: ReadonlyArray<readonly [string, number]> = [];

function ratchet(
  name: string,
  known: ReadonlyArray<readonly [string, number]>,
  detect: (source: string) => number,
  fixHint: string
) {
  const listed = new Map(known.map(([file, count]) => [file, count]));

  describe(name, () => {
    it("adds no new page", () => {
      const actual = countsBy(detect);
      expect([...actual.keys()].filter((file) => !listed.has(file)), fixHint).toEqual([]);
    });

    it("lets no listed page get worse", () => {
      const actual = countsBy(detect);
      const worsened = [...actual.entries()]
        .filter(([file, count]) => listed.has(file) && count > (listed.get(file) ?? 0))
        .map(([file, count]) => `${file}: ${listed.get(file)} → ${count}`);
      expect(worsened, "these pages added another discarded read error").toEqual([]);
    });

    it("keeps the ceiling honest — a fixed page must be removed from the list", () => {
      const actual = countsBy(detect);
      const stale = known
        .filter(([file, count]) => (actual.get(file) ?? 0) < count)
        .map(([file, count]) => `${file}: listed ${count}, actually ${actual.get(file) ?? 0} — lower or delete this entry`);
      expect(stale, "the ratchet moved; update the list").toEqual([]);
    });
  });
}

ratchet(
  "a page may not discard a read error — array destructuring",
  KNOWN_ARRAY_DISCARDED,
  arrayDiscardedBindings,
  "these pages destructure `{ data }` out of an awaited array without keeping `error` — take the whole result and check it"
);

ratchet(
  "a page may not classify one failure and swallow the rest",
  KNOWN_CLASSIFIER_ONLY,
  classifierOnlyBranches,
  "these pages use looksLikePendingSchema as the ONLY error branch — classify first, then collect what is left with ReadFailureLog"
);

ratchet(
  "a page may not split a classifier and its swallow across two statements",
  KNOWN_TWO_STEP_CLASSIFIER,
  twoStepClassifierOnly,
  "these pages declare a pending-schema flag and later use it as the ONLY error branch — collect the result too (laneOutcome/collectUnlessPending), so the emptiness is not offered as an answer"
);

describe("the three added detectors are not vacuous", () => {
  it("counts an array binding that drops its error, and spares one that keeps it", () => {
    expect(arrayDiscardedBindings(`const [{ data: a }, { data: b }] = await Promise.all([x, y]);`)).toBe(2);
    // The correct shape must NOT be flagged.
    expect(arrayDiscardedBindings(`const [{ data, error }] = await Promise.all([x]);`)).toBe(0);
    // Named results that keep the whole object — what the dashboard does.
    expect(arrayDiscardedBindings(`const [runsResult, geoResult] = await Promise.all([x, y]);`)).toBe(0);
    // Not awaited — not a read.
    expect(arrayDiscardedBindings(`const [{ data: a }] = someSyncThing;`)).toBe(0);
  });

  it("counts a classifier used as the only error branch, and spares a real collect", () => {
    expect(classifierOnlyBranches(`looksLikePendingSchema(r.error?.message) ? [] : (r.data ?? [])`)).toBe(1);
    // Nested parentheses in the argument must not break the scan.
    expect(classifierOnlyBranches(`looksLikePendingSchema(String(r.error?.message)) ? [] : r.data`)).toBe(1);
    // Used as a plain guard before collecting — the CORRECT shape.
    expect(classifierOnlyBranches(`const pending = looksLikePendingSchema(r.error?.message);\nif (!pending) reads.check("x", r);`)).toBe(0);
  });

  it("counts a two-step classifier, and spares a retry, a collect, and a flag nobody branches on", () => {
    // The shape detector 3 cannot see: the `?` is fifty lines from the call.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nconst rows = xPending ? [] : (r.data ?? []);`
      )
    ).toBe(1);

    // THE RETRY SHAPE. The false branch yields the original RESULT, error and
    // all, for a collector further down — flagging it would send someone to
    // "fix" correct code, which is how a guard loses its authority.
    expect(
      twoStepClassifierOnly(
        `const packetPending = looksLikePendingSchema(result.error?.message);\nconst finalResult = packetPending ? await narrowerRead() : result;`
      )
    ).toBe(0);

    // Collected as well as classified — the fixed shape, which must be able to
    // leave the ratchet or the ratchet cannot fall.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nconst failed = collectUnlessPending(reads, "x", r);\nconst rows = xPending ? [] : (r.data ?? []);`
      )
    ).toBe(0);

    // A flag that only tints a panel is not this defect; nothing is answered.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(r.error?.message);\nreturn <Panel pending={xPending} />;`
      )
    ).toBe(0);

    // Nested parentheses in the argument must not break the scan.
    expect(
      twoStepClassifierOnly(
        `const xPending = looksLikePendingSchema(String(r.error?.message));\nconst rows = xPending ? [] : r.data;`
      )
    ).toBe(1);
  });

  /**
   * WHY THIS ASSERTION CHANGED, 2026-08-04. It used to require each detector to
   * find at least one instance in the tree — a reasonable floor while both had
   * debt, and a trap the moment one was paid off. The array ratchet reached zero
   * and this test failed, reporting a cleanup as a broken detector.
   *
   * A detector at zero cannot prove itself against the tree; that is what the
   * synthetic positive cases above are for. What the TREE can still prove is
   * that the scan reaches real files and that each detector runs over every one
   * of them without throwing — so a rename, a moved directory, or a parser that
   * blows up on real syntax still fails here rather than passing as "clean".
   */
  it("guards the guard — the scan reaches real pages and every detector runs over all of them", () => {
    const files = pageFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(40);

    let scanned = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(typeof arrayDiscardedBindings(source)).toBe("number");
      expect(typeof classifierOnlyBranches(source)).toBe("number");
      expect(typeof twoStepClassifierOnly(source)).toBe("number");
      scanned += 1;
    }
    expect(scanned).toBe(files.length);

    // NO TREE COUNT IS ASSERTED HERE, and that is deliberate — twice now a
    // hardcoded expectation of remaining debt has failed BECAUSE the debt was
    // paid off, reporting a cleanup as a broken detector. A detector at zero
    // proves itself through the synthetic cases above, not through the tree.
  });
});
