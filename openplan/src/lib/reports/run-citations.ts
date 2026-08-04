/**
 * Typed report-run citation resolution (report_runs.model_run_id /
 * county_run_id), shared by the report detail and project workbench pages.
 *
 * Every read tolerates a database without the typed-evidence migration: the
 * widened select is retried with the legacy column set on a missing-column
 * error, so legacy Analysis Studio citations keep rendering unchanged.
 *
 * The Supabase client is typed loosely and query results are cast, matching
 * the repo convention (see src/lib/reports/api.ts).
 *
 * A CITED RUN TRAVELS WITH ITS ENGINE, STATUS AND CLAIM TIER — in the report
 * lane too. The RTP lane settled this (see src/lib/rtp/modeling-evidence.ts:
 * DISCLOSE, NEVER RESTRICT) and the public plan page has rendered
 * `formatRtpEvidenceRunDisclosureLine` beside every citation since. The report
 * lane cited the same `model_runs` rows with engine + status only, so the same
 * run described itself with a claim tier on the public plan page and without one
 * in the packet an agency hands a funder. `resolveCitedRuns` now calls the SAME
 * shared loader rather than growing a second, weaker disclosure here.
 *
 * A FAILED READ MAY NOT BE RENDERED AS AN ANSWER. `resolveCitedRuns` used to
 * answer `[]` on a query error, and `buildTypedRunCitations` dropped every link
 * whose row was missing — so a broken `model_runs` read silently deleted
 * citations from a report's own list of what it cited. Missing rows now surface
 * as UNRESOLVED citations that state which of the three different facts is true:
 * the read failed, the modeling tables are absent from this deployment, or the
 * row is genuinely no longer readable.
 */

import type { ModelingClaimStatus } from "@/lib/models/evidence-backbone";
import { titleize } from "@/lib/reports/catalog";
import {
  formatRtpEvidenceRunDisclosureLine,
  loadRtpEvidenceRunDisclosures,
  rtpEvidenceRunWarnings,
  type RtpEvidenceRunDisclosure,
  type RtpEvidenceSupabaseLike,
} from "@/lib/rtp/modeling-evidence";

type QueryError = { message: string; code?: string | null } | null;

type SupabaseLike = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
  };
};

