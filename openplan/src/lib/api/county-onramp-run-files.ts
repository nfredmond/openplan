import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { NextResponse } from "next/server";
import { isCountyOnrampWorkerConfigured } from "@/lib/config/deployment-health-facts";

/**
 * What a county run route says when this deployment cannot reach the run's
 * files on disk.
 *
 * WHY THIS EXISTS. The scaffold, validation-refresh and validation-readiness
 * routes read and write files at the paths a county worker recorded in the
 * run's manifest. That only works when the app and the worker share one
 * folder, as the local compose setup does. A serverless host (the hosted
 * installation runs on Vercel) has only its deployment bundle on disk and no
 * county worker beside it, so those paths do not exist there. The routes used
 * to answer with a bare "file was not found" or an unexplained 500, which a
 * planner reads as a broken or empty run.
 *
 * The answer is "unavailable here", not "missing" and not "failed": the run's
 * stored state is left exactly as it was, and the message says so. Whether a
 * county worker is configured decides which sentence follows, so a copy with
 * no county worker says it has none, and one with a worker points at the
 * shared folder instead.
 */

/** Resolves a manifest path the way every county run route always has. */
export function resolveCountyRunStoredPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), "..", pathValue);
}

/** True when this process can see the folder at `folderPath`. */
export async function countyRunFolderIsReachable(folderPath: string): Promise<boolean> {
  try {
    await access(folderPath);
    return true;
  } catch {
    return false;
  }
}

function errnoCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Codes that say this process cannot touch the path at all. A read-only bundle
 * gives EROFS on write and a folder owned by another user gives EACCES or EPERM.
 */
const NO_ACCESS_CODES = new Set(["EACCES", "EPERM", "EROFS"]);
/** Codes that say the path is not there, which may mean "not on this machine". */
const NOT_THERE_CODES = new Set(["ENOENT", "ENOTDIR"]);

/**
 * Whether a failed read or write of `filePath` means this copy cannot reach
 * the run's files, as opposed to a file that is simply not written yet.
 *
 * A missing file inside a folder this process can see is still "not found":
 * on a shared disk that means the worker or validator has not written it yet,
 * and the route's existing answer is the right one. A missing file whose own
 * folder is also missing is a path from another machine. Any other error
 * (bad JSON, bad CSV) is not a reachability question and returns false, so
 * the route keeps its existing error.
 */
export async function isCountyRunFileUnreachable(error: unknown, filePath: string): Promise<boolean> {
  const code = errnoCode(error);
  if (code === null) return false;
  if (NO_ACCESS_CODES.has(code)) return true;
  if (!NOT_THERE_CODES.has(code)) return false;
  return !(await countyRunFolderIsReachable(dirname(filePath)));
}

export type CountyRunFileAction =
  | "open-counts"
  | "save-counts"
  | "bring-in-validation"
  | "check-validation";

const ACTION_SENTENCE: Record<CountyRunFileAction, string> = {
  "open-counts": "so its counts cannot be opened here.",
  "save-counts": "so these counts were not saved.",
  "bring-in-validation": "so its validation results could not be brought in.",
  "check-validation": "so whether it is ready to validate cannot be checked here.",
};

/** Pure, so both deployment branches are testable without touching the environment. */
export function describeCountyRunFilesUnavailable(
  action: CountyRunFileAction,
  workerConfigured: boolean
): string {
  const setup = workerConfigured
    ? "Whoever installed OpenPlan needs to check that the modeling worker and OpenPlan share one folder for run files."
    : "Count validation needs a modeling worker that shares its files with OpenPlan, and this copy has none.";
  return `This copy of OpenPlan cannot reach the files this run was saved to, ${ACTION_SENTENCE[action]} Nothing about the run has changed. ${setup}`;
}

export const COUNTY_RUN_FILES_UNAVAILABLE_CODE = "county_run_files_unavailable";

/** 503: this deployment cannot do it, and nothing about the run is wrong. */
export function countyRunFilesUnavailableResponse(
  action: Exclude<CountyRunFileAction, "check-validation">,
  workerConfigured: boolean = isCountyOnrampWorkerConfigured()
) {
  return NextResponse.json(
    {
      error: describeCountyRunFilesUnavailable(action, workerConfigured),
      code: COUNTY_RUN_FILES_UNAVAILABLE_CODE,
    },
    { status: 503 }
  );
}
