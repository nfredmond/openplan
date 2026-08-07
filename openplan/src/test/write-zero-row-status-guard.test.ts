import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  collectSupabaseWriteSites,
  parseWriteSitesFromSource,
  type SupabaseWriteSite,
} from "./supabase-call-sites";

/**
 * REGRESSION GUARD — an UPDATE or DELETE that matches no rows may not be
 * reported as a server error.
 *
 * THE DEFECT. PostgREST has two ways of saying "your write changed nothing",
 * and which one a route receives depends only on how the query was spelled:
 * `.single()` puts it in `error` as `PGRST116`, `.maybeSingle()` puts it in
 * `data` as `null`. Neither is a failure. But the branch every one of these
 * routes was written with — `if (error) return 500`, or the stricter
 * `if (error || !data) return 500` — collapses one or both into "something
 * broke on the server".
 *
 * What that cost, concretely: `project_rtp_cycle_links` carried a RESTRICTIVE
 * writer gate and no PERMISSIVE UPDATE partner, so every update matched zero
 * rows. The route answered 500 "Failed to update RTP link" — an authorization
 * outcome wearing a server error's clothes, with an audit code pointing at
 * result cardinality instead of at the missing policy. It was found by querying
 * a running database, not by the suite.
 *
 * THIS GUARD IS THE OTHER HALF OF `write-policy-coverage-guard.test.ts`, which
 * asks whether a write can SEE how many rows it changed. That one recorded the
 * status question as deliberately not asserted, on the grounds that `PGRST116`
 * appeared zero times in non-test `src` and fixing it was "a separate change
 * with its own blast radius". This is that change, and this guard is what stops
 * it regressing: the first question is whether the write can see the answer, and
 * the second is what it then says.
 *
 * HOW IT CHECKS. Not by pattern-matching the shape of an `if`. "Did this route
 * think about matching no rows" has no syntactic signature, and every inferred
 * one either accepts `if (error) return 500` or rejects a correct route spelled
 * slightly differently. Instead the guard requires the enclosing function to
 * reference one of the named helpers in `src/lib/http/write-outcome.ts` — which
 * is the observable, unambiguous act of having considered it. `handlesZeroRows`
 * on the AST inventory answers that, per function rather than per file, so a
 * route whose POST is correct does not vouch for its PATCH.
 *
 * DELIBERATELY NOT ASSERTED, and why each is a separate change:
 *
 *   - INSERT. An insert can also answer PGRST116, and it means something
 *     different: the row was WRITTEN and the `.select()` after it could not read
 *     it back, because the table grants INSERT and no matching SELECT. Reporting
 *     failure there is worse than reporting nothing — the client retries, and
 *     the retry inserts a second row. `insertNotReadableBackResponse` exists for
 *     it, but retrofitting ~68 insert sites changes success-path contracts, not
 *     just an error branch.
 *   - SERVICE-ROLE writes. Two of them update by id with RLS bypassed, so zero
 *     rows there means the row truly is absent and the answer is a plain 404.
 *     Correct, and a different argument from this one, which is about a write
 *     the CALLER was allowed to attempt.
 *   - The STATUS a given site returns. The guard checks that the case is
 *     handled, not which of 404 or 500 it chose: that choice turns on whether
 *     the route already read the target row through the caller's own client,
 *     which is a fact about request flow that no AST can settle. It is argued
 *     per site, in a comment, at the site.
 */

const writeSites = collectSupabaseWriteSites();

/**
 * The population this guard rules over: a write the CALLER attempted, through
 * their own RLS client, that can match zero rows.
 *
 * `insert` and `upsert` are excluded per the header. `clientKind` other than
 * service-role is included — "unresolved" means the AST could not prove which
 * key is behind a client taken as a parameter, and treating that as exempt
 * would let any write escape by being passed its client.
 */
function callerRowWrites(): SupabaseWriteSite[] {
  return writeSites.filter(
    (site) =>
      site.clientKind !== "service-role" &&
      (site.command === "UPDATE" || site.command === "DELETE") &&
      (site.chain.includes("single") || site.chain.includes("maybeSingle")),
  );
}

function describeSite(site: SupabaseWriteSite): string {
  return `${site.file}:${site.line} ${site.verb} ${site.table ?? site.tableExpression}`;
}

  // 30s, not vitest's 5s default. These guards call `collectSupabaseWriteSites`,
  // which parses the WHOLE `src/` tree with the TypeScript compiler — several
  // seconds on its own, and more under full-suite parallelism. Left at the
  // default they fail INTERMITTENTLY, and the failure reads "timed out" rather
  // than "a write escaped the guard", which sends the next person to the wrong
  // question entirely. `the-timetable-is-not-persisted.test.ts` hit this first
  // and was fixed alone; these two share the cause and were missed, which is
  // why the note is now on all three.
