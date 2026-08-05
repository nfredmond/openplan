/**
 * Reading an RTP cycle's financial element.
 *
 * Extracted from the cycle page rather than left inline, for the reason
 * CLAUDE.md gives: a shared capability that lives inside one of its callers
 * gets reimplemented wrongly by the next one. The export route, the board
 * packet and the public draft-review page all need exactly these three reads
 * and exactly this mapping, and the mapping is where the traps are —
 * PostgREST returns NUMERIC as a string, and an absent cost must stay absent
 * rather than becoming zero.
 *
 * The raw results are returned alongside the mapped rows so the CALLER decides
 * how to disclose a failure. A loader that swallowed the error and returned an
 * empty array would let a page render "this plan has recorded no revenue" over
 * a read that failed — which is the same defect class as telling a planner
 * their portfolio is empty.
 */
import type {
  RtpFinancialLineInput,
  RtpFiscalEntryKind,
  RtpHorizonBandInput,
} from "./fiscal-constraint";

type QueryResult = { data: unknown; error: { message?: string | null } | null };

export interface RtpFinancialElementSupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        order(column: string, options: { ascending: boolean }): PromiseLike<QueryResult> & {
          order(column: string, options: { ascending: boolean }): PromiseLike<QueryResult>;
        };
      };
    };
  };
}

/** The projection every surface must select before rendering a band. */
export const RTP_HORIZON_BAND_COLUMNS =
  "id, label, start_year, end_year, escalation_target_year, cost_estimate_basis, sort_order";

/** The projection every surface must select before rendering the ledger. */
export const RTP_FINANCIAL_ASSUMPTION_COLUMNS =
  "id, horizon_band_id, entry_kind, source_name, amount, amount_basis_year, notes";

/** The projection every surface must select before rendering a measure. */
export const RTP_PERFORMANCE_MEASURE_COLUMNS =
  "id, measure_key, label, unit, baseline_value, baseline_year, target_value, target_year, data_source, notes, sort_order";

export interface RtpPerformanceMeasureView {
  id: string;
  measureKey: string;
  label: string;
  unit: string | null;
  /** Kept as returned. A baseline of 0 is a real measurement, not an absence. */
  baselineValue: number | string | null;
  baselineYear: number | null;
  targetValue: number | string | null;
  targetYear: number | null;
  dataSource: string | null;
  notes: string | null;
  sortOrder: number;
}

/**
 * The engine's line shape plus `notes`, which the engine has no use for and the
 * editor renders. Declared here rather than widening RtpFinancialLineInput so
 * the fiscal calculation's input stays exactly what it reads.
 */
export interface RtpFinancialElementLine extends RtpFinancialLineInput {
  notes: string | null;
}

export interface RtpFinancialElement {
  bands: RtpHorizonBandInput[];
  lines: RtpFinancialElementLine[];
  measures: RtpPerformanceMeasureView[];
  /** Raw results, so the caller can classify and disclose each failure itself. */
  results: { bands: QueryResult; lines: QueryResult; measures: QueryResult };
}

type BandRow = {
  id: string;
  label: string;
  start_year: number;
  end_year: number;
  escalation_target_year: number | null;
  cost_estimate_basis: string;
  sort_order: number;
};

type LineRow = {
  id: string;
  horizon_band_id: string;
  entry_kind: string;
  source_name: string;
  amount: number | string | null;
  amount_basis_year: number | null;
  notes: string | null;
};

type MeasureRow = {
  id: string;
  measure_key: string;
  label: string;
  unit: string | null;
  baseline_value: number | string | null;
  baseline_year: number | null;
  target_value: number | string | null;
  target_year: number | null;
  data_source: string | null;
  notes: string | null;
  sort_order: number;
};

