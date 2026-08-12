import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ACCEPTING A TRANSCRIPTION — the shared half, and the boundary that makes the
 * whole feature transcription rather than authorship.
 *
 * `src/lib/rtp/extraction/acceptance.ts` is the ONE piece of code five RTP
 * write routes share when a figure copied out of an adopted plan is accepted.
 * Everything it must never do is asserted here, because the failures are all
 * silent ones:
 *
 *   - resolving a candidate from ANOTHER plan or another workspace (the figure
 *     would land in the wrong plan citing a page it never appeared on);
 *   - resolving one already accepted (the same revenue line recorded twice);
 *   - reading a VALUE out of the candidate (that is a machine writing a
 *     planning number with a human-shaped click in front of it);
 *   - marking a candidate accepted when the write did not land, or reporting a
 *     failed write because the marking did not land.
 *
 * MUTATION LOG — every assertion below was verified by breaking the code it
 * guards, running, and restoring. Recorded here because a test nobody has seen
 * fail is a test nobody knows the shape of.
 */
import {
  ACCEPTANCE_TARGET_KINDS,
  EXTRACTION_CANDIDATE_COLUMNS,
  FROM_EXTRACTION_CANDIDATE_FIELD,
  completeExtractionAcceptance,
  extractionProvenanceColumns,
  isOnlyExtractionProvenance,
  recordExtractionCandidateAccepted,
  resolveExtractionCandidate,
} from "@/lib/rtp/extraction/acceptance";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { stripSourceComments } from "./helpers/source-text";

const serviceRoleClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => serviceRoleClientMock(...args),
}));

const ROOT = process.cwd();
const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
const CYCLE_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CYCLE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const ROW_ID = "77777777-7777-4777-8777-777777777777";

const audit = { warn: vi.fn(), error: vi.fn() };

// ---------------------------------------------------------------------------
// A reader that FILTERS. A fake handing back its fixture whatever was asked
// cannot tell "the resolver scoped the query" from "the resolver asked for
// anything and got lucky" — which is how a cross-plan candidate would slip
// through a green suite.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let candidateRows: Row[] = [];
let readError: { message: string } | null = null;
let selectedColumns: string | null = null;
let recordedFilters: Array<{ column: string; value: unknown }> = [];
let queryCount = 0;

function makeReader() {
  return {
    from: (table: string) => {
      if (table !== "rtp_extraction_candidates") throw new Error(`Unexpected table: ${table}`);
      const filters: Array<{ column: string; value: unknown }> = [];
      const chain = {
        eq(column: string, value: string) {
          filters.push({ column, value });
          return chain;
        },
        async maybeSingle() {
          queryCount += 1;
          recordedFilters = [...filters];
          if (readError) return { data: null, error: readError };
          const matched = candidateRows.filter((row) =>
            filters.every((filter) => row[filter.column] === filter.value),
          );
          return { data: matched[0] ?? null, error: null };
        },
      };
      return {
        select(columns: string) {
          selectedColumns = columns;
          return chain;
        },
      };
    },
  };
}

function pendingCandidate(overrides: Row = {}): Row {
  return {
    id: CANDIDATE_ID,
    workspace_id: WORKSPACE_ID,
    rtp_cycle_id: CYCLE_ID,
    target_kind: "financial_line",
    status: "pending",
    quote_verified: true,
    ...overrides,
  };
}

