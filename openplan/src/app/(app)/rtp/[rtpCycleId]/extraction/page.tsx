/**
 * THE REVIEW SCREEN — everything a machine copied out of a plan document, each
 * proposal beside the page and the words it came from, waiting for a person.
 *
 * This is the human half of the transcription lane, and it is the half that
 * makes the other half legitimate. Nothing here writes: acceptance runs the
 * plan's own write routes from the card, and the only write this screen owns is
 * setting a passage aside.
 *
 * WHAT THIS PAGE IS CAREFUL ABOUT:
 *
 * 1. IT SAYS WHAT WAS DROPPED. Each reading states "41 proposed; 6 dropped
 *    because their figures were not in the text they cited" rather than showing
 *    35 and looking clean. A discard is the verifier working, and a review
 *    screen that hid them would be reporting a better reading than happened.
 *
 * 2. IT COMPARES AGAINST THE PLAN, IN CODE. The extraction run is blind to
 *    OpenPlan's own rows on purpose — a model shown the ledger can copy it back
 *    and hand it in wearing a page citation. The novelty judgement is made here
 *    instead, deterministically (`lib/rtp/extraction/reconcile.ts`), and the
 *    conflict case is the highest-value moment in the whole feature: the figure
 *    this plan records and the figure the adopted document prints, side by
 *    side, with the page and the sentence under them.
 *
 * 3. A FAILED READ IS NOT AN EMPTY QUEUE. Every read below is classified and
 *    disclosed by name. "Nothing is waiting for review" is a claim about this
 *    plan, and a broken query may not make it.
 *
 * 4. IT NEVER SHOWS A SCORE. No confidence, no certainty, no percentage
 *    anywhere. What a reviewer gets is the value, the page, and the document's
 *    own words — the three things they can actually check.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BookOpenCheck, ScrollText } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  loadRtpFinancialElement,
  type RtpFinancialElementSupabaseLike,
} from "@/lib/rtp/financial-element-queries";
import {
  describeUnreadableDocument,
  documentCanBeOcred,
  isKbOcrWorkerConfigured,
} from "@/lib/knowledge-base/ocr-availability";
import {
  reconcileExtractionCandidate,
  rollUpReconciliations,
  type RtpCycleRecordedState,
} from "@/lib/rtp/extraction/reconcile";
import {
  describeCycleBasisBlastRadius,
  describeReconciliationRollup,
  describeRunOutcome,
} from "@/lib/rtp/extraction/display";
import {
  ExtractionCandidateCard,
  type ExtractionCandidateView,
} from "@/components/rtp/extraction-candidate-card";
import {
  ExtractionRunLauncher,
  type ExtractionSourceDocument,
} from "./_components/extraction-run-launcher";

type RouteContext = { params: Promise<{ rtpCycleId: string }> };

const RUN_COLUMNS =
  "id, kb_document_id, model, extraction_source, status, candidate_count, discarded_count, failure_reason, created_at, kb_documents(id, title)";

const CANDIDATE_COLUMNS =
  "id, run_id, target_kind, proposed_json, source_page, source_quote, status, created_at";

const DOCUMENT_COLUMNS = "id, title, status, source_kind, extraction_source, extraction_error";

type RunRow = {
  id: string;
  kb_document_id: string | null;
  model: string | null;
  extraction_source: string | null;
  status: string;
  candidate_count: number | null;
  discarded_count: number | null;
  failure_reason: string | null;
  created_at: string;
  kb_documents: { id: string; title: string | null } | Array<{ id: string; title: string | null }> | null;
};

type CandidateRow = {
  id: string;
  run_id: string | null;
  target_kind: string;
  proposed_json: unknown;
  source_page: number | null;
  source_quote: string | null;
  status: string;
  created_at: string;
};

type LinkRow = {
  id: string;
  project_id: string;
  horizon_band_id: string | null;
  portfolio_role: string | null;
  estimated_cost: number | string | null;
  cost_basis_year: number | null;
  projects: { id: string; name: string } | Array<{ id: string; name: string }> | null;
};

type DocumentRow = {
  id: string;
  title: string | null;
  status: string;
  source_kind: string;
  extraction_source: string | null;
  extraction_error: string | null;
};

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

const TARGET_KIND_HEADINGS: Record<string, string> = {
  financial_line: "Revenue and cost lines",
  performance_measure: "Performance measures",
  horizon_band: "Planning periods",
  programmed_project: "Programmed project costs",
  cycle_financial_basis: "The plan's dollar year",
  chapter_block: "Policy and goal text",
};

/**
 * Why a document in the library cannot be transcribed from, in the words the
 * planner who uploaded it needs — naming OCR where OCR is the answer, and
 * naming whether this deployment has it.
 *
 * `null` means the document CAN be read. The same three conditions the run
 * route enforces, stated here before the click rather than as a 409 after it.
 */
