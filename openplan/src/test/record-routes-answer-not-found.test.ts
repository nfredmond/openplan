/**
 * KI-2026-11-14-280: every record route answers a real 404 for a record the
 * reader cannot see.
 *
 * A `loading.tsx` starts the response stream with status 200 and wraps every
 * page and nested layout below it, but not the layout in its own folder
 * (Next.js 16.4.2, node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/loading.md, "Status codes"). A page's `notFound()` under
 * such a boundary renders the not-found screen with HTTP 200. So this guard
 * walks every dynamic route folder under `(app)` and `(portal)` and holds each
 * one to one of two shapes:
 *
 *   1. A loading boundary covers its pages, and a layout at or below the
 *      record folder, and at or above every such `loading.tsx`, makes the
 *      record check (`requireRecordRow(` or its own `notFound(`).
 *   2. No loading boundary covers its pages, the route is listed below with
 *      the reason, and every page under it calls `notFound(` itself.
 *
 * Either way, no `loading.tsx` may sit above the record folder: a layout in the
 * record folder would be inside that boundary and could not set the status.
 *
 * BLIND CATEGORY: this reads file layout and source text. It does not prove
 * the HTTP status on a running server (the lane's before and after tables do),
 * that the check reads the right row (the per-family layout tests do), or that
 * a page with no loading boundary calls `notFound()` on the right branch.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";

const APP_DIR = path.join(process.cwd(), "src", "app");
const ROUTE_GROUPS = ["(app)", "(portal)"];

/**
 * Record routes whose pages no loading boundary covers, so each page's own
 * `notFound()` keeps its 404. Adding a `loading.tsx` to one of these moves it
 * to shape 1 and fails this guard until its layout makes the record check.
 */
const PAGES_ANSWER_THEMSELVES: Record<string, string> = {
  "(app)/aerial/missions/[missionId]": "Mission and edit pages read the mission and call notFound() for no row.",
  "(app)/county-runs/[countyRunId]": "The page reads the run in the current workspace and calls notFound() for no row.",
  "(app)/engagement/[campaignId]": "Campaign and preview pages read the campaign and call notFound() for no row.",
  "(app)/grants/bca/[projectId]": "The page reads the project and the reader's role and calls notFound() for either refusal.",
  "(app)/invoicing/engagements/[engagementId]": "The contract read refuses a missing or unmanaged contract with 403, which the page turns into notFound().",
  "(app)/land-use-plans/[planId]": "The page reads the plan's id through the reader's client and calls notFound() for no row.",
  "(app)/maps/[packageId]": "The page reads the map package and calls notFound() for no row.",
  "(app)/models/[modelId]": "The page reads the model and calls notFound() for no row.",
  "(app)/scenarios/[scenarioSetId]": "The page reads the scenario set and calls notFound() for no row.",
};

/**
 * Dynamic folders that are not records. None today: every dynamic segment
 * under these groups names a record or a public share address. A future entry
 * needs a reason, such as a folder whose value is a filter rather than an id.
 */
const NOT_RECORD_ROUTES: Record<string, string> = {};

function isDir(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory();
}

function subdirs(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter(isDir);
}

/** The first dynamic folder on every branch: the folder that names the record. */
function recordRouteDirs(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const child of subdirs(dir)) {
      if (path.basename(child).startsWith("[")) found.push(child);
      else walk(child);
    }
  };
  for (const group of ROUTE_GROUPS) walk(path.join(APP_DIR, group));
  return found.sort();
}

function routeName(dir: string): string {
  return path.relative(APP_DIR, dir).split(path.sep).join("/");
}

function allDirsUnder(dir: string): string[] {
  return [dir, ...subdirs(dir).flatMap(allDirsUnder)];
}

/** Folders from `src/app` down to, but not including, `dir`. */
function ancestorsOf(dir: string): string[] {
  const out: string[] = [];
  let current = path.dirname(dir);
  while (current.startsWith(APP_DIR)) {
    out.unshift(current);
    if (current === APP_DIR) break;
    current = path.dirname(current);
  }
  return out;
}

function code(file: string): string {
  return stripSourceComments(readFileSync(file, "utf8"));
}

function layoutMakesRecordCheck(dir: string): boolean {
  const layout = path.join(dir, "layout.tsx");
  if (!existsSync(layout)) return false;
  const source = code(layout);
  return source.includes("requireRecordRow(") || source.includes("notFound(");
}

/** Every reason this record route can answer 200 for a record the reader cannot see. */
function recordRouteProblems(dir: string): string[] {
  const name = routeName(dir);
  if (NOT_RECORD_ROUTES[name]) return [];
  const problems: string[] = [];

  for (const ancestor of ancestorsOf(dir)) {
    if (existsSync(path.join(ancestor, "loading.tsx"))) {
      problems.push(
        `${name}: ${routeName(ancestor) || "src/app"}/loading.tsx sits above the record folder, so no layout in it can set the status`
      );
    }
  }

  const loadingDirs = allDirsUnder(dir).filter((d) => existsSync(path.join(d, "loading.tsx")));
  if (loadingDirs.length > 0) {
    for (const loadingDir of loadingDirs) {
      // A layout counts when it sits between the record folder and this boundary, inclusive.
      const between: string[] = [];
      for (let d = loadingDir; d.startsWith(dir); d = path.dirname(d)) {
        between.push(d);
        if (d === dir) break;
      }
      if (!between.some(layoutMakesRecordCheck)) {
        problems.push(`${name}: ${routeName(loadingDir)}/loading.tsx covers its pages but no layout above it makes the record check`);
      }
    }
    return problems;
  }

  if (!PAGES_ANSWER_THEMSELVES[name]) {
    problems.push(`${name}: no loading boundary and not listed in PAGES_ANSWER_THEMSELVES with a reason`);
    return problems;
  }
  for (const page of allDirsUnder(dir).map((d) => path.join(d, "page.tsx")).filter(existsSync)) {
    if (!code(page).includes("notFound(")) {
      problems.push(`${name}: ${path.relative(dir, page)} never calls notFound()`);
    }
  }
  return problems;
}

describe("every record route answers a real 404 for a record the reader cannot see", () => {
  const routes = recordRouteDirs();

  it("finds the record routes it is meant to guard", () => {
    const names = routes.map(routeName);
    // A walk that found nothing would pass every check below.
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const name of [
      "(app)/plans/[planId]",
      "(app)/programs/[programId]",
      "(app)/projects/[projectId]",
      "(app)/reports/[reportId]",
      "(app)/rtp/[rtpCycleId]",
      "(app)/grants/bca/[projectId]",
      "(portal)/engage/[shareToken]",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("lists only routes that exist", () => {
    const names = new Set(routes.map(routeName));
    for (const name of [...Object.keys(PAGES_ANSWER_THEMSELVES), ...Object.keys(NOT_RECORD_ROUTES)]) {
      expect(names.has(name), `${name} is listed but no such route folder exists`).toBe(true);
    }
  });

  it.each(recordRouteDirs().map((dir) => [routeName(dir), dir]))("%s", (_name, dir) => {
    expect(recordRouteProblems(dir)).toEqual([]);
  });
});