/** `candidateId` is always passed explicitly — a default would make the "no id at all" case untestable. */
function resolve(candidateId: string | undefined) {
  return resolveExtractionCandidate({
    supabase: makeReader(),
    audit,
    candidateId,
    targetKind: "financial_line",
    rtpCycleId: CYCLE_ID,
    workspaceId: WORKSPACE_ID,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  candidateRows = [pendingCandidate()];
  readError = null;
  selectedColumns = null;
  recordedFilters = [];
  queryCount = 0;
});

describe("the target kinds a write route may accept", () => {
  /**
   * MUTATION: add "chapter_block" to ACCEPTANCE_TARGET_KINDS
   *   => "excludes chapter_block, and nothing else" fails:
   *      expected [ 'chapter_block' ] to deeply equal [].
   * MUTATION: drop "cycle_financial_basis" from ACCEPTANCE_TARGET_KINDS
   *   => "is a subset of the vocabulary the migration allows" still passes
   *      (a subset stays a subset) but "excludes chapter_block, and nothing
   *      else" fails: expected [ 'cycle_financial_basis', 'chapter_block' ]
   *      to deeply equal [ 'chapter_block' ]. Both directions are covered
   *      only because the second assertion is an equality, not a floor.
   */
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260811000008_rtp_extraction_staging.sql"),
    "utf8",
  );

  function schemaTargetKinds(): string[] {
    const match = migration.match(/target_kind TEXT NOT NULL CHECK \(target_kind IN \(([\s\S]*?)\)\)/);
    if (!match) throw new Error("could not find the target_kind CHECK in 20260811000008");
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
  }

  it("reads a non-empty vocabulary out of the migration (guard the guard)", () => {
    // Without this, a renamed constraint would make every assertion below
    // compare two empty lists and pass while proving nothing.
    expect(schemaTargetKinds().length).toBeGreaterThanOrEqual(6);
    expect(schemaTargetKinds()).toContain("chapter_block");
  });

  it("is a subset of the vocabulary the migration allows", () => {
    const allowed = new Set(schemaTargetKinds());
    const unknown = ACCEPTANCE_TARGET_KINDS.filter((kind) => !allowed.has(kind));
    expect(
      unknown,
      `${unknown.join(", ")} is accepted by a write route and is not a target_kind the staging table can hold.`,
    ).toEqual([]);
  });

  it("excludes chapter_block, and nothing else", () => {
    const missing = schemaTargetKinds().filter(
      (kind) => !(ACCEPTANCE_TARGET_KINDS as readonly string[]).includes(kind),
    );
    expect(
      missing,
      "chapter_block is the only kind a write route may not accept — transcribed chapter narrative lands in " +
        "document_narrative_drafts so a human accepts the draft before an adopted plan can quote itself. " +
        "A seventh kind must be argued into or out of this list deliberately, not defaulted into one.",
    ).toEqual(["chapter_block"]);
  });
});

describe("no assistant action is registered for any of this", () => {
  /**
   * The load-bearing property of the whole ingestion feature, restated where
   * this lane can see it: `refused-rtp-financial-actions-stay-refused.test.ts`
   * enumerates `Object.keys(ACTION_METADATA)` and nothing else, so it stays
   * green BY CONSTRUCTION as long as acceptance is an HTTP route a human calls.
   *
   * MUTATION: add a thirteenth entry to ACTION_METADATA named
   *   `accept_rtp_extraction_candidate`
   *   => "registers no action for extraction or acceptance" fails:
   *      expected [ 'accept_rtp_extraction_candidate' ] to deeply equal [],
   *      and "the registry is still exactly twelve kinds" fails: 13 !== 12.
   */
  it("registers no action for extraction or acceptance", () => {
    const offenders = Object.keys(ACTION_METADATA).filter(
      (kind) => kind.includes("extraction") || kind.includes("transcri") || kind.includes("candidate"),
    );
    expect(
      offenders,
      `${offenders.join(", ")} was registered. Acceptance is the human's half of this feature: an action that ` +
        "accepts a candidate hands a model the write the 2026-08-05 refusals took away from it.",
    ).toEqual([]);
  });

  it("the registry is still exactly twelve kinds", () => {
    expect(Object.keys(ACTION_METADATA)).toHaveLength(12);
  });
});

describe("nothing here scores its own certainty", () => {
  /**
   * A confidence score is the model grading itself, and a threshold over that
   * score is a machine authoring a planning number with extra steps. The
   * staging migration has no such column; this asserts the acceptance code
   * never invents one in TypeScript either.
   *
   * MUTATION: add `const CONFIDENCE_FLOOR = 0.8;` to acceptance.ts
   *   => fails: expected 'confidence' not to be found.
   */
  it("names no confidence, certainty or likelihood", () => {
    const source = readFileSync(path.join(ROOT, "src/lib/rtp/extraction/acceptance.ts"), "utf8");
    for (const banned of ["confidence", "certainty", "likelihood", "probability"]) {
      expect(source.toLowerCase(), `acceptance.ts names "${banned}"`).not.toContain(banned);
    }
  });
});

