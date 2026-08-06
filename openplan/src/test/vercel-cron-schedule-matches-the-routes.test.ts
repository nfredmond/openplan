import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `vercel.json` NAMES ROUTES, AND NOTHING CHECKED THAT THEY EXIST.
 *
 * A cron is the one kind of route whose caller is not in this repository at
 * all: the scheduler lives on the deployment platform and reads `vercel.json`.
 * That makes both directions of the cross-reference fail silently, and in
 * opposite ways that are each worse than an error:
 *
 *   * A `crons[].path` that names no route — a rename, a typo, a directory
 *     moved — deploys cleanly and then does nothing on a schedule. Whatever the
 *     sweep existed to prevent simply accumulates. Nothing in `npm test`
 *     notices, because the path is a string in a JSON file, and nothing at
 *     build time notices, because Vercel resolves it at invocation.
 *   * A route under `src/app/api/cron/` with NO `crons` entry is a sweep that
 *     was written, reviewed, tested and never once executed. That is the
 *     shipped-invisible class exactly: complete, correct, unreachable.
 *
 * This is the mechanical cross-reference class that CLAUDE.md carves out from
 * the "never guard a copy of the artifact" rule — `vercel.json` IS the
 * artifact the scheduler reads, and there is no live surface to check instead.
 *
 * WHAT IT DOES NOT CHECK: that the schedule is sensible, that the route works,
 * or that CRON_SECRET is configured on the deployment. Only that the two sides
 * name each other.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");
const VERCEL_JSON = path.join(process.cwd(), "vercel.json");

type VercelConfig = {
  crons?: Array<{ path?: string; schedule?: string }>;
  functions?: Record<string, unknown>;
};

function readVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(VERCEL_JSON, "utf8")) as VercelConfig;
}

/** `/api/cron/reap-model-runs` -> `src/app/api/cron/reap-model-runs/route.ts` */
function routeFileForUrlPath(urlPath: string): string {
  return path.join(APP_DIR, urlPath.replace(/^\//, ""), "route.ts");
}

/** Every directory under src/app/api/cron that holds a route handler. */
function cronRouteUrlPaths(): string[] {
  const cronDir = path.join(APP_DIR, "api", "cron");
  if (!existsSync(cronDir)) return [];
  return readdirSync(cronDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(path.join(cronDir, entry.name, "route.ts")))
    .map((entry) => `/api/cron/${entry.name}`)
    .sort();
}

describe("vercel.json and the cron routes name each other", () => {
  /**
   * NON-VACUITY. Both assertions below are "this list is empty", and an empty
   * list is also what a broken detector returns. If either side stops finding
   * the crons that certainly exist, the guard would pass by finding nothing —
   * which is the failure mode it was written to prevent in the first place.
   */
  it("finds the crons and the routes that certainly exist", () => {
    const config = readVercelConfig();
    const scheduled = (config.crons ?? []).map((entry) => entry.path);
    const onDisk = cronRouteUrlPaths();

    expect(scheduled.length).toBeGreaterThanOrEqual(2);
    expect(onDisk.length).toBeGreaterThanOrEqual(2);
    expect(scheduled).toContain("/api/cron/reap-model-runs");
    expect(onDisk).toContain("/api/cron/reap-model-runs");
  });

  it("schedules nothing that does not exist on disk", () => {
    const config = readVercelConfig();

    const missing = (config.crons ?? [])
      .map((entry) => entry.path ?? "")
      .filter((urlPath) => urlPath.length > 0)
      .filter((urlPath) => !existsSync(routeFileForUrlPath(urlPath)));

    expect(
      missing,
      "vercel.json schedules these paths, but no route file answers them. The platform resolves a " +
        "cron path at invocation, so this deploys cleanly and then silently never runs."
    ).toEqual([]);
  });

  it("leaves no cron route unscheduled", () => {
    const config = readVercelConfig();
    const scheduled = new Set((config.crons ?? []).map((entry) => entry.path));

    const unscheduled = cronRouteUrlPaths().filter((urlPath) => !scheduled.has(urlPath));

    expect(
      unscheduled,
      "these routes live under src/app/api/cron but nothing in vercel.json schedules them, so " +
        "they have never executed. A sweep nobody runs is worse than no sweep: the surface it " +
        "was meant to keep honest goes stale while the code implies it does not."
    ).toEqual([]);
  });

  it("every cron carries a schedule, since a path alone runs at no time at all", () => {
    const config = readVercelConfig();
    const scheduleless = (config.crons ?? [])
      .filter((entry) => !entry.schedule || entry.schedule.trim().length === 0)
      .map((entry) => entry.path ?? "<no path>");

    expect(scheduleless).toEqual([]);
  });

  /**
   * The same silent-miss applies to `functions`, whose keys are repo-relative
   * FILE paths rather than URL paths — a distinction that is easy to get
   * backwards, and which does nothing when it is wrong: a route that was given
   * 60 seconds and 1 GB quietly reverts to the platform default and starts
   * timing out on the large exports the override existed for.
   */
  it("tunes only functions that exist, and keys them by file path", () => {
    const config = readVercelConfig();

    const missing = Object.keys(config.functions ?? {}).filter(
      (filePath) => !existsSync(path.join(process.cwd(), filePath))
    );

    expect(
      missing,
      "vercel.json's `functions` keys are repo-relative file paths. These resolve to nothing, so " +
        "the memory and maxDuration overrides they carry are not applied to anything."
    ).toEqual([]);
  });
});
