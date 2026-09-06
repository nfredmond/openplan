import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SAFETY_CRASH_EVIDENCE_COUNTS_RPC,
  SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION,
  buildSafetyCrashEvidenceMap,
  foldCrashEvidenceCounts,
  latestReadyIngestByProject,
  loadSafetyCrashEvidence,
  readSafetyCrashEvidenceIngest,
  totalCountedCrashes,
  totalCountedParties,
  type SafetyCrashEvidenceIngest,
  type SafetyCrashEvidenceSupabaseLike,
} from "@/lib/safety/crash-evidence";
import { CRASH_DIMENSION_COLUMNS, CRASH_PARTY_ROLES, CRASH_SEVERITIES } from "@/lib/safety/vocabulary";

/**
 * THE ONE RULE THIS FILE EXISTS FOR: a count that could not be read is not zero,
 * and a count nobody asked for is not zero either.
 *
 * On a safety screen a fabricated zero is uniquely dangerous, because it reads
 * as good news. "0 pedestrians hurt" from an acquisition that never fetched
 * person records is indistinguishable, on screen and in a grant appendix, from
 * an acquisition that fetched them and found none. Every assertion below pins
 * one of those two states apart from a real zero.
 *
 * The counting itself happens in Postgres (`safety_crash_evidence_counts`), so
 * the fake below records the RPC call and answers it. A fake that recorded
 * nothing would prove nothing about the arguments — the failure mode this
 * repository has already had with mocked Supabase clients.
 */

function ingest(over: Partial<SafetyCrashEvidenceIngest> = {}): SafetyCrashEvidenceIngest {
  return {
    id: "ingest-a",
    projectId: "project-1",
    status: "ready",
    sourceLabel: "Statewide crash reporting system",
    attribution: "Source agency (public domain).",
    severityCompleteness: "kabco_full",
    crashCount: 100,
    geocodedCount: 100,
    truncated: false,
    yearsRequested: [2024, 2025],
    createdAt: "2026-08-01T00:00:00.000Z",
    dimensionCoverage: {},
    partyCompleteness: "retrieved",
    partyCount: 190,
    involvementBasis: "party_rows",
    ...over,
  };
}

/** Rows shaped exactly as the RPC returns them: long, one per (ingest, dimension, value). */
function countRow(ingestId: string, dimension: string, value: string, count: number | string) {
  return { ingest_id: ingestId, dimension, value, record_count: count };
}

function fakeSupabase(
  answer: { data: unknown; error: unknown }
): SafetyCrashEvidenceSupabaseLike & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(answer);
    },
  };
}

describe("the grouped-count fold", () => {
  it("reads both dimensions and ignores a value outside the vocabulary", () => {
    const folded = foldCrashEvidenceCounts([
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "fatal", 3),
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "unknown", 7),
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.party_role, "pedestrian", 11),
      // A value no vocabulary member matches: dropped rather than written into a
      // band it does not belong to.
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "grazed", 99),
      countRow("ingest-a", "made_up_dimension", "fatal", 99),
    ]);

    const entry = folded.get("ingest-a")!;
    expect(entry.severity.fatal).toBe(3);
    expect(entry.severity.unknown).toBe(7);
    expect(entry.role.pedestrian).toBe(11);
    expect(entry.sawRole).toBe(true);
    // The two undeclared rows added nothing anywhere.
    expect(totalCountedCrashes(entry.severity)).toBe(10);
    expect(totalCountedParties(entry.role)).toBe(11);
  });

  it("reads a count that crossed the JSON boundary as a string", () => {
    // `count(*)` is a bigint. Some drivers hand it over as a string, and
    // `typeof x === "number"` alone would silently drop every row on those.
    const folded = foldCrashEvidenceCounts([
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "injury", "412"),
    ]);
    expect(folded.get("ingest-a")!.severity.injury).toBe(412);
  });

  it("keeps acquisitions apart", () => {
    const folded = foldCrashEvidenceCounts([
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "fatal", 3),
      countRow("ingest-b", CRASH_DIMENSION_COLUMNS.severity, "fatal", 40),
    ]);
    expect(folded.get("ingest-a")!.severity.fatal).toBe(3);
    expect(folded.get("ingest-b")!.severity.fatal).toBe(40);
  });
});