describe("a write that matched no rows is answered as its own outcome", () => {
  it("finds the population it is guarding, so an empty filter cannot pass it", { timeout: 30_000 }, () => {
    // The failure mode this defends against is the guard silently ruling over
    // nothing — a renamed field or a changed `clientKind` value turning the
    // filter above into a no-op that reports success forever.
    expect(callerRowWrites().length).toBeGreaterThanOrEqual(30);
  });

  it("has every caller UPDATE and DELETE deal with zero rows deliberately", { timeout: 30_000 }, () => {
    const unhandled = callerRowWrites()
      .filter((site) => !site.handlesZeroRows)
      .map(describeSite);

    expect(
      unhandled,
      "These writes fold 'matched no rows' into their failure branch, so a missing " +
        "policy or an absent row answers 500. Use src/lib/http/write-outcome.ts: " +
        "`isWriteFailure` for the real-error branch, `writeMatchedNoRows` for this one, " +
        "and `noRowsMatchedResponse` to answer it — choosing `targetWasVerified` by " +
        "whether this route already read that exact row through the caller's client.",
    ).toEqual([]);
  });

  it("keeps the PostgREST code itself in one place", { timeout: 30_000 }, () => {
    // A route that re-spells "PGRST116" inline has reimplemented the decision
    // rather than adopted it, and the next reader has two sources of truth.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is a correctness fix, not a
    // loophole. This guard used to scan raw text, so it fired on the project
    // detail page for a comment EXPLAINING why the shared constant is used —
    // the page imports `POSTGREST_NO_ROWS_MATCHED` and spells the code
    // nowhere. A guard that punishes documenting the rule it enforces teaches
    // people to delete the reasoning, which is the opposite of what it is for.
    // (Same defect as `every-api-route-has-a-caller` excusing a route because
    // its path appeared in an operator-facing sentence: match code, not prose.)
    // Nothing executable can hide in a comment, so this cannot weaken it.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    const offenders: string[] = [];
    const root = path.resolve(__dirname, "..");
    const allowed = path.join(root, "lib", "http", "write-outcome.ts");

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "test" || entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full === allowed) continue;
        if (stripComments(fs.readFileSync(full, "utf8")).includes("PGRST116")) {
          offenders.push(path.relative(root, full));
        }
      }
    };

    walk(root);

    // Guard the guard: comment-stripping must not have eaten the code it scans.
    // If this ever passes because `stripComments` returned nothing useful, the
    // assertion below would be vacuous for every file in the tree.
    expect(stripComments('const x = "PGRST116"; // PGRST116 in a comment')).toContain("PGRST116");
    expect(stripComments("// only PGRST116 in a comment")).not.toContain("PGRST116");
    expect(stripComments("/* block PGRST116 */ const ok = 1;")).not.toContain("PGRST116");

    expect(
      offenders,
      "PGRST116 belongs in src/lib/http/write-outcome.ts. Import `isNoRowsMatchedError` " +
        "or `writeMatchedNoRows` instead of matching the code again here.",
    ).toEqual([]);
  });
});

describe("the guard's own reading of a write", () => {
  const HANDLED = `
    import { isWriteFailure, writeMatchedNoRows, noRowsMatchedResponse } from "@/lib/http/write-outcome";
    export async function PATCH() {
      const supabase = await createClient();
      const { data, error } = await supabase.from("projects").update({ name: "x" }).eq("id", id).select("id").single();
      if (isWriteFailure(error)) return NextResponse.json({ error: "boom" }, { status: 500 });
      if (writeMatchedNoRows({ data, error })) return noRowsMatchedResponse({ subject: "project", targetWasVerified: false });
      return NextResponse.json({ project: data });
    }
  `;

  const UNHANDLED = `
    export async function PATCH() {
      const supabase = await createClient();
      const { data, error } = await supabase.from("projects").update({ name: "x" }).eq("id", id).select("id").single();
      if (error || !data) return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
      return NextResponse.json({ project: data });
    }
  `;

  it("reads a handled write as handled", { timeout: 30_000 }, () => {
    const [site] = parseWriteSitesFromSource(HANDLED);
    expect(site.command).toBe("UPDATE");
    expect(site.handlesZeroRows).toBe(true);
  });

  it("reads the original 500-for-everything branch as unhandled", { timeout: 30_000 }, () => {
    const [site] = parseWriteSitesFromSource(UNHANDLED);
    expect(site.handlesZeroRows).toBe(false);
  });

  it("does not let one handler in a file vouch for another", { timeout: 30_000 }, () => {
    // The reason `handlesZeroRows` is scoped to the enclosing function: route
    // files hold several exported handlers, and they are fixed one at a time.
    const sites = parseWriteSitesFromSource(`${HANDLED}\n${UNHANDLED.replace("PATCH", "PUT")}`);
    expect(sites.map((site) => site.handlesZeroRows)).toEqual([true, false]);
  });
});
