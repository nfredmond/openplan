/**
 * READING PROVENANCE BACK — which figures in this plan were copied out of a
 * document, and from which page.
 *
 * WHY THIS READS THE CANDIDATE AND NOT THE ROW. 20260811000009 puts an
 * `extraction_candidate_id` on each of the four RTP tables, and 20260811000008
 * puts an `accepted_row_id` on the candidate: the same thread, tied at both
 * ends. This loader pulls on the CANDIDATE end, for two reasons that are worth
 * writing down because the other choice looks simpler.
 *
 *   1. It adds no column to the three shared projections in
 *      `financial-element-queries.ts`. Those strings are read by the cycle
 *      page, the public plan document, the export, the board packet and the
 *      assistant context; naming a column there that a deployment has not
 *      migrated yet turns EVERY one of those reads into a PGRST204 and takes
 *      the whole financial element down across the deploy window. A separate
 *      read fails on its own, and its only consequence is that the citations
 *      are missing — which the caller discloses.
 *   2. It is one query per surface instead of a join per table, and it reaches
 *      `rtp_cycles` too — the plan's dollar year carries no provenance column
 *      at all (20260811000009's header: a cycle is not a transcribed artifact),
 *      so the candidate is the only end that answers for it.
 *
 * THE FAILURE POSTURE. A failed read returns NO records and hands the raw
 * result back, exactly like `loadRtpFinancialElement`. It never returns an
 * empty map as though the answer were "nothing here was transcribed" — on a
 * public plan page that would silently delete a disclosure the agency made, and
 * a missing citation is indistinguishable from a figure somebody typed. The
 * caller says the citations could not be loaded.
 */

import { transcriptionDivergence, type RtpCycleRecordedState } from "./reconcile";
import type { TranscriptionRecord } from "./display";

type QueryResult = { data: unknown; error: { message?: string | null } | null };

export interface RtpTranscriptionSupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        eq(column: string, value: string): PromiseLike<QueryResult>;
      };
      in(column: string, values: readonly string[]): PromiseLike<QueryResult>;
    };
  };
}

/**
 * The projection, named so a test can assert on the string itself. A mocked
 * Supabase client hands back its fixture for whatever was asked, so a dropped
 * column is invisible until production (CLAUDE.md).
 */
export const TRANSCRIPTION_CANDIDATE_COLUMNS =
  "id, run_id, target_kind, proposed_json, source_page, source_quote, accepted_row_id, status";

export const TRANSCRIPTION_RUN_COLUMNS = "id, kb_document_id, kb_documents(id, title)";

type CandidateRow = {
  id: string;
  run_id: string | null;
  target_kind: string;
  proposed_json: unknown;
  source_page: number | null;
  source_quote: string | null;
  accepted_row_id: string | null;
  status: string;
};

type RunRow = {
  id: string;
  kb_document_id: string | null;
  kb_documents: { id: string; title: string | null } | Array<{ id: string; title: string | null }> | null;
};

/** One accepted transcription, before it is compared against the row it became. */
export type LoadedTranscription = {
  candidateId: string;
  targetKind: string;
  proposedJson: unknown;
  acceptedRowId: string;
  page: number;
  quote: string;
  kbDocumentId: string | null;
  documentTitle: string | null;
};

export type RtpTranscriptionProvenance = {
  transcriptions: LoadedTranscription[];
  /** Raw results, so the caller classifies and discloses each failure itself. */
  results: { candidates: QueryResult; runs: QueryResult };
};

function normalizeDocument(value: RunRow["kb_documents"]): { id: string; title: string | null } | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Every accepted transcription in one plan cycle, keyed later by the row it
 * became.
 *
 * A candidate with no `accepted_row_id`, no page or no quote is DROPPED rather
 * than rendered: the whole point of a chip is that it names a page and quotes
 * the words, and a chip that could not would be a claim of provenance with no
 * provenance behind it.
 */