describe("every write route that accepts a transcription is wired the same way", () => {
  /**
   * The seam this catches: a route that declares the field and never resolves
   * it (the value lands with no provenance and the candidate stays pending
   * forever), or resolves it and never flips it (the review surface offers the
   * same figure again).
   *
   * MUTATION: delete the `completeExtractionAcceptance` call from the
   *   horizon-bands POST
   *   => "…horizon-bands/route.ts" fails: expected source to contain
   *      "completeExtractionAcceptance". The count assertions below then catch
   *      the subtler version, where one of two handlers keeps its call.
   */
  const ROUTES: Array<{ file: string; resolvers: number }> = [
    { file: "src/app/api/rtp-cycles/[rtpCycleId]/financial-assumptions/route.ts", resolvers: 2 },
    { file: "src/app/api/rtp-cycles/[rtpCycleId]/horizon-bands/route.ts", resolvers: 2 },
    { file: "src/app/api/rtp-cycles/[rtpCycleId]/performance-measures/route.ts", resolvers: 2 },
    { file: "src/app/api/projects/[projectId]/rtp-links/route.ts", resolvers: 2 },
    { file: "src/app/api/rtp-cycles/[rtpCycleId]/route.ts", resolvers: 1 },
  ];

  for (const route of ROUTES) {
    it(route.file, () => {
      // COMMENTS STRIPPED FIRST, in both directions. Every one of these route
      // headers explains this feature in prose, and prose reaching a matcher
      // has broken guards in this repository five separate times — here it
      // would let a route that merely DESCRIBES accepting a transcription pass
      // for one that does it.
      const source = stripSourceComments(readFileSync(path.join(ROOT, route.file), "utf8"));

      // The field is spelled the way the shared constant says, so a review
      // surface written against one route works against all of them.
      expect(source).toContain(FROM_EXTRACTION_CANDIDATE_FIELD);

      const resolverCalls = source.split("resolveExtractionCandidate({").length - 1;
      const flipCalls = source.split("completeExtractionAcceptance({").length - 1;

      expect(resolverCalls, "one resolver call per accepting handler").toBe(route.resolvers);
      expect(flipCalls, "every resolved candidate is flipped by the handler that used it").toBe(route.resolvers);
    });
  }

  it("writes the provenance column on the four tables that carry one, and not on rtp_cycles", () => {
    // 20260811000009 adds `extraction_candidate_id` to four tables and
    // deliberately not to `rtp_cycles`. A route calling
    // `extractionProvenanceColumns` against the cycle row would name a column
    // that does not exist and 400 every save.
    const withColumn = ROUTES.slice(0, 4).map((route) => route.file);
    for (const file of withColumn) {
      const source = stripSourceComments(readFileSync(path.join(ROOT, file), "utf8"));
      expect(source, `${file} does not write the provenance column`).toContain("extractionProvenanceColumns(");
    }
    const cycleRoute = stripSourceComments(
      readFileSync(path.join(ROOT, "src/app/api/rtp-cycles/[rtpCycleId]/route.ts"), "utf8"),
    );
    expect(cycleRoute).not.toContain("extractionProvenanceColumns");
    expect(cycleRoute).not.toContain("extraction_candidate_id");
  });
});