describe("a count that could not be read is not zero", () => {
  it.each(["fatal_only", "fatal_injury_only", "", "unknown"])("does not invent source coverage when completeness is %s", (severityCompleteness) => {
    const evidence = buildSafetyCrashEvidenceMap([ingest({ severityCompleteness })], null).get("ingest-a")!;
    const caveats = evidence.caveats.join(" ");
    expect(caveats).not.toMatch(/distinguishes fatal, injury, and property-damage-only/i);
    expect(caveats).toMatch(/serious injur.*cannot be derived/i);
    if (severityCompleteness === "fatal_only") {
      expect(caveats).toMatch(/records only crashes in which someone was killed/i);
    } else {
      expect(caveats).not.toMatch(/records only crashes in which someone was killed/i);
    }
  });

  it("yields null counts for every acquisition when the count read failed", () => {
    const evidence = buildSafetyCrashEvidenceMap([ingest()], null).get("ingest-a")!;
    expect(evidence.severityCounts).toBeNull();
    expect(evidence.roleCounts).toBeNull();
    expect(evidence.ksi).toBeNull();
    expect(evidence.unclassifiedCount).toBeNull();
  });

  it("yields real zeros for a band the acquisition genuinely has none of", () => {
    // `severity` is NOT NULL on `safety_crashes`, so every stored collision is
    // counted in exactly one band and a band the RPC did not mention truly holds
    // nothing. This is the case that MUST read as zero, or the distinction above
    // is meaningless.
    const folded = foldCrashEvidenceCounts([
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "injury", 100),
    ]);
    const evidence = buildSafetyCrashEvidenceMap([ingest()], folded).get("ingest-a")!;
    expect(evidence.severityCounts!.fatal).toBe(0);
    expect(evidence.severityCounts!.injury).toBe(100);
    expect(evidence.ksi).toBe(0);
  });
});

describe("a person nobody looked for is not a person who was not hurt", () => {
  it("reports NO role counts when person rows were not retrieved, even though the crash counts read fine", () => {
    // The mutation that motivates this: dropping the `partyCompleteness` check
    // in `buildSafetyCrashEvidenceMap` leaves the crash counts correct and turns
    // every role into 0, which renders as "no pedestrians were involved".
    const folded = foldCrashEvidenceCounts([
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "fatal", 3),
    ]);
    const evidence = buildSafetyCrashEvidenceMap(
      [ingest({ geocodedCount: 3, partyCompleteness: "not_retrieved", partyCount: null })],
      folded
    ).get("ingest-a")!;

    expect(evidence.severityCounts!.fatal).toBe(3);
    expect(evidence.roleCounts).toBeNull();
    expect(evidence.caveats.some((caveat) => /were not retrieved/i.test(caveat))).toBe(true);
  });

  it("says a source with no person-level detail cannot count people, in its own words", () => {
    const evidence = buildSafetyCrashEvidenceMap(
      [ingest({ partyCompleteness: "not_supported" })],
      foldCrashEvidenceCounts([])
    ).get("ingest-a")!;
    expect(evidence.roleCounts).toBeNull();
    expect(evidence.caveats.some((caveat) => /records no person-level detail/i.test(caveat))).toBe(
      true
    );
  });

  it("reports real zeros for a role when person rows WERE retrieved and held none", () => {
    const folded = foldCrashEvidenceCounts([
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.party_role, "driver", 190),
      countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "injury", 100),
    ]);
    const evidence = buildSafetyCrashEvidenceMap([ingest()], folded).get("ingest-a")!;
    expect(evidence.roleCounts!.driver).toBe(190);
    expect(evidence.roleCounts!.pedestrian).toBe(0);
  });

  it("warns when the involvement flags rest on crash-level columns rather than person rows", () => {
    const evidence = buildSafetyCrashEvidenceMap(
      [ingest({ geocodedCount: 0, partyCount: 0, involvementBasis: "crash_flags" })],
      foldCrashEvidenceCounts([])
    ).get("ingest-a")!;
    expect(evidence.caveats.some((caveat) => /crash-level flags/i.test(caveat))).toBe(true);
  });
});

describe("the loader", () => {
  it("asks the counts RPC once for every acquisition, by name and workspace", () => {
    const supabase = fakeSupabase({
      data: [countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, "fatal", 2)],
      error: null,
    });
    return loadSafetyCrashEvidence(supabase, "workspace-1", [ingest({ geocodedCount: 2 }), ingest({ id: "ingest-b", geocodedCount: 0 })]).then(
      (evidence) => {
        expect(supabase.calls).toHaveLength(1);
        expect(supabase.calls[0].name).toBe(SAFETY_CRASH_EVIDENCE_COUNTS_RPC);
        expect(supabase.calls[0].args).toEqual({
          p_workspace_id: "workspace-1",
          p_ingest_ids: ["ingest-a", "ingest-b"],
        });
        // Both acquisitions come back, including the one with no counted rows.
        expect(evidence.get("ingest-a")!.severityCounts!.fatal).toBe(2);
        expect(evidence.get("ingest-b")!.severityCounts!.fatal).toBe(0);
      }
    );
  });

  it("makes no call at all for an empty acquisition list", () => {
    const supabase = fakeSupabase({ data: [], error: null });
    return loadSafetyCrashEvidence(supabase, "workspace-1", []).then((evidence) => {
      expect(supabase.calls).toHaveLength(0);
      expect(evidence.size).toBe(0);
    });
  });

  it("turns an RPC error into null counts, never into zeros", () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    return loadSafetyCrashEvidence(supabase, "workspace-1", [ingest()]).then((evidence) => {
      expect(evidence.get("ingest-a")!.severityCounts).toBeNull();
    });
  });
});