export async function loadRtpFinancialElement(
  supabase: RtpFinancialElementSupabaseLike,
  rtpCycleId: string
): Promise<RtpFinancialElement> {
  const [bandsResult, linesResult, measuresResult] = await Promise.all([
    supabase
      .from("rtp_horizon_bands")
      .select(RTP_HORIZON_BAND_COLUMNS)
      .eq("rtp_cycle_id", rtpCycleId)
      .order("sort_order", { ascending: true })
      .order("start_year", { ascending: true }),
    supabase
      .from("rtp_financial_assumptions")
      .select(RTP_FINANCIAL_ASSUMPTION_COLUMNS)
      .eq("rtp_cycle_id", rtpCycleId)
      .order("created_at", { ascending: true }),
    supabase
      .from("rtp_performance_measures")
      .select(RTP_PERFORMANCE_MEASURE_COLUMNS)
      .eq("rtp_cycle_id", rtpCycleId)
      .order("sort_order", { ascending: true }),
  ]);

  const bands = ((bandsResult.data ?? []) as BandRow[]).map((band) => ({
    id: band.id,
    label: band.label,
    startYear: band.start_year,
    endYear: band.end_year,
    escalationTargetYear: band.escalation_target_year,
    // Anything the database does not recognise falls back to itemized rather
    // than being rendered raw to a planner.
    costEstimateBasis: band.cost_estimate_basis === "banded" ? ("banded" as const) : ("itemized" as const),
    sortOrder: band.sort_order,
  }));

  const lines = ((linesResult.data ?? []) as LineRow[]).map((line) => ({
    id: line.id,
    horizonBandId: line.horizon_band_id,
    entryKind: line.entry_kind as RtpFiscalEntryKind,
    sourceName: line.source_name,
    amount: line.amount,
    amountBasisYear: line.amount_basis_year,
    notes: line.notes,
  }));

  const measures = ((measuresResult.data ?? []) as MeasureRow[]).map((measure) => ({
    id: measure.id,
    measureKey: measure.measure_key,
    label: measure.label,
    unit: measure.unit,
    baselineValue: measure.baseline_value,
    baselineYear: measure.baseline_year,
    targetValue: measure.target_value,
    targetYear: measure.target_year,
    dataSource: measure.data_source,
    notes: measure.notes,
    sortOrder: measure.sort_order,
  }));

  return {
    bands,
    lines,
    measures,
    results: { bands: bandsResult, lines: linesResult, measures: measuresResult },
  };
}

export interface RtpHorizonBandOption {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
}

type BandsByCycleSupabaseLike = {
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: readonly string[]
      ): {
        order(column: string, options: { ascending: boolean }): PromiseLike<QueryResult>;
      };
    };
  };
};

/**
 * The periods declared by each of several cycles, keyed by cycle.
 *
 * The project page needs this: a project can sit in more than one plan, and the
 * period that pays for it is a property of the plan it is in, so the options
 * offered against one link must come from THAT link's cycle. Getting this wrong
 * would let a planner file a cost under a period belonging to a different plan.
 */
export async function loadRtpHorizonBandsByCycle(
  supabase: BandsByCycleSupabaseLike,
  rtpCycleIds: readonly string[]
): Promise<{ byCycleId: Map<string, RtpHorizonBandOption[]>; result: QueryResult }> {
  if (rtpCycleIds.length === 0) {
    return { byCycleId: new Map(), result: { data: [], error: null } };
  }

  const result = await supabase
    .from("rtp_horizon_bands")
    .select("id, rtp_cycle_id, label, start_year, end_year, sort_order")
    .in("rtp_cycle_id", rtpCycleIds)
    .order("sort_order", { ascending: true });

  const byCycleId = new Map<string, RtpHorizonBandOption[]>();
  for (const row of (result.data ?? []) as Array<{
    id: string;
    rtp_cycle_id: string;
    label: string;
    start_year: number;
    end_year: number;
  }>) {
    const list = byCycleId.get(row.rtp_cycle_id) ?? [];
    list.push({ id: row.id, label: row.label, startYear: row.start_year, endYear: row.end_year });
    byCycleId.set(row.rtp_cycle_id, list);
  }

  return { byCycleId, result };
}
