import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * NO NEW UTC CALENDAR DAYS IN SERVER CODE (KI-2026-10-12-016).
 *
 * Servers run in UTC. `new Date().toISOString().slice(0, 10)` is the UTC date,
 * and slicing a TIMESTAMPTZ to its first ten characters is its UTC day. Both
 * turn over at 5 p.m. Pacific, which stamped evening claims, allocations and
 * invoices with tomorrow's date and called same-day deadlines passed. The fix
 * is one helper, `src/lib/time/workspace-calendar.ts`; this guard refuses a
 * new slice anywhere in `src/app/api` or `src/lib` unless it is listed below
 * with the reason it is not a planner's calendar day.
 *
 * BLIND CATEGORY: it sees the slice spellings in `PATTERNS` only. A day built
 * by `getUTCDate()` arithmetic, `toJSON()`, `Intl` with `timeZone: "UTC"`, or
 * code outside the two directories (client components, pages) is not seen.
 */

const ROOTS = [path.join("src", "app", "api"), path.join("src", "lib")];

const PATTERNS: readonly RegExp[] = [
  /\.(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/,
  /toISOString\(\)\.split\(\s*["']T["']\s*\)/,
];

type AllowedSlice = { file: string; snippet: string; reason: string };

const NOT_A_DATE = "Not a date: takes the first ten items of an array.";
const FILE_NAME = "A file name or download label, not a recorded date.";
const DATE_ARITHMETIC = "Date-only arithmetic on a YYYY-MM-DD value in UTC; no zone is involved.";
const ROUND_TRIP = "Validates that a YYYY-MM-DD string is a real date by a UTC round trip.";
const SOURCE_DATE = "A date carried by source data (a crash record or a data vintage), not a planner's day.";
const DISPLAY_ONLY = "Shows a recorded instant as its UTC day in a sentence. Not a stamp or a deadline comparison; not converted in this change.";

const ALLOWED: readonly AllowedSlice[] = [
  { file: "src/lib/grants/award-handoff.ts", snippet: "date.toISOString().slice(0, 10) === s", reason: ROUND_TRIP },
  { file: "src/app/api/analysis/route.ts", snippet: "droppedSentenceIssues.slice(0, 10)", reason: NOT_A_DATE },
  { file: "src/app/api/projects/[projectId]/bca-analyses/route.ts", snippet: "issues.slice(0, 10)", reason: NOT_A_DATE },
  { file: "src/lib/engagement/survey.ts", snippet: "texts.slice(0, 10)", reason: NOT_A_DATE },
  { file: "src/lib/safety/us-road-context-adapter.ts", snippet: ").values()).slice(0, 10)", reason: NOT_A_DATE },

  { file: "src/app/api/reports/[reportId]/artifacts/[artifactId]/download/route.ts", snippet: "generatedAt.slice(0, 10)", reason: FILE_NAME },
  {
    file: "src/app/api/funding-opportunities/[opportunityId]/application/export/[exportId]/download/route.ts",
    snippet: "generatedAt.slice(0, 10)",
    reason: FILE_NAME,
  },
  { file: "src/app/api/projects/[projectId]/evidence-bundles/[bundleId]/download/route.ts", snippet: "generated_at.slice(0, 10)", reason: FILE_NAME },
  { file: "src/app/api/funding-opportunities/[opportunityId]/application/atp-packet/route.ts", snippet: "generated_at.slice(0, 10)", reason: FILE_NAME },
  { file: "src/lib/project-evidence-bundles/bytes.ts", snippet: "generatedAt?.slice(0, 10)", reason: FILE_NAME },
  { file: "src/lib/safety/crash-export.ts", snippet: "generatedAt.slice(0, 10)", reason: FILE_NAME },
  { file: "src/lib/projects/portfolio-export.ts", snippet: "generatedAt.toISOString().slice(0, 10)", reason: FILE_NAME },
  { file: "src/lib/projects/project-geopackage.ts", snippet: "date.toISOString().slice(0, 10)", reason: FILE_NAME },

  { file: "src/lib/measures/receipts.ts", snippet: "parsed.toISOString().slice(0, 10)", reason: DATE_ARITHMETIC },
  { file: "src/lib/dashboard/coming-up.ts", snippet: "shifted.toISOString().slice(0, 10)", reason: DATE_ARITHMETIC },
  { file: "src/lib/invoicing/contracts/delivery.ts", snippet: "toISOString().slice(0,10)", reason: DATE_ARITHMETIC },
  {
    file: "src/lib/work-plans/apply.ts",
    snippet: "shifted.toISOString().slice(0, 10)",
    reason: `${DATE_ARITHMETIC} The anchor is a validated YYYY-MM-DD read as UTC midnight.`,
  },

  { file: "src/lib/knowledge-base/document-list-filters.ts", snippet: "parsed.toISOString().slice(0, 10) !== day", reason: ROUND_TRIP },
  { file: "src/lib/grants/grants-gov.ts", snippet: "parsed.toISOString().slice(0, 10) !== iso", reason: ROUND_TRIP },

  { file: "src/lib/safety/sources/fars.ts", snippet: "parsed.toISOString().slice(0, 10)", reason: SOURCE_DATE },
  { file: "src/lib/safety/sources/fars.ts", snippet: "date.toISOString().slice(0, 10)", reason: SOURCE_DATE },
  { file: "src/lib/safety/us-road-context-adapter.ts", snippet: "stamp.toISOString().slice(0, 10)", reason: SOURCE_DATE },
  {
    file: "src/lib/models/transit-feed-handoff.ts",
    snippet: "serviceEndDate.slice(0, 10)",
    reason: "A GTFS service date is already a calendar day; the slice drops nothing.",
  },
  {
    file: "src/lib/models/transit-feed-handoff.ts",
    snippet: "launchDateIso.slice(0, 10)",
    reason: "Compares a GTFS end date with the model run's recorded UTC launch day. Not converted in this change.",
  },
  {
    file: "src/lib/models/transit-feed-handoff.ts",
    snippet: "value.slice(0, 10)",
    reason: "Reads a GTFS service date string; already a calendar day.",
  },
  {
    file: "src/lib/grants/narrative-evidence.ts",
    snippet: "adoption_target_date.slice(0, 10)",
    reason: "A DATE column; the slice keeps the calendar day it already is.",
  },
  {
    file: "src/lib/examples/published-ceiling.ts",
    snippet: "createdAt.slice(0, 10)",
    reason: "The dated public record of one past run, quoted as published.",
  },

  {
    file: "src/lib/notifications/work.ts",
    snippet: "parsed.toISOString().slice(0, 10)",
    reason:
      "The UTC day of a timestamptz deadline, which is the reminder's idempotency key (due_on). Lapse dates are " +
      "stored as UTC midnight by the lapse-date control, so a zone west of UTC would read them a day early and " +
      "re-send. The window and days waited use each workspace's calendar.",
  },
  {
    file: "src/lib/assistant/context.ts",
    snippet: "today: new Date().toISOString().slice(0, 10)",
    reason: "A thirty-day transit freshness window, UTC by the design its comment states; a day cannot change its verdict.",
  },
  { file: "src/lib/aerial/artifact-custody.ts", snippet: "parsed.toISOString().slice(0, 10)", reason: DISPLAY_ONLY },
  { file: "src/lib/workspace-gis/references.ts", snippet: "archivedAt.slice(0, 10)", reason: DISPLAY_ONLY },
  { file: "src/lib/project-evidence-bundles/inventory.ts", snippet: "generated_at)?.slice(0, 10)", reason: DISPLAY_ONLY },
];

type Finding = { file: string; line: number; text: string };

/** Every slice in one file's code, ignoring comments. Exported shape kept small so the control below can drive it. */
function findCalendarDaySlices(file: string, source: string): Finding[] {
  const code = stripSourceComments(source);
  const findings: Finding[] = [];
  code.split("\n").forEach((text, index) => {
    if (PATTERNS.some((pattern) => pattern.test(text))) findings.push({ file, line: index + 1, text: text.trim() });
  });
  return findings;
}

function isAllowed(finding: Finding): boolean {
  return ALLOWED.some((entry) => entry.file === finding.file && finding.text.includes(entry.snippet));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function scan(): Finding[] {
  return ROOTS.flatMap((root) =>
    sourceFiles(path.join(process.cwd(), root)).flatMap((full) =>
      findCalendarDaySlices(path.relative(process.cwd(), full).split(path.sep).join("/"), readFileSync(full, "utf8"))
    )
  );
}

describe("calendar-day slices in server code", () => {
  it("flags the slice spellings and ignores the same text in a comment (seeded control)", () => {
    const seeded = [
      "const today = new Date().toISOString().slice(0, 10);",
      "const day = row.closes_at.slice(0,10);",
      "const day2 = stamp.toISOString().split('T')[0];",
      "// new Date().toISOString().slice(0, 10) in a comment is not code",
      "const first = items.slice(0, 5);",
    ].join("\n");
    const found = findCalendarDaySlices("src/lib/seeded.ts", seeded);
    expect(found.map((finding) => finding.line)).toEqual([1, 2, 3]);
    expect(found.some(isAllowed)).toBe(false);
  });

  it("limits the award date exception to a date-only round trip", () => {
    const file = "src/lib/grants/award-handoff.ts";
    const findings = findCalendarDaySlices(file, [
      "return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;",
      "const today = new Date().toISOString().slice(0, 10);",
    ].join("\n"));
    expect(findings.map(isAllowed)).toEqual([true, false]);
  });

  it("finds a real set of slices to judge (the scan is not vacuous)", () => {
    expect(scan().length).toBeGreaterThanOrEqual(ALLOWED.length);
  });

  it("allows no slice outside the list", () => {
    const unexplained = scan().filter((finding) => !isAllowed(finding));
    expect(
      unexplained.map((finding) => `${finding.file}:${finding.line}  ${finding.text}`),
      "A slice of an ISO string to ten characters is a UTC calendar day. Use todayIn, todayInWorkspace, " +
        "calendarDayOf or isTimestampPast from src/lib/time/workspace-calendar.ts, or add the line here with the " +
        "reason it is not a planner's calendar day."
    ).toEqual([]);
  });

  it("keeps every listed exception real (the list only shrinks)", () => {
    const findings = scan();
    const stale = ALLOWED.filter(
      (entry) => !findings.some((finding) => finding.file === entry.file && finding.text.includes(entry.snippet))
    );
    expect(stale.map((entry) => `${entry.file}: ${entry.snippet}`)).toEqual([]);
    for (const entry of ALLOWED) expect(entry.reason.length, entry.file).toBeGreaterThan(20);
  });
});
