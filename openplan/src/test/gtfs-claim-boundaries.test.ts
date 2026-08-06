/**
 * Claim-boundary guard for the transit lane, wherever its copy lives.
 *
 * WHY THIS FILE EXISTS. OpenPlan derives SERVICE LEVELS from a published GTFS
 * feed and never keeps the timetable. `the-timetable-is-not-persisted.test.ts`
 * holds the STORAGE half of that commitment — no row may be written to the
 * eight raw-feed tables. This file holds the LANGUAGE half, which is the half a
 * planner and a member of the public actually meet: a product can store nothing
 * but hourly counts and still print "next bus at 4:15" beside them, and the
 * rider standing on the corner cannot tell the difference.
 *
 * The distinction is not pedantry. A service level — "buses come to this corner
 * every 12 minutes on a weekday" — is a PLANNING FACT about a schedule that was
 * published, and it stays true of that schedule. A departure time is a PROMISE
 * TO A RIDER, and OpenPlan reads no real-time feed at all (the catalog's
 * `gtfs-rt` rows are excluded before a planner ever sees them), so every such
 * promise would be made from a static file that may be months stale. Three of
 * four Sacramento-area feeds measured on 2026-08-05 had already expired; SacRT's
 * sixteen months earlier.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS SCANNED, AND WHY IT IS NOT THE WHOLE FILE.
 *
 * This guard reads ONLY what can reach a person: string literals, template
 * literal text, and JSX text. Comments are not scanned at all — not stripped and
 * then filtered, not filtered by negation, simply never collected.
 *
 * That is a deliberate reversal of the shape `safety-claim-boundaries.test.ts`
 * uses, and the reason is specific to this lane. Every module in `src/lib/gtfs/`
 * carries a header that explains the rule by QUOTING WHAT IT FORBIDS —
 * "it cannot say what time the 4:15 leaves", "a product that appears to answer
 * 'what time is the 4:15'", "OpenPlan does not read real-time feeds". A
 * comment-scanning guard filtered by a negation heuristic would be a coin flip
 * over exactly the prose that documents the commitment, and the failure mode is
 * not a false alarm — it is a maintainer deleting the reasoning to make a test
 * pass. This repository already has that scar in
 * `write-zero-row-status-guard.test.ts`. A guard that punishes documenting its
 * own rule teaches people to stop documenting.
 *
 * THE COST, STATED PLAINLY: a violation written only in a comment is invisible
 * here. That is the right trade, because a comment reaches no planner. What it
 * does NOT excuse is a forbidden phrase built by string concatenation across an
 * interpolation — `"departs at " + time` is caught, `` `departs ${verb} 4:15` ``
 * is not, because the two runs are collected separately. Nothing in the lane
 * does that today and it is worth knowing that it would slip through.
 *
 * NEGATION FILTERING IS STILL NEEDED, and it is load-bearing on exactly two
 * sentences. `GTFS_NOT_A_TIMETABLE_CAVEAT` and the ingest panel's own
 * description both end "…so it can never tell a rider when the next vehicle
 * leaves", which is the product commitment written out for the reader — and
 * which trips the departure-answer pattern verbatim. Removing the negation
 * filter turns both of them into violations; that is asserted below rather than
 * asserted about.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THE POSITIVE HALF is the one that protects a planner rather than the product's
 * reputation. A headway with no caveats and no service-window date is a number
 * that gets lifted into a regional transportation plan, and by then nobody
 * remembers it was an hourly average taken off a schedule that stopped running.
 * So every surface carrying derived service levels must carry
 * `selectGtfsCaveats`' output with them, and every projection that reads a feed
 * version for display must ask for `service_end_date`.
 *
 * THE THIRD HALF (`filterToCurrentReadyVersion`) lives here too, and the reason
 * is that it is the same sentence. A headway shown with every caveat and the
 * right end date is still a false claim if it was read off a version the
 * workspace does not analyse with — a promoted-then-failed ingest, or three
 * successful ingests summed. `persist.ts` says a guard "can then assert that
 * every reader goes through this function"; this is that assertion.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as gtfsCaveats from "@/lib/gtfs/caveats";
import * as gtfsProjections from "@/lib/gtfs/route-projections";
import { GTFS_CURRENT_VERSION_FILTER } from "@/lib/gtfs/persist";
import { blankComments, matchingParen, migrationFiles, readMigration, splitTopLevel } from "./migrations/read-migrations";
import { collectSupabaseSelectSites } from "./supabase-call-sites";

const REPO_ROOT = process.cwd();

/* -------------------------------------------------------------------------- */
/* Which files are the transit lane                                             */
/* -------------------------------------------------------------------------- */

/**
 * Roots that ARE the transit lane end to end. Every file under these is scanned.
 */
const TRANSIT_ROOTS = [
  "src/lib/gtfs",
  "src/app/api/gtfs",
  "src/app/api/cron/reap-gtfs-ingests",
  "src/lib/transit",
];

/**
 * Roots that HOLD the transit lane among other things.
 *
 * `src/components/data-hub/` and the Data Hub page carry connectors, datasets
 * and refresh jobs beside the feed panel, and a data connector may legitimately
 * describe itself as real-time. Scanning those files for transit vocabulary
 * would fail a feature that has nothing to do with this commitment, and a guard
 * that cries wolf gets deleted rather than heeded.
 *
 * So membership is decided by REACH rather than by a typed list of filenames: a
 * file in one of these roots is scanned when it imports the transit lane. The
 * non-vacuity test below asserts the ingest panel and the Data Hub page are both
 * found this way, because a broken import regex would silently empty this set.
 */