export type ReportRunCitationLink = {
  id: string;
  report_id?: string;
  run_id: string | null;
  model_run_id?: string | null;
  county_run_id?: string | null;
  sort_order?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CitedModelRunRow = {
  id: string;
  run_title: string;
  engine_key: string;
  status: string;
  created_at?: string | null;
};

export type CitedCountyRunRow = {
  id: string;
  run_name: string | null;
  stage: string | null;
  updated_at?: string | null;
};

/**
 * A cited model run with the claim tier the report lane must disclose beside it.
 * Kept separate from `CitedModelRunRow` (the raw `model_runs` projection) so a
 * row that was merely SELECTED can never be mistaken for one whose tier was
 * resolved.
 */
export type ResolvedCitedModelRun = CitedModelRunRow & {
  /** Strongest recorded tier in `modeling_claim_decisions`, or null if none is recorded. */
  claimStatus: ModelingClaimStatus | null;
  /** True when the claim-decision read FAILED — a different fact from "no tier recorded". */
  claimReadFailed: boolean;
};

/**
 * Why a cited link has no resolved run row. These are four different facts and
 * the citation says which one is true; `"unknown"` is what a caller that did not
 * pass the resolution result gets, and it deliberately claims the least.
 */
export type CitedRunUnresolvedReason = "read-failed" | "module-unavailable" | "not-found" | "unknown";

/** A resolved typed report citation for display: kind label + honest status. */
export type TypedRunCitation = {
  /** report_runs row id (stable list key). */
  id: string;
  kind: "model" | "county";
  runId: string;
  title: string;
  engineKey: string | null;
  /** Model-run status, or the county run's stage. */
  status: string | null;
  /** Recorded claim tier for a model-run citation. Null for county runs (their tier lives on the county-run evidence snapshot) and for unresolved rows. */
  claimStatus: ModelingClaimStatus | null;
  /** True when the claim-tier read failed — distinct from "no tier recorded". */
  claimReadFailed: boolean;
  /**
   * The one line a reader needs before trusting a cited run's numbers. For model
   * runs this is the SHARED `formatRtpEvidenceRunDisclosureLine` — the same
   * sentence the public plan page renders, so one run cannot describe itself two
   * ways depending on which surface is open.
   */
  disclosureLine: string;
  /** Non-blocking reader caveats (engine caveat, non-succeeded status). Never a reason to refuse the citation. */
  warnings: string[];
  /** Null when the cited row resolved; otherwise which fact is true about it. */
  unresolved: CitedRunUnresolvedReason | null;
};

export function looksLikePendingReportRunsSchema(message: string | null | undefined): boolean {
  return /column .* does not exist|relation .* does not exist|could not find the table|schema cache/i.test(
    message ?? ""
  );
}

/** Load one report's citation links, widened select first, legacy fallback. */
export async function loadReportRunCitationLinks(
  supabase: SupabaseLike,
  reportId: string
): Promise<{ links: ReportRunCitationLink[]; error: QueryError }> {
  const widened = (await supabase
    .from("report_runs")
    .select("id, run_id, model_run_id, county_run_id, sort_order")
    .eq("report_id", reportId)
    .order("sort_order", { ascending: true })) as { data: unknown; error: QueryError };

  if (!widened.error) {
    return { links: ((widened.data ?? []) as ReportRunCitationLink[]), error: null };
  }

  if (!looksLikePendingReportRunsSchema(widened.error.message)) {
    return { links: [], error: widened.error };
  }

  const legacy = (await supabase
    .from("report_runs")
    .select("id, run_id, sort_order")
    .eq("report_id", reportId)
    .order("sort_order", { ascending: true })) as { data: unknown; error: QueryError };

  return {
    links: ((legacy.data ?? []) as Array<Omit<ReportRunCitationLink, "model_run_id" | "county_run_id">>).map(
      (row) => ({ ...row, model_run_id: null, county_run_id: null })
    ),
    error: legacy.error,
  };
}

/** Load many reports' citation links (project workbench), same fallback. */
export async function loadReportRunCitationLinksForReports(
  supabase: SupabaseLike,
  reportIds: string[]
): Promise<{ links: ReportRunCitationLink[]; error: QueryError }> {
  if (reportIds.length === 0) {
    return { links: [], error: null };
  }

  const widened = (await supabase
    .from("report_runs")
    .select("report_id, run_id, model_run_id, county_run_id, created_at, updated_at")
    .in("report_id", reportIds)) as { data: unknown; error: QueryError };

  if (!widened.error) {
    return { links: ((widened.data ?? []) as ReportRunCitationLink[]), error: null };
  }

  if (!looksLikePendingReportRunsSchema(widened.error.message)) {
    return { links: [], error: widened.error };
  }

  const legacy = (await supabase
    .from("report_runs")
    .select("report_id, run_id, created_at, updated_at")
    .in("report_id", reportIds)) as { data: unknown; error: QueryError };

  return {
    links: ((legacy.data ?? []) as Array<Omit<ReportRunCitationLink, "model_run_id" | "county_run_id">>).map(
      (row) => ({ ...row, model_run_id: null, county_run_id: null })
    ),
    error: legacy.error,
  };
}

/**
 * What one call to `resolveCitedRuns` established. The three failure facts are
 * kept apart on purpose: "the modeling tables are not in this deployment",
 * "the read failed" and "the row is not there" license three different
 * sentences, and collapsing them is how a broken query starts answering
 * questions about the world.
 */
export type CitedRunResolution = {
  citedModelRuns: ResolvedCitedModelRun[];
  citedCountyRuns: CitedCountyRunRow[];
  /** A genuine `model_runs` read failure (NOT the pending-schema tolerance). */
  modelRunsUnreadable: boolean;
  /** `model_runs` is not present in this deployment yet (pending schema). */
  modelRunsUnavailable: boolean;
  countyRunsUnreadable: boolean;
  countyRunsUnavailable: boolean;
  /** True when the `modeling_claim_decisions` read failed for this batch. */
  claimReadFailed: boolean;
  /** Engine + status + claim tier for a cited model run, from the shared RTP loader. */
  disclosureFor: (runId: string) => RtpEvidenceRunDisclosure;
};

/**
 * Batch-resolve the model/county runs behind typed citation links, WITH the
 * claim tier each model-run citation must travel with.
 *
 * Tolerates a database without those modules (pending schema answers empty and
 * says so), and reports a genuine read failure as a failure instead of as an
 * empty list — the caller needs to know which one happened, because only one of
 * them means "there is nothing there".
 */
export async function resolveCitedRuns(
  supabase: SupabaseLike,
  links: ReportRunCitationLink[]
): Promise<CitedRunResolution> {
  const modelRunIds = Array.from(
    new Set(links.map((link) => link.model_run_id ?? null).filter((value): value is string => Boolean(value)))
  );
  const countyRunIds = Array.from(
    new Set(links.map((link) => link.county_run_id ?? null).filter((value): value is string => Boolean(value)))
  );

  const [modelRunsResult, countyRunsResult] = (await Promise.all([
    modelRunIds.length
      ? supabase.from("model_runs").select("id, run_title, engine_key, status, created_at").in("id", modelRunIds)
      : Promise.resolve({ data: [], error: null }),
    countyRunIds.length
      ? supabase.from("county_runs").select("id, run_name, stage, updated_at").in("id", countyRunIds)
      : Promise.resolve({ data: [], error: null }),
  ])) as Array<{ data: unknown; error: QueryError }>;

  const modelRunsUnavailable = Boolean(
    modelRunsResult.error && looksLikePendingReportRunsSchema(modelRunsResult.error.message)
  );
  const modelRunsUnreadable = Boolean(modelRunsResult.error) && !modelRunsUnavailable;
  const countyRunsUnavailable = Boolean(
    countyRunsResult.error && looksLikePendingReportRunsSchema(countyRunsResult.error.message)
  );
  const countyRunsUnreadable = Boolean(countyRunsResult.error) && !countyRunsUnavailable;

  const modelRunRows = modelRunsResult.error ? [] : ((modelRunsResult.data ?? []) as CitedModelRunRow[]);

  // The claim tier comes from the SAME loader the public plan page uses. It is
  // handed the rows we already have as `knownRuns`, so the common path costs one
  // `modeling_claim_decisions` read and no second `model_runs` read. When our own
  // model_runs read failed, knownRuns is empty and the shared loader re-reads and
  // re-fails — that repeated failure is precisely how it learns `runReadFailed`,
  // and one extra failing query on an already-failing request is a fair price for
  // having exactly one definition of "what a reader must be told about a run".
  const evidence = await loadRtpEvidenceRunDisclosures(
    supabase as unknown as RtpEvidenceSupabaseLike,
    modelRunIds,
    {
      knownRuns: modelRunRows.map((run) => ({
        id: run.id,
        run_title: run.run_title,
        engine_key: run.engine_key,
        status: run.status,
      })),
    }
  );

  return {
    citedModelRuns: modelRunRows.map((run) => ({
      ...run,
      claimStatus: evidence.claimTierFor(run.id),
      claimReadFailed: evidence.claimReadFailed,
    })),
    citedCountyRuns: countyRunsResult.error ? [] : ((countyRunsResult.data ?? []) as CitedCountyRunRow[]),
    modelRunsUnreadable,
    modelRunsUnavailable,
    countyRunsUnreadable,
    countyRunsUnavailable,
    claimReadFailed: evidence.claimReadFailed,
    disclosureFor: evidence.disclosureFor,
  };
}

/** What a citation says when its row is not there, per reason. Never "no runs". */
const UNRESOLVED_CITATION_COPY: Record<CitedRunUnresolvedReason, { title: string; line: string }> = {
  "read-failed": {
    title: "Cited run — could not be read",
    line: "This citation's run could not be read. That is a lookup failure, not evidence that the run is gone; the citation is kept so readers can see exactly what was cited.",
  },
  "module-unavailable": {
    title: "Cited run — not resolvable in this deployment",
    line: "This deployment does not expose the modeling tables this citation points at, so its engine, status and claim tier cannot be shown here. The citation is kept rather than dropped.",
  },
  "not-found": {
    title: "Cited run — no longer readable",
    line: "The cited run is no longer readable in this workspace: it may have been deleted, or access to it may have changed. The citation is kept so readers can see exactly what was cited.",
  },
  unknown: {
    title: "Cited run — could not be resolved",
    line: "This citation's run could not be resolved. Whether it was deleted or the lookup failed is not established here; the citation is kept so readers can see exactly what was cited.",
  },
};

/** Which of the four facts explains a missing row, given what the resolution knows. */
function unresolvedReason(
  resolution: CitedRunResolution | undefined,
  kind: "model" | "county"
): CitedRunUnresolvedReason {
  if (!resolution) return "unknown";
  const unreadable = kind === "model" ? resolution.modelRunsUnreadable : resolution.countyRunsUnreadable;
  if (unreadable) return "read-failed";
  const unavailable = kind === "model" ? resolution.modelRunsUnavailable : resolution.countyRunsUnavailable;
  if (unavailable) return "module-unavailable";
  return "not-found";
}

function unresolvedCitation(
  link: ReportRunCitationLink,
  kind: "model" | "county",
  runId: string,
  reason: CitedRunUnresolvedReason
): TypedRunCitation {
  const copy = UNRESOLVED_CITATION_COPY[reason];
  return {
    id: link.id,
    kind,
    runId,
    title: copy.title,
    engineKey: null,
    status: null,
    claimStatus: null,
    // A run we could not read carries no claim-tier answer either. Saying the
    // tier "could not be read" here would be a claim about a query we never ran.
    claimReadFailed: false,
    disclosureLine: copy.line,
    warnings: [],
    unresolved: reason,
  };
}

/**
 * Map citation links + resolved runs onto display citations, in link order.
 *
 * EVERY typed link produces a citation. A link whose row did not resolve becomes
 * an UNRESOLVED citation naming why, because a report's list of what it cited is
 * the one place a silent omission is indistinguishable from "nothing was cited".
 *
 * `resolution` is what `resolveCitedRuns` returned. Omitting it is supported and
 * safe — the citations then say only that the run "could not be resolved", which
 * is true in all three cases — but passing it lets each citation state the one
 * fact that actually applies.
 */
export function buildTypedRunCitations(
  links: ReportRunCitationLink[],
  citedModelRuns: ResolvedCitedModelRun[],
  citedCountyRuns: CitedCountyRunRow[],
  resolution?: CitedRunResolution
): TypedRunCitation[] {
  const modelRunById = new Map(citedModelRuns.map((run) => [run.id, run]));
  const countyRunById = new Map(citedCountyRuns.map((run) => [run.id, run]));

  return links
    .map((link): TypedRunCitation | null => {
      if (link.model_run_id) {
        const modelRun = modelRunById.get(link.model_run_id);
        if (!modelRun) {
          return unresolvedCitation(link, "model", link.model_run_id, unresolvedReason(resolution, "model"));
        }
        // One definition of what a reader must be told about a cited run: the
        // shared RTP disclosure, so the packet and the public plan page cannot
        // describe the same run differently.
        const disclosure: RtpEvidenceRunDisclosure = {
          engineKey: modelRun.engine_key,
          status: modelRun.status,
          claimStatus: modelRun.claimStatus,
          claimReadFailed: modelRun.claimReadFailed,
          runReadFailed: false,
        };
        return {
          id: link.id,
          kind: "model" as const,
          runId: modelRun.id,
          title: modelRun.run_title,
          engineKey: modelRun.engine_key,
          status: modelRun.status,
          claimStatus: modelRun.claimStatus,
          claimReadFailed: modelRun.claimReadFailed,
          disclosureLine: formatRtpEvidenceRunDisclosureLine(disclosure),
          warnings: rtpEvidenceRunWarnings(disclosure),
          unresolved: null,
        };
      }

      if (link.county_run_id) {
        const countyRun = countyRunById.get(link.county_run_id);
        if (!countyRun) {
          return unresolvedCitation(link, "county", link.county_run_id, unresolvedReason(resolution, "county"));
        }
        return {
          id: link.id,
          kind: "county" as const,
          runId: countyRun.id,
          title: countyRun.run_name ?? "County run",
          engineKey: null,
          status: countyRun.stage,
          // A county run's claim tier lives on its modeling-evidence snapshot,
          // not on modeling_claim_decisions, and is disclosed by the packet's
          // modeling-evidence section. Null here is "not carried by this
          // citation", and the disclosure line says so rather than implying none.
          claimStatus: null,
          claimReadFailed: false,
          disclosureLine: `County validation run · ${
            countyRun.stage ? titleize(countyRun.stage) : "Stage not recorded"
          } · Claim tier is recorded on this run's modeling-evidence snapshot`,
          warnings: [],
          unresolved: null,
        };
      }

      return null;
    })
    .filter((item): item is TypedRunCitation => Boolean(item));
}

/**
 * Attach each cited model run's recorded claim tier, for the GENERATED PACKET.
 *
 * The packet is the artifact an agency hands a funder, so it is the surface
 * where an undisclosed claim tier costs the most — but the generate route
 * assembles `citedModelRuns` from its own `model_runs` projection (it needs
 * `result_summary_json`, which the page-side resolver does not select), so it
 * cannot simply reuse `resolveCitedRuns`. This keeps the tier lookup in ONE
 * place anyway: the route wraps its own rows in a single call and the packet
 * renders the same tier the report page shows.
 *
 * Best-effort by design: a failed claim read marks every row `claimReadFailed`
 * so the packet says the tier COULD NOT BE READ rather than that none exists.
 */
export async function withCitedModelRunClaimTiers<
  T extends { id: string; run_title: string; engine_key: string; status: string },
>(
  supabase: SupabaseLike,
  citedModelRuns: T[]
): Promise<Array<T & { claimStatus: ModelingClaimStatus | null; claimReadFailed: boolean }>> {
  if (citedModelRuns.length === 0) return [];

  const evidence = await loadRtpEvidenceRunDisclosures(
    supabase as unknown as RtpEvidenceSupabaseLike,
    citedModelRuns.map((run) => run.id),
    {
      knownRuns: citedModelRuns.map((run) => ({
        id: run.id,
        run_title: run.run_title,
        engine_key: run.engine_key,
        status: run.status,
      })),
    }
  );

  return citedModelRuns.map((run) => ({
    ...run,
    claimStatus: evidence.claimTierFor(run.id),
    claimReadFailed: evidence.claimReadFailed,
  }));
}

/** The succeeded model runs a report's attach control may cite: the target
 * project's runs first, workspace-scoped runs as the fallback (mirrors the
 * project workbench's availableModelRuns). Empty on any lookup failure. */
export async function loadCiteableModelRuns(
  supabase: SupabaseLike,
  { projectId, workspaceId }: { projectId: string; workspaceId: string }
): Promise<Array<{ id: string; title: string; engineKey: string; status: string }>> {
  const projectResult = (await supabase
    .from("model_runs")
    .select("id, run_title, engine_key, status")
    .eq("project_id", projectId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(50)) as { data: unknown; error: QueryError };

  let rows = projectResult.error ? [] : ((projectResult.data ?? []) as CitedModelRunRow[]);
  if (rows.length === 0) {
    const workspaceResult = (await supabase
      .from("model_runs")
      .select("id, run_title, engine_key, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(50)) as { data: unknown; error: QueryError };
    rows = workspaceResult.error ? [] : ((workspaceResult.data ?? []) as CitedModelRunRow[]);
  }

  return rows.map((run) => ({ id: run.id, title: run.run_title, engineKey: run.engine_key, status: run.status }));
}