describe("reading an ingest row", () => {
  it("defaults an absent party marker to 'not_supported' rather than assuming people were fetched", () => {
    // The optimistic reading prints a zero pedestrian count for an acquisition
    // that never looked. A row missing the column — a pending migration, a
    // hand-written projection — must degrade to the honest side.
    const read = readSafetyCrashEvidenceIngest({ id: "ingest-a", status: "ready" })!;
    expect(read.partyCompleteness).toBe("not_supported");
    expect(read.partyCount).toBeNull();
    expect(read.involvementBasis).toBeNull();
  });

  it("refuses a row with no usable id, rather than keying it on an empty string", () => {
    expect(readSafetyCrashEvidenceIngest({ status: "ready" })).toBeNull();
    expect(readSafetyCrashEvidenceIngest({ id: "", status: "ready" })).toBeNull();
  });
});

describe("choosing which acquisition to cite", () => {
  it("takes the NEWEST ready acquisition per project regardless of the order it was handed", () => {
    // The version this replaced trusted every caller to have written
    // `.order("created_at", { ascending: false })`. A caller who forgot got the
    // oldest retrieval, silently, with correct-looking numbers.
    const older = ingest({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = ingest({ id: "new", createdAt: "2026-08-01T00:00:00.000Z" });
    expect(latestReadyIngestByProject([older, newer]).get("project-1")?.id).toBe("new");
    expect(latestReadyIngestByProject([newer, older]).get("project-1")?.id).toBe("new");
  });

  it("skips an acquisition that has not finished", () => {
    const running = ingest({ id: "running", status: "running", createdAt: "2026-09-01T00:00:00.000Z" });
    const ready = ingest({ id: "ready", createdAt: "2026-08-01T00:00:00.000Z" });
    expect(latestReadyIngestByProject([running, ready]).get("project-1")?.id).toBe("ready");
  });
});

describe("the shape agrees with the database", () => {
  const migrations = path.join(process.cwd(), "supabase", "migrations");

  it("names an RPC the migration corpus actually defines", () => {
    // A typo here is a silent empty result, not an error: PostgREST answers a
    // missing function with an error object the loader turns into null counts,
    // which renders as "could not be read" forever.
    const sql = readFileSync(
      path.join(migrations, "20260812000003_safety_crash_severity_counts.sql"),
      "utf8"
    );
    expect(sql).toContain(`FUNCTION public.${SAFETY_CRASH_EVIDENCE_COUNTS_RPC}(`);
    // SECURITY INVOKER is the access control: the caller's RLS scopes every
    // counted row, and anon may never execute it over person records.
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC, anon;/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\banon\b/);
  });

  it("emits the two dimension names the RPC returns, spelled from the vocabulary", () => {
    const sql = readFileSync(
      path.join(migrations, "20260812000003_safety_crash_severity_counts.sql"),
      "utf8"
    );
    expect(sql).toContain(`'${CRASH_DIMENSION_COLUMNS.severity}'::text AS dimension`);
    expect(sql).toContain(`'${CRASH_DIMENSION_COLUMNS.party_role}'::text AS dimension`);
  });

  it("projects every ingest column the evidence shape reads", () => {
    // `.select()` strings are not type-checked in this codebase, so a column
    // dropped from the projection arrives as `undefined` and is read as an
    // honest-looking default. Each name below is one the reader depends on.
    for (const column of [
      "party_completeness",
      "dimension_coverage",
      "involvement_basis",
      "severity_completeness",
      "crash_count",
      "geocoded_count",
      "years_requested",
      "truncated",
      "project_id",
      "status",
    ]) {
      expect(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION).toContain(column);
    }
  });

  it("counts every band and role the vocabulary declares", () => {
    // The four-band hard-coded count this replaced could not see `unknown` when
    // it arrived, and nothing failed. A new member must show up in the fold's
    // output without anybody editing the fold.
    const folded = foldCrashEvidenceCounts([
      ...CRASH_SEVERITIES.map((band) => countRow("ingest-a", CRASH_DIMENSION_COLUMNS.severity, band, 1)),
      ...CRASH_PARTY_ROLES.map((role) => countRow("ingest-a", CRASH_DIMENSION_COLUMNS.party_role, role, 1)),
    ]);
    const entry = folded.get("ingest-a")!;
    expect(totalCountedCrashes(entry.severity)).toBe(CRASH_SEVERITIES.length);
    expect(totalCountedParties(entry.role)).toBe(CRASH_PARTY_ROLES.length);
  });
});