describe("resolveExtractionCandidate", () => {
  it("issues no query at all for a hand-typed write", async () => {
    const outcome = await resolve(undefined);
    expect(outcome).toEqual({ ok: true, candidate: null });
    expect(queryCount).toBe(0);
  });

  it("scopes the lookup by id, cycle AND workspace", async () => {
    /**
     * MUTATION: drop `.eq("rtp_cycle_id", rtpCycleId)` from the resolver
     *   => this test fails on the filter assertion AND "refuses a candidate
     *      staged against another plan cycle" fails: 200-shaped ok:true for a
     *      candidate belonging to the other plan.
     * MUTATION: drop `.eq("workspace_id", workspaceId)`
     *   => same two failures, with the other-workspace candidate.
     */
    await resolve(CANDIDATE_ID);
    expect(recordedFilters).toEqual([
      { column: "id", value: CANDIDATE_ID },
      { column: "rtp_cycle_id", value: CYCLE_ID },
      { column: "workspace_id", value: WORKSPACE_ID },
    ]);
  });

  it("never projects proposed_json — the resolver may not read a value the model wrote", () => {
    /**
     * MUTATION: add `, proposed_json` to EXTRACTION_CANDIDATE_COLUMNS
     *   => fails: expected 'id, workspace_id, …, proposed_json' not to
     *      contain 'proposed_json'.
     *
     * The reviewer's browser carries the proposed values into the request body
     * where a person can see them and the route's own zod can judge them.
     * Fetching them here would let a future edit copy them into the insert,
     * which is the one thing this whole design exists to make impossible.
     */
    expect(EXTRACTION_CANDIDATE_COLUMNS).not.toContain("proposed_json");
    expect(EXTRACTION_CANDIDATE_COLUMNS).toContain("target_kind");
    expect(EXTRACTION_CANDIDATE_COLUMNS).toContain("status");
    expect(EXTRACTION_CANDIDATE_COLUMNS).toContain("quote_verified");
  });

  it("selects exactly the columns it reads", async () => {
    await resolve(CANDIDATE_ID);
    expect(selectedColumns).toBe(EXTRACTION_CANDIDATE_COLUMNS);
  });

  it("accepts a pending candidate of the right kind in this plan", async () => {
    const outcome = await resolve(CANDIDATE_ID);
    expect(outcome).toEqual({ ok: true, candidate: { id: CANDIDATE_ID, targetKind: "financial_line" } });
  });

  it("refuses a candidate staged against another plan cycle", async () => {
    candidateRows = [pendingCandidate({ rtp_cycle_id: OTHER_CYCLE_ID })];
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(404);
    const body = await outcome.response.json();
    expect(body.error).toBe("That transcription is not part of this plan");
    expect(audit.warn).toHaveBeenCalledWith(
      "extraction_candidate_not_in_cycle",
      expect.objectContaining({ extractionCandidateId: CANDIDATE_ID }),
    );
  });

  it("refuses a candidate from another workspace with the SAME 404", async () => {
    // Same answer as "no such candidate", on purpose: a distinguishable status
    // would confirm the existence of another agency's documents to anyone
    // willing to guess ids.
    candidateRows = [pendingCandidate({ workspace_id: OTHER_WORKSPACE_ID })];
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(404);
  });

  it("refuses a candidate staged for a different part of the plan", async () => {
    candidateRows = [pendingCandidate({ target_kind: "performance_measure" })];
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(400);
    const body = await outcome.response.json();
    expect(body.error).toBe("That transcription belongs somewhere else in the plan");
    // The message names both sides in words a planner uses, not in schema keys.
    expect(body.details).toContain("a performance measure");
    expect(body.details).toContain("a revenue or cost line");
    expect(body.details).not.toContain("target_kind");
  });

  it("refuses a candidate that has already been reviewed", async () => {
    /**
     * MUTATION: delete the `candidate.status !== "pending"` branch
     *   => this fails (ok:true for an accepted candidate) and, in the route
     *      tests, an accepted candidate records a SECOND revenue line for the
     *      same page — the duplicate this branch exists to prevent.
     */
    candidateRows = [pendingCandidate({ status: "accepted" })];
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(409);
    const body = await outcome.response.json();
    expect(body.error).toBe("That transcription has already been reviewed");
    expect(body.details).toContain("twice");
  });

  it("refuses a candidate whose quote the verifier could not confirm", async () => {
    // Unreachable today — the verifier discards these before staging, and the
    // table CHECKs that accepted implies verified. Kept because the day
    // somebody stages the discards "so the planner can see them", this route
    // fails closed instead of becoming the door a machine writes through.
    candidateRows = [pendingCandidate({ quote_verified: false })];
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(400);
    const body = await outcome.response.json();
    expect(body.error).toBe("That passage could not be matched to the document");
  });

  it("a FAILED read is not an empty one", async () => {
    /**
     * MUTATION: delete the `classifyRouteReadFailure` block
     *   => fails: 404 for 500. The route would then tell a planner the
     *      transcription is not in their plan while it sits on the review
     *      screen they clicked accept from.
     */
    readError = { message: "connection terminated unexpectedly" };
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(500);
    expect(audit.error).toHaveBeenCalledWith(
      "extraction_candidate_lookup_failed",
      expect.objectContaining({ extractionCandidateId: CANDIDATE_ID }),
    );
  });

  it("names the migration when the staging tables are not there yet", async () => {
    readError = { message: 'relation "public.rtp_extraction_candidates" does not exist' };
    const outcome = await resolve(CANDIDATE_ID);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.response.status).toBe(503);
    const body = await outcome.response.json();
    expect(body.hint).toContain("20260811000008");
  });
});