export async function loadRtpTranscriptionProvenance(
  supabase: RtpTranscriptionSupabaseLike,
  rtpCycleId: string
): Promise<RtpTranscriptionProvenance> {
  const candidatesResult = await supabase
    .from("rtp_extraction_candidates")
    .select(TRANSCRIPTION_CANDIDATE_COLUMNS)
    .eq("rtp_cycle_id", rtpCycleId)
    .eq("status", "accepted");

  const emptyRuns: QueryResult = { data: [], error: null };
  if (candidatesResult.error) {
    return { transcriptions: [], results: { candidates: candidatesResult, runs: emptyRuns } };
  }

  const candidates = ((candidatesResult.data ?? []) as CandidateRow[]).filter(
    (candidate) =>
      typeof candidate.accepted_row_id === "string" &&
      typeof candidate.source_page === "number" &&
      typeof candidate.source_quote === "string" &&
      candidate.source_quote.trim() !== ""
  );

  const runIds = Array.from(
    new Set(candidates.map((candidate) => candidate.run_id).filter((id): id is string => Boolean(id)))
  );

  if (runIds.length === 0) {
    return { transcriptions: [], results: { candidates: candidatesResult, runs: emptyRuns } };
  }

  const runsResult = await supabase
    .from("rtp_extraction_runs")
    .select(TRANSCRIPTION_RUN_COLUMNS)
    .in("id", runIds);

  if (runsResult.error) {
    return { transcriptions: [], results: { candidates: candidatesResult, runs: runsResult } };
  }

  const documentByRunId = new Map<string, { id: string | null; title: string | null }>();
  for (const run of (runsResult.data ?? []) as unknown as RunRow[]) {
    const document = normalizeDocument(run.kb_documents);
    documentByRunId.set(run.id, {
      id: document?.id ?? run.kb_document_id ?? null,
      title: document?.title ?? null,
    });
  }

  const transcriptions = candidates.map((candidate) => {
    const document = candidate.run_id ? documentByRunId.get(candidate.run_id) : undefined;
    return {
      candidateId: candidate.id,
      targetKind: candidate.target_kind,
      proposedJson: candidate.proposed_json,
      acceptedRowId: candidate.accepted_row_id as string,
      page: candidate.source_page as number,
      quote: candidate.source_quote as string,
      kbDocumentId: document?.id ?? null,
      documentTitle: document?.title ?? null,
    };
  });

  return { transcriptions, results: { candidates: candidatesResult, runs: runsResult } };
}

/**
 * The map every rendering surface uses: row id → the citation that row carries.
 *
 * PURE, and it is where the edited-after-acceptance check happens. The recorded
 * state is compared against what the document said, field by field, through the
 * one comparison engine in `reconcile.ts` — so a figure a planner corrected
 * after accepting shows a chip that says the agency changed it, rather than a
 * chip that goes on citing a page for a number that page does not contain.
 *
 * A row with no entry in this map was TYPED BY HAND and gets no chip at all.
 * That is the truth and it is a permanent one: there is no backfill anywhere in
 * this feature, because guessing which historical figures probably came from a
 * document would be inventing provenance.
 */
export function indexTranscriptions(
  transcriptions: readonly LoadedTranscription[],
  state: RtpCycleRecordedState
): Map<string, TranscriptionRecord> {
  const index = new Map<string, TranscriptionRecord>();

  for (const transcription of transcriptions) {
    index.set(transcription.acceptedRowId, {
      candidateId: transcription.candidateId,
      kbDocumentId: transcription.kbDocumentId,
      documentTitle: transcription.documentTitle,
      page: transcription.page,
      quote: transcription.quote,
      divergentFields: transcriptionDivergence(
        { targetKind: transcription.targetKind, proposedJson: transcription.proposedJson },
        state,
        transcription.acceptedRowId
      ),
    });
  }

  return index;
}
