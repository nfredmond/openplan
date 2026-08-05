import { describe, expect, it } from "vitest";
import {
  loadAerialMissionsAndPackagesForProject,
  type AerialQuerySupabaseLike,
} from "@/lib/aerial/queries";

/**
 * AN UNREADABLE AERIAL LANE IS NOT AN EMPTY ONE.
 *
 * `loadAerialMissionsAndPackagesForProject` classified one failure — a
 * deployment behind the aerial migrations — and swallowed every other one into
 * `{ missions: [], packages: [] }`. Its only caller is the project detail page,
 * which fed that straight into the spine crosslink board, so a permission
 * failure on `aerial_missions` rendered as "No aerial mission or package is
 * attached to this project yet.": an absence stated as fact about a project that
 * may have several.
 *
 * `pending` and `unreadableReason` answer different questions and both are
 * needed. Pending names an operator move (apply the migration). A reason names
 * none, and that is exactly why it must not be reported as an empty result.
 */

type Result = { data: unknown[] | null; error: { message: string } | null };

function supabaseReturning(missions: Result, packages: Result): AerialQuerySupabaseLike {
  return {
    from: (table: string) => {
      if (table === "aerial_missions") {
        return {
          select: () => ({
            eq: () => ({ order: async () => missions }),
          }),
        };
      }
      if (table === "aerial_evidence_packages") {
        return {
          select: () => ({
            in: () => ({ order: async () => packages }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as AerialQuerySupabaseLike;
}

const missionRow = {
  id: "mission-1",
  title: "Corridor overflight",
  status: "complete",
  mission_type: "corridor",
  geography_label: "Main Street",
  collected_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-02T00:00:00.000Z",
};

const packageRow = {
  id: "package-1",
  mission_id: "mission-1",
  title: "Orthomosaic exhibit",
  package_type: "orthomosaic",
  status: "ready",
  verification_readiness: "ready",
  updated_at: "2026-07-03T00:00:00.000Z",
};

const ok = (rows: unknown[]): Result => ({ data: rows, error: null });

describe("loadAerialMissionsAndPackagesForProject", () => {
  it("reports a failed mission read as unreadable rather than as no missions", async () => {
    const result = await loadAerialMissionsAndPackagesForProject(
      supabaseReturning(
        { data: null, error: { message: "permission denied for table aerial_missions" } },
        ok([])
      ),
      "project-1"
    );

    // Asserted as "not null" first so a regression reads as what it is — the
    // loader answering with no reason at all — rather than as a type complaint.
    expect(result.unreadableReason).not.toBeNull();
    expect(result.unreadableReason).toContain("aerial missions for this project could not be read");
    expect(result.unreadableReason).toContain("permission denied for table aerial_missions");
    expect(result.missions).toEqual([]);
    expect(result.packages).toEqual([]);
    // Not pending: nothing here tells an operator to apply a migration.
    expect(result.pending).toBe(false);
  });

  it("reports a failed package read as unreadable, and drops the missions with it", async () => {
    // A mission list rendered beside an unreadable package list invites the
    // reader to conclude the missions produced nothing — the same failure in
    // reverse. The report source-context loader already answers this way.
    const result = await loadAerialMissionsAndPackagesForProject(
      supabaseReturning(ok([missionRow]), {
        data: null,
        error: { message: "permission denied for table aerial_evidence_packages" },
      }),
      "project-1"
    );

    expect(result.unreadableReason).not.toBeNull();
    expect(result.unreadableReason).toContain("aerial evidence packages for this project could not be read");
    expect(result.missions).toEqual([]);
    expect(result.packages).toEqual([]);
    expect(result.pending).toBe(false);
  });

  it("keeps a pending migration as pending, with no read failure to report", async () => {
    const result = await loadAerialMissionsAndPackagesForProject(
      supabaseReturning(
        { data: null, error: { message: 'relation "aerial_missions" does not exist' } },
        ok([])
      ),
      "project-1"
    );

    expect(result.pending).toBe(true);
    expect(result.unreadableReason).toBeNull();
    expect(result.missions).toEqual([]);
  });

  it("reports a clean read as clean, including the ordinary no-aerial-work case", async () => {
    const withRows = await loadAerialMissionsAndPackagesForProject(
      supabaseReturning(ok([missionRow]), ok([packageRow])),
      "project-1"
    );

    expect(withRows.missions).toHaveLength(1);
    expect(withRows.packages).toHaveLength(1);
    expect(withRows.pending).toBe(false);
    expect(withRows.unreadableReason).toBeNull();

    // Zero rows is a successful read, and must stay distinguishable from the
    // failures above — otherwise the caller cannot tell them apart either.
    const empty = await loadAerialMissionsAndPackagesForProject(
      supabaseReturning(ok([]), ok([])),
      "project-1"
    );

    expect(empty.missions).toEqual([]);
    expect(empty.pending).toBe(false);
    expect(empty.unreadableReason).toBeNull();
  });
});