describe("extractionProvenanceColumns", () => {
  it("adds NOTHING to a hand-typed write", () => {
    /**
     * MUTATION: return `{ extraction_candidate_id: null }` instead of `{}`
     *   => fails: expected { extraction_candidate_id: null } to deeply equal
     *      {}. The production consequence is the upgrade window: naming a
     *      column that migration 20260811000009 has not created yet is a
     *      PGRST204 on every hand-typed save.
     */
    expect(extractionProvenanceColumns(null)).toEqual({});
  });

  it("cites the candidate on a transcribed write", () => {
    expect(extractionProvenanceColumns({ id: CANDIDATE_ID, targetKind: "financial_line" })).toEqual({
      extraction_candidate_id: CANDIDATE_ID,
    });
  });
});

describe("isOnlyExtractionProvenance", () => {
  /**
   * MUTATION: make it always return false (provenance counts as an edit)
   *   => "a body naming only a transcription changes nothing" fails, and the
   *      route tests' "refuses a PATCH that carries only a candidate id" fail
   *      with 200 for 400.
   */
  it("a body naming only a transcription changes nothing", () => {
    expect(isOnlyExtractionProvenance({ bandId: "b", fromExtractionCandidateId: CANDIDATE_ID }, "bandId")).toBe(true);
  });

  it("a real edit alongside it is still an edit", () => {
    expect(
      isOnlyExtractionProvenance({ bandId: "b", label: "First ten years", fromExtractionCandidateId: CANDIDATE_ID }, "bandId"),
    ).toBe(false);
  });

  it("counts a deliberate null as an edit — clearing a field is a change", () => {
    expect(isOnlyExtractionProvenance({ measureId: "m", dataSource: null }, "measureId")).toBe(false);
  });

  it("works on a payload with no id field of its own", () => {
    expect(isOnlyExtractionProvenance({ fromExtractionCandidateId: CANDIDATE_ID })).toBe(true);
    expect(isOnlyExtractionProvenance({ financialBasisYear: 2026, fromExtractionCandidateId: CANDIDATE_ID })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The flip.
// ---------------------------------------------------------------------------

type FlipResult = { data: unknown; error: { message: string } | null };

let flipResult: FlipResult;
let flipUpdate: Record<string, unknown> | null = null;
let flipFilters: Array<{ column: string; value: unknown }> = [];

function installServiceRole(options: { throws?: boolean } = {}) {
  serviceRoleClientMock.mockImplementation(() => {
    if (options.throws) throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
    return {
      from: (table: string) => {
        if (table !== "rtp_extraction_candidates") throw new Error(`Unexpected table: ${table}`);
        const chain: Record<string, unknown> = {};
        chain.update = (values: Record<string, unknown>) => {
          flipUpdate = values;
          return chain;
        };
        chain.eq = (column: string, value: unknown) => {
          flipFilters.push({ column, value });
          return chain;
        };
        chain.select = () => chain;
        chain.maybeSingle = async () => flipResult;
        return chain;
      },
    };
  });
}

describe("recordExtractionCandidateAccepted", () => {
  beforeEach(() => {
    flipResult = { data: { id: CANDIDATE_ID }, error: null };
    flipUpdate = null;
    flipFilters = [];
    installServiceRole();
  });

  it("marks the candidate accepted and points it at the row it became", async () => {
    const outcome = await recordExtractionCandidateAccepted({
      audit,
      candidateId: CANDIDATE_ID,
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });

    expect(outcome).toEqual({ recorded: true });
    expect(flipUpdate).toMatchObject({
      status: "accepted",
      accepted_row_id: ROW_ID,
      reviewed_by: USER_ID,
    });
    // The table CHECKs that an accepted candidate has been reviewed at a time.
    expect(typeof flipUpdate?.reviewed_at).toBe("string");
  });

  it("only flips a candidate that is still pending", async () => {
    /**
     * MUTATION: drop `.eq("status", "pending")` from the update
     *   => this fails on the filter list, and the production consequence is
     *      two reviewers accepting the same passage: the second overwrites the
     *      first's accepted_row_id and orphans the first row's citation.
     */
    await recordExtractionCandidateAccepted({
      audit,
      candidateId: CANDIDATE_ID,
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });
    expect(flipFilters).toEqual([
      { column: "id", value: CANDIDATE_ID },
      { column: "status", value: "pending" },
    ]);
  });

  it("does not report a failure when the row landed and only the flip did not", async () => {
    /**
     * MUTATION: `return { recorded: false }` -> throw the error
     *   => the route tests fail with a 500 for a write that succeeded, which is
     *      how duplicate revenue lines get made: the planner retries.
     */
    flipResult = { data: null, error: { message: "permission denied for table rtp_extraction_candidates" } };
    const outcome = await recordExtractionCandidateAccepted({
      audit,
      candidateId: CANDIDATE_ID,
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });

    expect(outcome.recorded).toBe(false);
    if (outcome.recorded) throw new Error("unreachable");
    expect(outcome.warning).toContain("twice");
    expect(audit.error).toHaveBeenCalledWith(
      "extraction_candidate_not_marked_accepted",
      expect.objectContaining({ reason: "update_failed" }),
    );
  });

  it("treats zero matched rows as not recorded, not as recorded", async () => {
    flipResult = { data: null, error: null };
    const outcome = await recordExtractionCandidateAccepted({
      audit,
      candidateId: CANDIDATE_ID,
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });
    expect(outcome.recorded).toBe(false);
    expect(audit.error).toHaveBeenCalledWith(
      "extraction_candidate_not_marked_accepted",
      expect.objectContaining({ reason: "no_rows_matched" }),
    );
  });

  it("survives a deployment with no service-role key rather than 500ing a saved figure", async () => {
    installServiceRole({ throws: true });
    const outcome = await recordExtractionCandidateAccepted({
      audit,
      candidateId: CANDIDATE_ID,
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });
    expect(outcome.recorded).toBe(false);
    expect(audit.error).toHaveBeenCalledWith(
      "extraction_candidate_not_marked_accepted",
      expect.objectContaining({ reason: "unhandled_error" }),
    );
  });
});

describe("completeExtractionAcceptance", () => {
  beforeEach(() => {
    flipResult = { data: { id: CANDIDATE_ID }, error: null };
    flipUpdate = null;
    flipFilters = [];
    installServiceRole();
  });

  it("adds nothing to a hand-typed write's response", async () => {
    const outcome = await completeExtractionAcceptance({
      audit,
      candidate: null,
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });
    expect(outcome).toEqual({});
    expect(serviceRoleClientMock).not.toHaveBeenCalled();
  });

  it("reports the acceptance when it recorded", async () => {
    const outcome = await completeExtractionAcceptance({
      audit,
      candidate: { id: CANDIDATE_ID, targetKind: "financial_line" },
      acceptedRowId: ROW_ID,
      reviewedBy: USER_ID,
    });
    expect(outcome).toEqual({ extractionCandidate: { id: CANDIDATE_ID, recorded: true } });
  });

  it("refuses to invent a row id when the insert could not be read back", async () => {
    /**
     * The insert-not-readable-back case. Flipping the candidate to accepted
     * needs an `accepted_row_id` the table requires, and there is none. Writing
     * a placeholder would be provenance pointing at nothing.
     *
     * MUTATION: drop the `typeof acceptedRowId !== "string"` guard
     *   => the flip runs with accepted_row_id undefined, which the CHECK
     *      rejects in production and which this test catches as
     *      `recorded: true` where false is expected.
     */
    const outcome = await completeExtractionAcceptance({
      audit,
      candidate: { id: CANDIDATE_ID, targetKind: "financial_line" },
      acceptedRowId: undefined,
      reviewedBy: USER_ID,
    });
    expect(outcome.extractionCandidate?.recorded).toBe(false);
    expect(serviceRoleClientMock).not.toHaveBeenCalled();
    expect(audit.error).toHaveBeenCalledWith(
      "extraction_candidate_not_marked_accepted",
      expect.objectContaining({ reason: "accepted_row_id_missing" }),
    );
  });
});