const MIXED_ROOTS = ["src/components/data-hub", "src/app/(app)/data-hub"];

const TRANSIT_LANE_IMPORT = /from\s+["']@\/lib\/(?:gtfs|transit)\b/;

function collectSourceFiles(relativeRoot: string): string[] {
  const absolute = path.join(REPO_ROOT, relativeRoot);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const relative = path.join(relativeRoot, entry);
    if (statSync(path.join(REPO_ROOT, relative)).isDirectory()) return collectSourceFiles(relative);
    return /\.tsx?$/.test(entry) ? [relative] : [];
  });
}

function readSource(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const TRANSIT_FILES: string[] = [
  ...TRANSIT_ROOTS.flatMap(collectSourceFiles),
  ...MIXED_ROOTS.flatMap(collectSourceFiles).filter((file) => TRANSIT_LANE_IMPORT.test(readSource(file))),
];

/* -------------------------------------------------------------------------- */
/* What can reach a person                                                      */
/* -------------------------------------------------------------------------- */

function parseSource(relative: string): ts.SourceFile {
  return ts.createSourceFile(
    relative,
    readSource(relative),
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Every run of text in a file that a browser or an API consumer can receive.
 *
 * Each literal is kept as its own run rather than joined, because joining would
 * manufacture sentences that never existed — `"…leaves. " + "Use the agency's"`
 * is two adjacent arguments to `+`, and a phrase spanning the join is not a
 * phrase anyone reads.
 */
function renderableRuns(relative: string): string[] {
  const source = parseSource(relative);
  const runs: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      runs.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      runs.push(node.text);
    } else if (ts.isJsxText(node)) {
      const collapsed = node.text.replace(/\s+/g, " ").trim();
      if (collapsed) runs.push(collapsed);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return runs.filter((run) => run.trim().length > 0);
}

/**
 * Sentences that do not DENY what they name.
 *
 * Same shape and same reason as `safety-claim-boundaries.test.ts`: the caveats
 * necessarily state the things they rule out, and a guard that fails on its own
 * disclosure is a guard that gets weakened.
 */
const NEGATION =
  /\b(?:not|never|no|none|nothing|cannot|can't|won't|does not|do not|is not|are not|without|excludes?|excluded|refuses?|unreachable|rather than|instead of|may not|must not)\b/i;

function assertableSentences(run: string): string[] {
  return run
    .split(/(?<=[.;:])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !NEGATION.test(sentence));
}

/* -------------------------------------------------------------------------- */
/* The negative half — what the transit lane may not say about its own data      */
/* -------------------------------------------------------------------------- */

const PROHIBITED_TRANSIT_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  /**
   * A DEPARTURE TIME PRESENTED AS AN ANSWER.
   *
   * Deriving a time internally is fine and the parser does it constantly —
   * `first_departure_seconds` is a stored column. PRESENTING one is the line,
   * because the presented form is what a rider acts on.
   *
   * The clock-time patterns require departure-answer CONTEXT rather than firing
   * on any `\d{1,2}:\d\d`, because GTFS's own notation is all over this lane's
   * honest copy — `GTFS_PAST_MIDNIGHT_CAVEAT` says feeds "write them as
   * 24:00:00 and later", which is a statement about a file format and carries no
   * negation to hide behind.
   */
  {
    label: "a departure time presented as an answer",
    pattern: /\b(?:departs?|departing|leaves?|leaving|arrives?|arriving|scheduled)\s+(?:at|for)\s+\d{1,2}:[0-5]\d/i,
  },
  { label: "a departure time presented as an answer", pattern: /\bthe\s+\d{1,2}:[0-5]\d\b/ },
  { label: "a departure time presented as an answer", pattern: /\b\d{1,2}:[0-5]\d\s*(?:am|pm|a\.m\.|p\.m\.)/i },
  {
    label: "a departure time presented as an answer",
    pattern: /\bnext\s+(?:bus|train|vehicle|departure|arrival)\b/i,
  },
  { label: "a departure time presented as an answer", pattern: /\bdeparture board\b/i },

  /**
   * REAL-TIME SERVICE OPENPLAN DOES NOT READ.
   *
   * There is no hedged version of this one. The catalog deliberately excludes
   * `gtfs-rt` entries, so there is no code path by which a real-time claim could
   * be true — which makes any such phrasing a straightforward falsehood rather
   * than an overstatement.
   */
  { label: "real-time service OpenPlan does not read", pattern: /\breal[\s-]?time\b/i },
  {
    label: "real-time service OpenPlan does not read",
    pattern: /\blive\s+(?:arrivals?|departures?|times?|schedule|tracking|vehicles?|buses|transit)/i,
  },
  { label: "real-time service OpenPlan does not read", pattern: /\barriving\s+(?:now|in)\b/i },

  /**
   * COMPLETE TRANSIT COVERAGE A WORKSPACE'S FEEDS CANNOT HAVE.
   *
   * A workspace has the feeds it ingested. In most regions that is one operator
   * out of several, and the ones it is missing — a county paratransit provider,
   * a tribal shuttle, an intercity carrier — are disproportionately the ones a
   * Title VI or rural-access finding turns on.
   */
  {
    label: "complete transit coverage a workspace's feeds cannot have",
    pattern:
      /\b(?:all|every|complete|comprehensive|entire|full)\b[^.\n]{0,25}\btransit\s+(?:service|network|routes?|stops?|system)\b/i,
  },
  {
    label: "complete transit coverage a workspace's feeds cannot have",
    pattern: /\b(?:all|every|complete|comprehensive|entire)\b[^.\n]{0,25}\b(?:transit\s+)?(?:routes?|stops?)\s+(?:in|serving|across)\b/i,
  },

  /**
   * A TIMETABLE PRESENTED AS SOMETHING OPENPLAN PROVIDES.
   *
   * "Reads a published schedule" is what the product does and must stay sayable;
   * the ingest panel's own heading says it. "Shows the schedule" is the claim
   * this refuses, and the difference is the verb.
   */
  {
    label: "a timetable presented as something OpenPlan provides",
    pattern:
      /\b(?:provides?|providing|offers?|offering|shows?|showing|displays?|displaying|includes?|including|publishes?|gives?|view|see)\s+(?:the\s+|a\s+|your\s+|an\s+|this\s+)?(?:timetable|schedule)s?\b/i,
  },
];

/* -------------------------------------------------------------------------- */
/* The positive half — what must travel WITH a service level                    */
/* -------------------------------------------------------------------------- */

/**
 * Column names on the two derived tables that denote a SERVICE-LEVEL FIGURE.
 *
 * DERIVED FROM THE MIGRATIONS, by reading the two `CREATE TABLE` bodies and
 * every `ALTER TABLE … ADD COLUMN` against them, then keeping the columns whose
 * names denote a frequency claim. `route_id`, `latitude` and `created_at` are
 * deliberately not in the set: they are how a row is identified and placed, not
 * what it claims about service, and treating them as markers would make every
 * mapping surface in the product a transit-claim surface.
 *
 * The non-vacuity test below pins the count and three of the names, so a schema
 * rename that empties this set fails loudly rather than silently exempting every
 * surface from the caveat requirement.
 */
const SERVICE_LEVEL_FIGURE = /headway|trips_per_day|departure_seconds|served_hours|span_hours|peak_window/;

function derivedTableColumns(table: string): string[] {
  const columns = new Set<string>();

  for (const file of migrationFiles()) {
    const sql = blankComments(readMigration(file));

    const createIndex = sql.search(new RegExp(`CREATE\\s+TABLE[^;]*?\\b${table}\\s*\\(`, "i"));
    if (createIndex >= 0) {
      const open = sql.indexOf("(", createIndex);
      const body = sql.slice(open + 1, matchingParen(sql, open));
      for (const item of splitTopLevel(body, ",")) {
        const name = /^\s*([a-z_][a-z0-9_]*)/i.exec(item)?.[1]?.toLowerCase();
        if (!name) continue;
        if (["constraint", "unique", "primary", "check", "foreign", "exclude"].includes(name)) continue;
        columns.add(name);
      }
    }

    const alter = new RegExp(`ALTER\\s+TABLE[^;]*?\\b${table}\\b([^;]*);`, "gi");
    for (const match of sql.matchAll(alter)) {
      for (const added of match[1].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        columns.add(added[1].toLowerCase());
      }
    }
  }

  return [...columns];
}

const SERVICE_LEVEL_COLUMNS = [
  ...new Set([
    ...derivedTableColumns("gtfs_route_service_levels"),
    ...derivedTableColumns("gtfs_stop_service_levels"),
  ]),
].filter((column) => SERVICE_LEVEL_FIGURE.test(column));

/**
 * Everything that makes a surface a SERVICE-LEVEL surface.
 *
 * The two derived table names and the two version-row counts are included
 * alongside the figure columns. A surface saying "18,141 stop service-level
 * rows derived from this feed" is presenting derived service data even though it
 * prints no headway, and it is the surface a planner reaches first.
 */
const SERVICE_LEVEL_MARKERS = [
  ...SERVICE_LEVEL_COLUMNS,
  "gtfs_route_service_levels",
  "gtfs_stop_service_levels",
  "route_service_level_rows",
  "stop_service_level_rows",
];

/**
 * Text plus the VALUES of any projection constant it names.
 *
 * `feeds/route.ts` never writes `route_service_level_rows`; it writes
 * `GTFS_FEED_VERSION_COLUMNS`, which contains it. Expanding the constant is what
 * lets this guard see through the indirection that `route-projections.ts` exists
 * to create — without it, hoisting a projection into a constant would exempt a
 * surface from every rule below.
 */
function expandProjections(text: string): string {
  let expanded = text;
  for (const [name, value] of Object.entries(gtfsProjections)) {
    if (typeof value === "string" && new RegExp(`\\b${name}\\b`).test(text)) expanded += `\n${value}`;
  }
  return expanded;
}

function carriesServiceLevels(text: string): boolean {
  const expanded = expandProjections(text);
  return SERVICE_LEVEL_MARKERS.some((marker) => expanded.includes(marker)) || /\brunGtfsIngest\b/.test(expanded);
}

/**
 * One exported HTTP handler in a route file.
 *
 * PER HANDLER AND NOT PER FILE, and the difference is the whole strength of the
 * assertion below. `feeds/route.ts` holds a GET that lists feeds and a POST that
 * ingests one, and both answer with caveats today. A per-file rule would be
 * satisfied by either of them alone — so deleting the GET's `caveatsByFeedId`
 * would leave the guard green while a planner's feed list lost every
 * qualification attached to it. A handler is the unit a response belongs to, so
 * a handler is the unit this is checked at.
 */
type RouteHandler = { file: string; method: string; text: string; responseProperties: string[] };

const PRESENTED_METHODS = ["GET", "POST", "PUT", "PATCH"];

function routeHandlers(relative: string): RouteHandler[] {
  const source = parseSource(relative);
  const handlers: RouteHandler[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const method = node.name.text;
      const responseProperties: string[] = [];

      const scan = (inner: ts.Node) => {
        if (
          ts.isCallExpression(inner) &&
          ts.isPropertyAccessExpression(inner.expression) &&
          inner.expression.name.text === "json"
        ) {
          const argument = inner.arguments[0];
          if (argument && ts.isObjectLiteralExpression(argument)) {
            for (const property of argument.properties) {
              if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
                responseProperties.push(property.name.text);
              }
            }
          }
        }
        ts.forEachChild(inner, scan);
      };
      scan(node);

      handlers.push({ file: relative, method, text: node.getText(source), responseProperties });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return handlers;
}

/**
 * Does this component render the caveats, itself or through a TRANSIT component
 * it mounts?
 *
 * The one hop is not laxity, it is the truth of the screen: `data-hub/page.tsx`
 * projects `route_service_level_rows` and renders `<GtfsIngestPanel />`, which
 * is where the caveats are listed. Requiring the page to name them itself would
 * demand a second copy of a disclosure that is already on the page — and a
 * caveat that exists twice drifts into two different promises.
 *
 * TWO THINGS ARE NARROW ON PURPOSE, AND BOTH WERE ADDED AFTER A MUTATION PROVED
 * THE FIRST VERSION LAUNDERED. Renaming `<GtfsIngestPanel>` out of the page left
 * this guard green, and the reasons were instructive:
 *
 *   1. The imported-name split produced an empty string for default and
 *      namespace imports, and `<\b` matches every JSX element in the file — so
 *      EVERY first-party import counted as "mounted". Names are validated as
 *      identifiers now.
 *   2. The hop landed on `data-hub-record-composer.tsx`, an unrelated Data Hub
 *      component whose placeholder text says "any operating caveats" about a
 *      data connector. So the hop now only follows components that are
 *      THEMSELVES in the transit lane. A disclosure about a connector's QA notes
 *      is not a disclosure about a headway.
 */
function rendersCaveats(relative: string): boolean {
  const source = readSource(relative);
  if (CAVEAT_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(source))) return true;

  // No `s` flag: `[^}]` already spans newlines, and the tsconfig target here
  // rejects `dotAll` (TS1501). A multi-line import list is matched regardless.
  for (const match of source.matchAll(/import\s+\{([^}]*)\}\s+from\s+["'](@\/[^"']+)["']/g)) {
    const imported = match[1]
      .split(",")
      .map((entry) => entry.trim().split(/\s+as\s+/).pop()!.trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    const mounted = imported.filter((name) => new RegExp(`<${name}[\\s/>]`).test(source));
    if (mounted.length === 0) continue;

    for (const candidate of [`${match[2].replace("@/", "src/")}.tsx`, `${match[2].replace("@/", "src/")}.ts`]) {
      if (!TRANSIT_FILES.includes(candidate)) continue;
      let text: string;
      try {
        text = readSource(candidate);
      } catch {
        continue;
      }
      if (CAVEAT_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(text))) return true;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */

const ROUTE_FILES = TRANSIT_FILES.filter((file) => file.startsWith("src/app/api/") && file.endsWith("route.ts"));
const SURFACE_FILES = TRANSIT_FILES.filter((file) => /\.tsx$/.test(file));

const TRANSIT_HANDLERS = ROUTE_FILES.flatMap(routeHandlers);

/**
 * The handlers that answer with derived service levels.
 *
 * DELETE IS EXCLUDED, and this is the one exemption in the positive half worth
 * arguing for. `DELETE /api/gtfs/feeds/[feedId]` reports what it destroyed —
 * "1,204 route and 18,141 stop service-level rows removed" — which names the
 * markers without presenting a service claim. Attaching four qualifications
 * about hourly averages to a deletion receipt would be noise, and noise is what
 * trains a reader to skip the caveats that matter.
 */
const SERVICE_LEVEL_HANDLERS = TRANSIT_HANDLERS.filter(
  (handler) => PRESENTED_METHODS.includes(handler.method) && carriesServiceLevels(handler.text)
);

/**
 * The tokens that mean "this surface carries the GTFS caveats".
 *
 * DERIVED FROM TWO PLACES, NEITHER OF THEM TYPED HERE: the export names of
 * `caveats.ts` (which is what a server-side surface imports), and the names the
 * transit routes actually give the caveats in their own responses (which is what
 * a client-side surface reads off the payload — `caveats`, `caveatsByFeedId`).
 * A rename in either place carries this guard with it instead of leaving a stale
 * token that matches nothing and therefore forbids nothing.
 *
 * THE BARE SINGULAR "caveat" IS DELIBERATELY NOT A TOKEN, and it cost a rewrite
 * of this section to learn why. `data-hub/page.tsx` renders
 * `statusDescriptor.caveat` for a DATA CONNECTOR — nothing to do with transit —
 * and with the singular in the set the page satisfied the caveat requirement by
 * accident, on a string about a connector's sync posture. That is the exact
 * shape of a vacuous pass: green for a reason that has nothing to do with the
 * property being asserted.
 */
const CAVEAT_TOKENS = [
  ...Object.keys(gtfsCaveats),
  ...new Set(
    TRANSIT_HANDLERS.flatMap((handler) => handler.responseProperties).filter((name) =>
      name.toLowerCase().startsWith("caveat")
    )
  ),
];

describe("the transit lane scans something", () => {
  it("finds the files it is about to make claims over", () => {
    // Every assertion in this file is "no offender was found", which is also
    // what a broken collector, a renamed directory and a wrong root all return.
    expect(TRANSIT_FILES.length).toBeGreaterThan(10);

    for (const root of TRANSIT_ROOTS) {
      expect(
        TRANSIT_FILES.filter((file) => file.startsWith(root)).length,
        `${root} contributed no files to the transit claim scan`
      ).toBeGreaterThan(0);
    }
  });

  it("reaches the mixed roots through their imports, not through a typed filename", () => {
    expect(TRANSIT_FILES).toContain("src/components/data-hub/gtfs-ingest-panel.tsx");
    expect(TRANSIT_FILES).toContain("src/app/(app)/data-hub/page.tsx");

    // And it does NOT drag in the rest of the Data Hub, which is the whole point
    // of deciding membership by reach. A connector card is allowed to say
    // "real-time" about a connector.
    const dataHubComponents = collectSourceFiles("src/components/data-hub");
    expect(dataHubComponents.length).toBeGreaterThan(
      TRANSIT_FILES.filter((file) => file.startsWith("src/components/data-hub")).length
    );
  });

  it("collects text that can reach a person, and nothing from comments", () => {
    const caveatRuns = renderableRuns("src/lib/gtfs/caveats.ts");
    expect(caveatRuns.some((run) => run.includes("not a timetable"))).toBe(true);

    // `caveats.ts`'s header comment contains "what time the 4:15 leaves". If it
    // is being collected, this guard is scanning comments after all and the
    // whole scoping decision above is a fiction.
    expect(caveatRuns.some((run) => run.includes("4:15"))).toBe(false);

    // JSX text is collected — without this, every component in the lane would be
    // scanned as if it rendered nothing.
    const panelRuns = renderableRuns("src/components/data-hub/gtfs-ingest-panel.tsx");
    expect(panelRuns.some((run) => run.includes("trip counts, headways"))).toBe(true);
  });
});

describe("what the transit lane may not say about its own data", () => {
  it.each(TRANSIT_FILES)("keeps %s inside service-level claims", (file) => {
    for (const run of renderableRuns(file)) {
      for (const sentence of assertableSentences(run)) {
        for (const { label, pattern } of PROHIBITED_TRANSIT_CLAIMS) {
          expect(sentence, `${file} contains a prohibited transit claim (${label})`).not.toMatch(pattern);
        }
      }
    }
  });

  it("actually catches the overclaims it is meant to catch", () => {
    // A guard nobody can see fail is indistinguishable from no guard.
    const overclaims: Array<[string, string]> = [
      ["a departure time presented as an answer", "The next bus leaves from this stop shortly."],
      ["a departure time presented as an answer", "Route 1 departs at 4:15 from Main and Second."],
      ["a departure time presented as an answer", "Catch the 4:15 to downtown."],
      ["a departure time presented as an answer", "Departures begin at 6:40 am."],
      ["a departure time presented as an answer", "Open the departure board for this stop."],
      ["real-time service OpenPlan does not read", "Real-time vehicle positions for this corridor."],
      ["real-time service OpenPlan does not read", "Live arrivals at every stop in view."],
      ["real-time service OpenPlan does not read", "Your bus is arriving now."],
      [
        "complete transit coverage a workspace's feeds cannot have",
        "A map of the complete transit network in your region.",
      ],
      ["complete transit coverage a workspace's feeds cannot have", "Showing every route in the county."],
      ["a timetable presented as something OpenPlan provides", "View the timetable for this route."],
      ["a timetable presented as something OpenPlan provides", "OpenPlan shows the schedule for each stop."],
    ];

    for (const [label, text] of overclaims) {
      const matcher = PROHIBITED_TRANSIT_CLAIMS.find(
        (claim) => claim.label === label && assertableSentences(text).some((sentence) => claim.pattern.test(sentence))
      );
      expect(matcher, `"${text}" should trip: ${label}`).toBeDefined();
    }
  });

  it("does not fire on the honest phrasings the lane actually uses", () => {
    const honest = [
      "These are trip counts derived from a published schedule for one service day — not a timetable.",
      "Bring an agency's published schedule into this workspace",
      "OpenPlan reads a GTFS feed and keeps how often service runs — trip counts, headways and a derived peak hour.",
      "Departures after midnight belong to the day whose service they run under, and GTFS writes them as 24:00:00 and later; OpenPlan preserves that.",
      "Service window 2024-08-01 to 2025-04-05 — that schedule ENDED 16 months ago.",
      "What every number from this feed comes with (4)",
      "Every workspace on this deployment reads this feed.",
    ];

    for (const text of honest) {
      for (const sentence of assertableSentences(text)) {
        for (const { label, pattern } of PROHIBITED_TRANSIT_CLAIMS) {
          expect(sentence, `honest copy wrongly tripped ${label}: "${text}"`).not.toMatch(pattern);
        }
      }
    }
  });

  it("needs the negation filter, and would fail on its own disclosures without it", () => {
    /**
     * NOT DECORATION. The negation filter is the one piece of this guard that
     * could be deleted as "unnecessary" by someone tidying up, and doing so
     * would fail the build on the two sentences that STATE the commitment:
     * `GTFS_NOT_A_TIMETABLE_CAVEAT` and the ingest panel's description both end
     * "…can never tell a rider when the next vehicle leaves".
     *
     * Asserting it here means the next person learns that from a passing test
     * rather than from a red build they will fix by weakening a pattern.
     */
    const disclosures = [
      "so it cannot tell a rider when the next vehicle leaves.",
      "It deliberately does not store individual departure times, so it can never tell a rider when the next vehicle leaves.",
    ];

    for (const text of disclosures) {
      expect(assertableSentences(text), `"${text}" is not being negation-filtered`).toEqual([]);
      expect(
        PROHIBITED_TRANSIT_CLAIMS.some((claim) => claim.pattern.test(text)),
        `"${text}" no longer trips any pattern, so the negation filter is protecting nothing`
      ).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The positive half                                                            */
/* -------------------------------------------------------------------------- */

describe("the service-level markers this guard is built from", () => {
  it("derives figure columns from the migrations rather than a typed list", () => {
    // A derivation that finds nothing would exempt every surface below from the
    // caveat requirement while reporting success.
    expect(SERVICE_LEVEL_COLUMNS).toContain("trips_per_day");
    expect(SERVICE_LEVEL_COLUMNS).toContain("peak_headway_seconds");
    expect(SERVICE_LEVEL_COLUMNS).toContain("median_headway_basis");
    expect(SERVICE_LEVEL_COLUMNS.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps identifying columns out of the marker set", () => {
    // If `route_id` or `latitude` counted as a service-level figure, every
    // mapping surface in the product would be a transit-claim surface and this
    // guard would be failing features it has no business in.
    for (const column of ["route_id", "stop_id", "latitude", "longitude", "created_at", "workspace_id"]) {
      expect(SERVICE_LEVEL_COLUMNS).not.toContain(column);
    }
  });

  it("derives its caveat vocabulary from the module and from the routes", () => {
    expect(CAVEAT_TOKENS).toContain("selectGtfsCaveats");
    expect(CAVEAT_TOKENS).toContain("GTFS_NOT_A_TIMETABLE_CAVEAT");

    // The client-side half, read off what the routes actually answer with. If
    // this stops being derived, every component check below degrades to "does
    // this file import the caveats module", which no component does.
    expect(CAVEAT_TOKENS).toContain("caveatsByFeedId");
    expect(CAVEAT_TOKENS).not.toContain("caveat");
  });
});

describe("caveats travel with the service levels", () => {
  it("finds the transit handlers that carry derived service levels", () => {
    // Named individually because an empty list is what a broken projection
    // expansion produces, and these five are the handlers that certainly do
    // carry service levels today.
    const found = SERVICE_LEVEL_HANDLERS.map((handler) => `${handler.file} ${handler.method}`);

    expect(found).toEqual(
      expect.arrayContaining([
        "src/app/api/gtfs/feeds/route.ts GET",
        "src/app/api/gtfs/feeds/route.ts POST",
        "src/app/api/gtfs/feeds/[feedId]/route.ts GET",
        "src/app/api/gtfs/feeds/upload/route.ts POST",
        "src/app/api/gtfs/feeds/[feedId]/refresh/route.ts POST",
      ])
    );

    // And the catalog search does NOT, because it lists feeds nobody has
    // ingested yet and derives nothing. A trigger set wide enough to catch it
    // would be a trigger set that means nothing.
    expect(found).not.toContain("src/app/api/gtfs/catalog/search/route.ts GET");

    // The handler parser must be finding handlers that carry NOTHING too, or it
    // is not parsing handlers — it is matching whole files.
    expect(TRANSIT_HANDLERS.length).toBeGreaterThan(SERVICE_LEVEL_HANDLERS.length);
  });

  it.each(SERVICE_LEVEL_HANDLERS)("$file $method answers with the caveats", (handler) => {
    expect(
      handler.responseProperties.length,
      `${handler.file} ${handler.method} was parsed as having no JSON response at all`
    ).toBeGreaterThan(0);

    expect(
      handler.responseProperties.some((name) => name.toLowerCase().startsWith("caveat")),
      `${handler.file} ${handler.method} returns derived service levels but no caveats. Every number this lane ` +
        "produces is an hourly average taken off one representative date from a schedule that may have stopped " +
        "running — a figure that lands in a regional transportation plan or a Title VI finding with none of " +
        "that attached is the harm this whole module is shaped to avoid. `selectGtfsCaveats` builds the list; " +
        "the response carries it."
    ).toBe(true);
  });

  it.each(SURFACE_FILES.filter((file) => carriesServiceLevels(readSource(file))))(
    "%s renders the caveats",
    (file) => {
      expect(
        rendersCaveats(file),
        `${file} renders derived service levels without the caveats that qualify them, and without mounting ` +
          "anything that does."
      ).toBe(true);
    }
  );

  it("finds the rendering surfaces it just made claims over", () => {
    const rendering = SURFACE_FILES.filter((file) => carriesServiceLevels(readSource(file)));
    expect(rendering).toContain("src/components/data-hub/gtfs-ingest-panel.tsx");
    expect(rendering).toContain("src/app/(app)/data-hub/page.tsx");

    // THE HOP IS EXERCISED, and this is where that is proven rather than
    // assumed. `data-hub/page.tsx` names no transit caveat token itself; it
    // carries them purely by mounting `<GtfsIngestPanel />`. If the page ever
    // starts naming them directly, the hop stops being load-bearing and becomes
    // machinery nobody is testing — so this asserts BOTH halves.
    const page = "src/app/(app)/data-hub/page.tsx";
    expect(CAVEAT_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(readSource(page)))).toBe(false);
    expect(rendersCaveats(page)).toBe(true);
  });
});

/**
 * `service_end_date` IS NOT A DETAIL BELOW THE NUMBER, IT IS PART OF IT.
 *
 * `gtfs_feeds.status = 'loaded'` describes the INGEST and says nothing about
 * whether the schedule inside the feed is still running. On real catalog feeds
 * it usually is not. A headway printed without the service window reads as
 * current service; the same headway printed beside "that schedule ended 16
 * months ago" is a historic fact, which is a different sentence entirely.
 *
 * The Supabase clients in this repo are deliberately untyped, so dropping this
 * column from a projection is not a compile error and not a test failure in any
 * mocked page test — it renders `undefined` with the suite green. Asserting on
 * the projection STRING is the only thing that catches it, which is CLAUDE.md's
 * standing instruction for exactly this reason.
 */
describe("every presentation of a feed version asks for its service window", () => {
  /**
   * The two projections that are deliberately narrow, excluded BY CONSTANT NAME
   * and not by file, with the reason each one gives for itself:
   *
   *   - `GTFS_FEED_VERSION_TEARDOWN_COLUMNS` is what a DELETE reads to say what
   *     it is about to destroy. A service window is not part of that sentence.
   *   - `GTFS_FEED_REFRESH_SOURCE_COLUMNS` is narrow as a MECHANISM: a route
   *     holding only those columns cannot prefer a URL the caller supplied,
   *     because it never asked for one.
   */
  const NOT_A_PRESENTATION = new Set(["GTFS_FEED_VERSION_TEARDOWN_COLUMNS", "GTFS_FEED_REFRESH_SOURCE_COLUMNS"]);

  const PRESENTATION_ROOTS = [
    "src/app/api/gtfs",
    "src/app/(app)/data-hub",
    "src/components/data-hub",
    "src/lib/transit",
  ].map((root) => path.join(REPO_ROOT, root));

  /** Version-row reads on a presentation surface, with the projection resolved. */
  function presentationVersionReads(): Array<{ where: string; projection: string | null; source: string }> {
    return collectSupabaseSelectSites({ roots: PRESENTATION_ROOTS })
      .filter((site) => site.table === "gtfs_feed_versions" && !site.followsWrite)
      .map((site) => {
        const identifier = site.projectionExpression.trim();
        const constant = (gtfsProjections as Record<string, unknown>)[identifier];
        return {
          where: `${site.file}:${site.line}`,
          projection: site.projection ?? (typeof constant === "string" ? constant : null),
          source: identifier,
        };
      })
      .filter((read) => !NOT_A_PRESENTATION.has(read.source));
  }

  it("finds the version reads it is about to make claims over", () => {
    const reads = presentationVersionReads();

    // Four today: the list route reads current and recent, the detail route
    // reads current and this feed's ingests, and the Data Hub page reads the
    // service window straight into its card. Zero is what a broken collector,
    // a renamed table and an unresolvable constant all produce.
    expect(reads.length).toBeGreaterThanOrEqual(4);

    // Both resolution paths are exercised — the imported constant and the inline
    // string. If either stopped resolving, its sites would carry a null
    // projection and be reported below rather than passing silently.
    expect(reads.some((read) => read.source === "GTFS_FEED_VERSION_COLUMNS")).toBe(true);
    expect(reads.some((read) => read.source.startsWith('"'))).toBe(true);
  });

  it("asks for service_end_date on every one of them", () => {
    const offenders = presentationVersionReads()
      .filter((read) => read.projection === null || !read.projection.includes("service_end_date"))
      .map((read) => `${read.where} (${read.source})`);

    expect(
      offenders,
      "a surface reads a feed version for display without asking for `service_end_date`. The clients are " +
        "untyped, so this renders `undefined` rather than failing — and the consequence is a headway " +
        "presented as current service when the schedule it came from stopped running."
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The reader's predicate                                                       */
/* -------------------------------------------------------------------------- */

/**
 * "THE FEED A WORKSPACE ANALYSES WITH" IS ONE EXPRESSION, AND THIS IS WHERE THAT
 * IS ENFORCED.
 *
 * `persist.ts` states the rule and then says a guard "can then assert that every
 * reader goes through this function". Until this block existed, none did — the
 * predicate was written once and defended by nothing.
 *
 * Both halves are load-bearing in DIFFERENT directions, which is why half of it
 * is worse than none:
 *   - `is_current` alone reads a version that failed AFTER being promoted as
 *     though it were service data;
 *   - `status = 'ready'` alone gives a workspace with three successful ingests
 *     three times its real stops.
 *
 * So the offence is not "did not use the helper" — it is FILTERING ON EITHER
 * COLUMN BY HAND, which is the act that lets the two halves drift apart. The
 * scan is repository-wide rather than lane-scoped on purpose: a corridor
 * analysis or an equity finding reading `gtfs_feed_versions` directly is exactly
 * the drift, and it would not be written inside `src/lib/gtfs/`.
 */
describe("every reader of a feed version goes through the shared predicate", () => {
  const PREDICATE_COLUMNS = Object.keys(GTFS_CURRENT_VERSION_FILTER);

  /** Every `.eq()`/`.in()` in a chain rooted at `.from("gtfs_feed_versions")`. */
  function versionFilters(): Array<{ where: string; column: string; verb: string }> {
    const found: Array<{ where: string; column: string; verb: string }> = [];

    for (const file of collectSourceFiles("src").filter((entry) => !entry.startsWith("src/test"))) {
      const source = parseSource(file);

      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "from" &&
          node.arguments.length === 1 &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          node.arguments[0].text === "gtfs_feed_versions"
        ) {
          // Walk up the fluent chain: `.from(x)` → `.select(…)` → `.eq(…)` → …
          let cursor: ts.Node = node;
          while (
            cursor.parent &&
            ts.isPropertyAccessExpression(cursor.parent) &&
            cursor.parent.parent &&
            ts.isCallExpression(cursor.parent.parent)
          ) {
            const call = cursor.parent.parent;
            const verb = cursor.parent.name.text;
            const first = call.arguments[0];
            if ((verb === "eq" || verb === "in") && first && ts.isStringLiteralLike(first)) {
              found.push({
                where: `${file}:${source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1}`,
                column: first.text,
                verb,
              });
            }
            cursor = call;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    return found;
  }

  /**
   * THE RATCHET, and it holds exactly two entries today.
   *
   * Both are inside `persist.ts`, both are named with the reason they are not
   * readers of service data, and a stale entry fails below so the list can only
   * shrink.
   *
   * ONE OF THEM IS FLAGGED RATHER THAN BLESSED. `promoteGtfsFeedVersion` reads
   * the currently-promoted version on `is_current` ALONE to decide whether the
   * incoming ingest is a collapse. If a version was promoted and later failed,
   * that read returns a row no workspace can see — `filterToCurrentReadyVersion`
   * would return nothing — so the collapse comparison is made against counts
   * nobody is reading, and a correct refetch can be withheld on the strength of
   * them. That is the exact asymmetry the predicate exists to prevent, in the one
   * place the predicate is not applied. It is listed rather than failed because
   * this file may not edit `persist.ts`; it is recorded here so the next session
   * inherits the finding instead of rediscovering it.
   */
  const HAND_WRITTEN_FILTERS: Array<{ where: string; column: string; why: string }> = [
    {
      where: "src/lib/gtfs/persist.ts",
      column: "is_current",
      why:
        "promoteGtfsFeedVersion reads the version currently in use to size a collapse. See the note above: " +
        "this one is a candidate for the helper, not an exemption from it.",
    },
    {
      where: "src/lib/gtfs/persist.ts",
      column: "status",
      why:
        "reapAbandonedGtfsIngests selects the NON-TERMINAL statuses. It is the sweeper, not a reader — the " +
        "rows it wants are by definition the ones no reader may see, so the shared predicate would select " +
        "exactly the wrong set.",
    },
  ];

  it("finds the filter chains it is about to make claims over", () => {
    const filters = versionFilters();

    // The walker returning nothing is indistinguishable from perfect compliance.
    // `gtfs_feed_versions` is filtered by `id` and `feed_id` all over the lane.
    expect(filters.length).toBeGreaterThan(5);
    expect(filters.some((filter) => filter.column === "id")).toBe(true);
    expect(filters.some((filter) => filter.column === "feed_id")).toBe(true);
  });

  it("states both halves of the predicate in one place", () => {
    expect(PREDICATE_COLUMNS.sort()).toEqual(["is_current", "status"]);
    expect(GTFS_CURRENT_VERSION_FILTER.is_current).toBe(true);
    expect(GTFS_CURRENT_VERSION_FILTER.status).toBe("ready");
  });

  it("is applied by the surfaces that read service data, not typed out at each of them", () => {
    // Reachability, not existence. A predicate nothing calls is a comment.
    const callers = collectSourceFiles("src")
      .filter((file) => !file.startsWith("src/test") && file !== "src/lib/gtfs/persist.ts")
      .filter((file) => /\bfilterToCurrentReadyVersion\s*\(/.test(readSource(file)));

    expect(callers).toEqual(
      expect.arrayContaining([
        "src/app/api/gtfs/feeds/route.ts",
        "src/app/api/gtfs/feeds/[feedId]/route.ts",
        "src/app/(app)/data-hub/page.tsx",
      ])
    );
  });

  it("has no hand-written is_current or status filter outside the recorded two", () => {
    const offenders = versionFilters()
      .filter((filter) => PREDICATE_COLUMNS.includes(filter.column))
      .filter(
        (filter) =>
          !HAND_WRITTEN_FILTERS.some(
            (allowed) => filter.where.startsWith(allowed.where) && filter.column === allowed.column
          )
      )
      .map((filter) => `${filter.where} .${filter.verb}("${filter.column}", …)`);

    expect(
      offenders,
      "a read of gtfs_feed_versions filters on `is_current` or `status` by hand instead of through " +
        "`filterToCurrentReadyVersion`. Filtering on `is_current` alone reads a promoted-then-failed version " +
        "as service data; filtering on `status` alone gives a workspace with three successful ingests three " +
        "times its real stops. Both halves, or neither."
    ).toEqual([]);
  });

  it("keeps the recorded exceptions from going stale", () => {
    // A ratchet that cannot go stale can only shrink. An entry describing a
    // filter that no longer exists is a licence nobody is using, and it would
    // quietly re-authorise the next filter written in that file.
    const filters = versionFilters();
    for (const allowed of HAND_WRITTEN_FILTERS) {
      expect(
        filters.some((filter) => filter.where.startsWith(allowed.where) && filter.column === allowed.column),
        `the recorded exception for ${allowed.where} (${allowed.column}) no longer matches anything. ` +
          `Reason on file: ${allowed.why}. Delete the entry.`
      ).toBe(true);
    }
  });
});