function unreadableReason(document: DocumentRow, workerConfigured: boolean): string | null {
  if (document.status === "ready") {
    if (document.extraction_source === "text_layer" || document.extraction_source === "ocr") {
      return null;
    }
    return "its text did not come from pages, so nothing in it could be cited to a page";
  }
  if (documentCanBeOcred(document)) {
    return describeUnreadableDocument(document.extraction_error, workerConfigured);
  }
  const byStatus: Record<string, string> = {
    pending: "it is still queued to be read",
    extracting: "it is being read right now",
    failed: `it could not be read: ${document.extraction_error?.trim() || "the reason was not recorded"}`,
    stored: "it was kept for download only, so it has no pages to quote",
    archived: "it has been archived",
  };
  return byStatus[document.status] ?? `it is not ready to be read (status: ${document.status})`;
}

export default async function RtpExtractionReviewPage({ params }: RouteContext) {
  const { rtpCycleId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="RTP"
        title="Reviewing a plan document needs a workspace"
        description="An RTP cycle belongs to the workspace preparing it. You are signed in, but no workspace membership was found for this account."
      />
    );
  }

  const cycleResult = await supabase
    .from("rtp_cycles")
    .select("id, workspace_id, title, financial_basis_year")
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A FAILED READ IS NOT A MISSING CYCLE. Answering 404 over a broken query
  // tells a planner their plan is gone.
  if (cycleResult.error) {
    return (
      <section className="module-page">
        <div className="mx-auto w-full max-w-2xl px-2 py-10">
          <StateBlock
            tone="danger"
            title="This plan could not be read"
            description={`The query for this plan did not complete: ${
              cycleResult.error.message ?? "no reason was returned"
            }. That is not the same as the plan not existing.`}
          />
          <div className="mt-4">
            <Link href="/rtp" className="module-inline-action w-fit">
              <ArrowLeft className="h-4 w-4" />
              Back to RTP registry
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const cycle = cycleResult.data as {
    id: string;
    workspace_id: string;
    title: string;
    financial_basis_year: number | null;
  } | null;
  if (!cycle) {
    notFound();
  }

  const canWrite = canAccessWorkspaceAction("plans.write", membership.role);
  const reads = new ReadFailureLog();

  const [runsResult, candidatesResult, linksResult, projectsResult, documentsResult] = await Promise.all([
    supabase
      .from("rtp_extraction_runs")
      .select(RUN_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("rtp_extraction_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select(
        "id, project_id, horizon_band_id, portfolio_role, estimated_cost, cost_basis_year, projects(id, name)"
      )
      .eq("rtp_cycle_id", cycle.id),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", membership.workspace_id)
      .order("name", { ascending: true })
      .limit(500),
    supabase
      .from("kb_documents")
      .select(DOCUMENT_COLUMNS)
      .eq("workspace_id", membership.workspace_id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const runsFailed = reads.check("the readings of documents for this plan", runsResult);
  const candidatesFailed = reads.check("what was copied out of those documents", candidatesResult);
  reads.check("the projects in this plan", linksResult);
  reads.check("this workspace's projects", projectsResult);
  const documentsFailed = reads.check("this workspace's document library", documentsResult);

  const financial = await loadRtpFinancialElement(
    supabase as unknown as RtpFinancialElementSupabaseLike,
    cycle.id
  );
  reads.check("the funding periods of this plan", financial.results.bands);
  reads.check("the revenue and cost lines of this plan", financial.results.lines);
  reads.check("the performance measures of this plan", financial.results.measures);

  const links = (linksResult.data ?? []) as unknown as LinkRow[];

  // WHAT THIS PLAN ALREADY RECORDS. Reconciliation compares against this and
  // nothing else — no model call, no similarity, no guess.
  const recorded: RtpCycleRecordedState = {
    lines: financial.lines.map((line) => ({
      id: line.id,
      horizonBandId: line.horizonBandId,
      entryKind: line.entryKind,
      sourceName: line.sourceName,
      amount: line.amount,
      amountBasisYear: line.amountBasisYear,
    })),
    measures: financial.measures.map((measure) => ({
      id: measure.id,
      measureKey: measure.measureKey,
      label: measure.label,
      unit: measure.unit,
      baselineValue: measure.baselineValue,
      baselineYear: measure.baselineYear,
      targetValue: measure.targetValue,
      targetYear: measure.targetYear,
      dataSource: measure.dataSource,
    })),
    bands: financial.bands.map((band) => ({
      id: band.id,
      label: band.label,
      startYear: band.startYear,
      endYear: band.endYear,
      escalationTargetYear: band.escalationTargetYear,
      costEstimateBasis: band.costEstimateBasis,
    })),
    programmedProjects: links.map((link) => ({
      id: link.id,
      projectId: link.project_id,
      projectName: firstOf(link.projects)?.name ?? null,
      horizonBandId: link.horizon_band_id,
      portfolioRole: link.portfolio_role,
      estimatedCost: link.estimated_cost,
      costBasisYear: link.cost_basis_year,
    })),
    cycle: { id: cycle.id, financialBasisYear: cycle.financial_basis_year },
  };

  const runs = (runsResult.data ?? []) as unknown as RunRow[];
  const candidates = (candidatesResult.data ?? []) as CandidateRow[];

  /*
    CHAPTER BLOCKS ARE REVIEWED SOMEWHERE ELSE (Lane 6 seam, 2026-08-11).

    Verbatim policy and goal text does not go into an RTP table and has no write
    route to accept it through: it is placed into a chapter's staging queue on
    `/rtp/<id>/extraction/chapters`, where the reviewer also picks the chapter.
    Leaving those cards here would offer a "Save into the plan" button whose only
    possible answer is a refusal. They are counted and linked instead.
  */
  const chapterBlocksWaiting = candidates.filter(
    (candidate) => candidate.status === "pending" && candidate.target_kind === "chapter_block"
  ).length;

  const pending = candidates.filter(
    (candidate) =>
      candidate.status === "pending" &&
      candidate.target_kind !== "chapter_block" &&
      typeof candidate.source_page === "number" &&
      typeof candidate.source_quote === "string"
  );

  const reconciliationById = new Map(
    pending.map((candidate) => [
      candidate.id,
      reconcileExtractionCandidate(
        { targetKind: candidate.target_kind, proposedJson: candidate.proposed_json },
        recorded
      ),
    ])
  );

  const rollup = rollUpReconciliations([...reconciliationById.values()]);

  const bandOptions = financial.bands.map((band) => ({
    id: band.id,
    label: band.label,
    startYear: band.startYear,
    endYear: band.endYear,
  }));
  const projectOptions = ((projectsResult.data ?? []) as Array<{ id: string; name: string }>).map(
    (project) => ({ id: project.id, name: project.name })
  );

  const workerConfigured = isKbOcrWorkerConfigured();
  const sourceDocuments: ExtractionSourceDocument[] = documentsFailed
    ? []
    : ((documentsResult.data ?? []) as DocumentRow[]).map((document) => ({
        id: document.id,
        title: document.title?.trim() || "Untitled document",
        unreadableReason: unreadableReason(document, workerConfigured),
      }));

  const documentTitleByRunId = new Map(
    runs.map((run) => [run.id, firstOf(run.kb_documents)?.title?.trim() || "a document in this library"])
  );
  const documentIdByRunId = new Map(
    runs.map((run) => [run.id, firstOf(run.kb_documents)?.id ?? run.kb_document_id ?? null])
  );

  const candidatesByRun = new Map<string, CandidateRow[]>();
  for (const candidate of candidates) {
    const key = candidate.run_id ?? "__no_run__";
    const list = candidatesByRun.get(key) ?? [];
    list.push(candidate);
    candidatesByRun.set(key, list);
  }

  return (
    <section className="module-page">
      <div className="space-y-6">
        <div>
          <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to {cycle.title}
          </Link>
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Document review</p>
              <h1 className="module-section-title">What the plan document says</h1>
              <p className="module-section-description">
                OpenPlan reads an adopted plan and copies out what it finds, with the page and the
                document&apos;s own words. Nothing reaches this plan until you save it here — and what
                you save goes through the same checks as a figure you type.
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
              <ScrollText className="h-5 w-5" />
            </span>
          </div>

          {reads.any ? (
            <StateBlock
              tone="danger"
              title="Part of this page could not be read"
              description={`${reads.describe()} What is missing below is not a finding — do not treat this page as a complete picture of what has been copied out of your documents.`}
            />
          ) : null}

          <div className="mt-4">
            <ExtractionRunLauncher
              rtpCycleId={cycle.id}
              documents={sourceDocuments}
              canWrite={canWrite}
            />
          </div>

          {/*
            ALWAYS LINKED, not only when something is waiting. A planner who has
            already placed every block still needs the way back to see what they
            placed, and a link that disappears once the queue empties is this
            repository's shipped-invisible defect wearing a helpful face.
          */}
          <p className="mt-4 text-sm text-muted-foreground">
            {chapterBlocksWaiting > 0
              ? `${chapterBlocksWaiting} block${chapterBlocksWaiting === 1 ? "" : "s"} of the plan's own policy and goal text ${chapterBlocksWaiting === 1 ? "is" : "are"} waiting too.`
              : "Policy and goal text copied out of a document is handled separately."}{" "}
            That text goes into a chapter you choose rather than into the plan&apos;s ledger.{" "}
            <Link href={`/rtp/${cycle.id}/extraction/chapters`} className="underline underline-offset-2">
              Place copied chapter text
            </Link>
            .
          </p>
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Waiting for review</p>
              <h2 className="module-section-title">{describeReconciliationRollup(rollup)}</h2>
              <p className="module-section-description">
                Compared against what this plan already records — by name, by period, and by figure.
                The comparison is made here in OpenPlan, never by the model that read the document.
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
              <BookOpenCheck className="h-5 w-5" />
            </span>
          </div>

          {runs.length === 0 ? (
            runsFailed ? (
              <StateBlock
                tone="danger"
                title="The readings of this plan's documents could not be listed"
                description="This is not a finding that no document has been read for this plan."
              />
            ) : (
              <EmptyState
                title="No document has been read for this plan yet"
                description="Choose a document above and OpenPlan will read it, page by page, and stage what it finds here for you to check."
              />
            )
          ) : (
            <div className="space-y-6">
              {runs.map((run) => {
                const runCandidates = candidatesByRun.get(run.id) ?? [];
                const waiting = runCandidates.filter(
                  (candidate) =>
                    candidate.status === "pending" && candidate.target_kind !== "chapter_block"
                );
                const saved = runCandidates.filter((candidate) => candidate.status === "accepted").length;
                const setAside = runCandidates.filter((candidate) => candidate.status === "rejected").length;
                const documentId = documentIdByRunId.get(run.id) ?? null;
                const documentHref = documentId
                  ? `/api/knowledge-base/documents/${documentId}/download`
                  : null;

                return (
                  <section key={run.id} className="space-y-3">
                    <header className="space-y-1 border-b border-border/60 pb-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {documentTitleByRunId.get(run.id)}
                      </h3>
                      {/*
                        THE DISCARDED COUNT, ON THE SCREEN. A reading that shows
                        only what survived presents a clean-looking extraction
                        and conceals how much of it the model got wrong.
                      */}
                      <p className="text-xs text-muted-foreground">
                        {describeRunOutcome({
                          status: run.status,
                          candidateCount: run.candidate_count,
                          discardedCount: run.discarded_count,
                          failureReason: run.failure_reason,
                        })}
                      </p>
                      <p className="text-[0.7rem] text-muted-foreground">
                        Read {new Date(run.created_at).toLocaleString()}
                        {run.extraction_source === "ocr" ? " · text recognised from a scan" : ""}
                        {saved > 0 ? ` · ${saved} saved into the plan` : ""}
                        {setAside > 0 ? ` · ${setAside} set aside` : ""}
                      </p>
                    </header>

                    {waiting.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {candidatesFailed
                          ? "What was copied out of this document could not be read, so nothing is listed here."
                          : "Nothing from this reading is waiting for review."}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {waiting.map((candidate) => {
                          const reconciliation = reconciliationById.get(candidate.id);
                          if (!reconciliation) return null;
                          const view: ExtractionCandidateView = {
                            id: candidate.id,
                            targetKind: candidate.target_kind,
                            proposedJson:
                              candidate.proposed_json &&
                              typeof candidate.proposed_json === "object" &&
                              !Array.isArray(candidate.proposed_json)
                                ? (candidate.proposed_json as Record<string, unknown>)
                                : {},
                            page: candidate.source_page as number,
                            quote: candidate.source_quote as string,
                            status: candidate.status,
                            reconciliation,
                          };

                          return (
                            <div key={candidate.id} className="space-y-1">
                              <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                {TARGET_KIND_HEADINGS[candidate.target_kind] ?? candidate.target_kind}
                              </p>
                              <ExtractionCandidateCard
                                rtpCycleId={cycle.id}
                                candidate={view}
                                bands={bandOptions}
                                projects={projectOptions}
                                documentHref={documentHref}
                                canWrite={canWrite}
                                blastRadius={
                                  candidate.target_kind === "cycle_financial_basis"
                                    ? describeCycleBasisBlastRadius({
                                        lineCount: recorded.lines.length,
                                        programmedProjectCount: recorded.programmedProjects.length,
                                        recordedBasisYear: cycle.financial_basis_year,
                                        proposedBasisYear:
                                          typeof view.proposedJson.financialBasisYear === "number"
                                            ? view.proposedJson.financialBasisYear
                                            : null,
                                      })
                                    : null
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
