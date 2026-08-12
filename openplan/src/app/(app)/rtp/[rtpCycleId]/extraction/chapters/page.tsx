/**
 * THE PLAN'S OWN WORDS, WAITING FOR A CHAPTER.
 *
 * The figures a document reading finds go to the review screen next door and
 * from there into the plan's ledger. Prose cannot travel that way: there is no
 * write route for a paragraph, and there must not be one. Nathaniel's Q3
 * decision of 2026-08-11 put chapter narrative in scope as VERBATIM BLOCKS
 * ONLY, and this page is where a person decides what happens to each of them.
 *
 * THE TWO HALVES:
 *
 *   Waiting to be placed — every verbatim block copied out of a document that
 *   nobody has put in a chapter yet. Each one shows the plan's sentence, the
 *   page, and a chapter picker that starts empty. OpenPlan never guesses which
 *   chapter a policy statement belongs in.
 *
 *   Waiting in each chapter — blocks already placed, badged with the document
 *   and page they came from, none of them in the plan. A chapter's published
 *   text is what a planner writes in the chapter editor; these are quotations
 *   waiting to be used, accepted, or set aside.
 *
 * A FAILED READ IS NOT AN EMPTY QUEUE. Every read is classified and disclosed
 * by name. "Nothing is waiting" is a claim about this plan, and a broken query
 * may not make it.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Quote } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  CHAPTER_BLOCK_REFUSAL_SENTENCES,
  CHAPTER_BLOCK_TARGET_KIND,
  readTranscribedChapterGrounding,
  verifyStoredChapterBlock,
} from "@/lib/rtp/extraction/chapter-blocks";
import {
  TranscribedChapterBlockCard,
  type TranscribedBlockChapterOption,
} from "@/components/rtp/transcribed-chapter-block-card";
import { TranscribedChapterDraftCard } from "@/components/rtp/transcribed-chapter-draft-card";

type RouteContext = { params: Promise<{ rtpCycleId: string }> };

const CANDIDATE_COLUMNS =
  "id, run_id, target_kind, proposed_json, source_page, source_quote, quote_verified, status, created_at";

const RUN_COLUMNS = "id, kb_document_id, kb_documents(id, title)";

const DRAFT_COLUMNS =
  "id, target_id, draft_markdown, accepted_markdown, grounding_json, status, created_at";

type CandidateRow = {
  id: string;
  run_id: string | null;
  target_kind: string;
  proposed_json: unknown;
  source_page: number | null;
  source_quote: string | null;
  quote_verified: boolean | null;
  status: string;
  created_at: string;
};

type RunRow = {
  id: string;
  kb_document_id: string | null;
  kb_documents: { id: string; title: string | null } | Array<{ id: string; title: string | null }> | null;
};

type ChapterRow = { id: string; title: string | null; sort_order: number | null; status: string | null };

type DraftRow = {
  id: string;
  target_id: string;
  draft_markdown: string;
  accepted_markdown: string | null;
  grounding_json: unknown;
  status: string;
  created_at: string;
};

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const UNTITLED_DOCUMENT = "a document in this plan's library";

export default async function RtpTranscribedChaptersPage({ params }: RouteContext) {
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
    .select("id, workspace_id, title")
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A FAILED READ IS NOT A MISSING CYCLE.
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

  const cycle = cycleResult.data as { id: string; workspace_id: string; title: string } | null;
  if (!cycle) {
    notFound();
  }

  const canWrite = canAccessWorkspaceAction("plans.write", membership.role);
  const reads = new ReadFailureLog();

  const [chaptersResult, candidatesResult, runsResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, title, sort_order, status")
      .eq("rtp_cycle_id", cycle.id)
      .eq("workspace_id", membership.workspace_id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("rtp_extraction_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .eq("target_kind", CHAPTER_BLOCK_TARGET_KIND)
      .order("created_at", { ascending: true }),
    supabase
      .from("rtp_extraction_runs")
      .select(RUN_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const chaptersFailed = reads.check("the chapters of this plan", chaptersResult);
  const candidatesFailed = reads.check("the text copied out of this plan's documents", candidatesResult);
  reads.check("the readings of documents for this plan", runsResult);

  const chapters = (chaptersResult.data ?? []) as ChapterRow[];
  const chapterOptions: TranscribedBlockChapterOption[] = chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title?.trim() || "Untitled chapter",
  }));
  const chapterIds = chapters.map((chapter) => chapter.id);

  const draftsResult =
    chapterIds.length > 0
      ? await supabase
          .from("document_narrative_drafts")
          .select(DRAFT_COLUMNS)
          .eq("workspace_id", membership.workspace_id)
          .eq("target_kind", "rtp_chapter")
          .in("target_id", chapterIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
  const draftsFailed = reads.check("the text already waiting in this plan's chapters", draftsResult);

  const runs = (runsResult.data ?? []) as unknown as RunRow[];
  const documentByRunId = new Map(
    runs.map((run) => {
      const document = firstOf(run.kb_documents);
      return [
        run.id,
        {
          id: document?.id ?? run.kb_document_id ?? null,
          title: document?.title?.trim() || UNTITLED_DOCUMENT,
        },
      ];
    })
  );

  const candidates = (candidatesResult.data ?? []) as CandidateRow[];
  const waiting = candidates.filter((candidate) => candidate.status === "pending");

  /*
    PRE-SCREEN WITH THE SAME VERIFIER THE ROUTE USES, so a block that can never
    be staged says why here instead of failing after the click. The cited page
    is deliberately NOT re-read on this page — that check belongs at the moment
    of the write, and doing it here would be one query per card.
  */
  const waitingViews = waiting.map((candidate) => {
    const verification = verifyStoredChapterBlock(
      {
        id: candidate.id,
        target_kind: candidate.target_kind,
        proposed_json: candidate.proposed_json,
        source_page: candidate.source_page,
        source_quote: candidate.source_quote,
        quote_verified: candidate.quote_verified,
      },
      null
    );
    const source = candidate.run_id ? documentByRunId.get(candidate.run_id) ?? null : null;
    return {
      candidate: {
        id: candidate.id,
        page: candidate.source_page ?? 0,
        quote: candidate.source_quote ?? "",
        blockedReason: verification.ok ? null : CHAPTER_BLOCK_REFUSAL_SENTENCES[verification.reason],
      },
      documentTitle: source?.title ?? UNTITLED_DOCUMENT,
      documentHref: source?.id ? `/api/knowledge-base/documents/${source.id}/download` : null,
    };
  });

  // Only TRANSCRIBED drafts belong on this page. A chapter's model-drafted
  // narrative is a different thing with a different review, and mixing them
  // would put "nobody wrote this" beside prose a model wrote.
  const drafts = ((draftsResult.data ?? []) as DraftRow[]).filter((draft) =>
    readTranscribedChapterGrounding(draft.grounding_json)
  );
  const draftsByChapter = new Map<string, DraftRow[]>();
  for (const draft of drafts) {
    const list = draftsByChapter.get(draft.target_id) ?? [];
    list.push(draft);
    draftsByChapter.set(draft.target_id, list);
  }

  return (
    <section className="module-page">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Link href={`/rtp/${cycle.id}/extraction`} className="module-inline-action w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to document review
          </Link>
          <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
            Open {cycle.title}
          </Link>
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Document review · chapter text</p>
              <h1 className="module-section-title">The plan&apos;s own words</h1>
              <p className="module-section-description">
                When OpenPlan reads an adopted plan it copies policy, goal and action statements out
                word for word — never a summary, never a rewrite. Nothing here is in your plan. You
                choose which chapter each block belongs in, and the chapter&apos;s text stays whatever
                you write in the chapter editor.
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
              <Quote className="h-5 w-5" />
            </span>
          </div>

          {reads.any ? (
            <StateBlock
              tone="danger"
              title="Part of this page could not be read"
              description={`${reads.describe()} What is missing below is not a finding — do not treat this page as a complete picture.`}
            />
          ) : null}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Waiting to be placed</p>
              <h2 className="module-section-title">
                {waitingViews.length} block{waitingViews.length === 1 ? "" : "s"} of copied text
              </h2>
              <p className="module-section-description">
                One decision each. OpenPlan does not guess which chapter a statement belongs in — that
                is a judgement about your plan, not about the document.
              </p>
            </div>
          </div>

          {chaptersFailed ? (
            <StateBlock
              tone="danger"
              title="This plan's chapters could not be read"
              description="Without them there is nowhere to put a block, so nothing can be placed right now. This is not a finding that the plan has no chapters."
            />
          ) : chapters.length === 0 ? (
            <StateBlock
              tone="warning"
              title="This plan has no chapters yet"
              description="Copied text is placed into a chapter of your plan. Open the plan and add its chapters first."
            />
          ) : null}

          {waitingViews.length === 0 ? (
            candidatesFailed ? (
              <StateBlock
                tone="danger"
                title="The text copied out of this plan's documents could not be read"
                description="This is not a finding that no text was copied."
              />
            ) : (
              <EmptyState
                title="No copied text is waiting"
                description="Read a document for this plan and ask for its policy and goal text — the blocks it copies out will wait here."
              />
            )
          ) : (
            <div className="space-y-3">
              {waitingViews.map((view) => (
                <TranscribedChapterBlockCard
                  key={view.candidate.id}
                  rtpCycleId={cycle.id}
                  candidate={view.candidate}
                  chapters={chapterOptions}
                  documentTitle={view.documentTitle}
                  documentHref={view.documentHref}
                  canWrite={canWrite && chapters.length > 0}
                />
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Already placed</p>
              <h2 className="module-section-title">Copied text waiting in your chapters</h2>
              <p className="module-section-description">
                Each block keeps saying which document and page it came from until somebody accepts
                or changes it. None of it is in the plan: a chapter says what you write in its editor.
              </p>
            </div>
          </div>

          {draftsFailed ? (
            <StateBlock
              tone="danger"
              title="The text already waiting in this plan's chapters could not be read"
              description="This is not a finding that no text is waiting."
            />
          ) : drafts.length === 0 ? (
            <EmptyState
              title="No copied text has been placed in a chapter yet"
              description="Place a block above and it will appear here, under the chapter you chose."
            />
          ) : (
            <div className="space-y-6">
              {chapters
                .filter((chapter) => (draftsByChapter.get(chapter.id) ?? []).length > 0)
                .map((chapter) => (
                  <section key={chapter.id} className="space-y-3">
                    <header className="border-b border-border/60 pb-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {chapter.title?.trim() || "Untitled chapter"}
                      </h3>
                    </header>
                    <div className="space-y-3">
                      {(draftsByChapter.get(chapter.id) ?? []).map((draft) => {
                        const grounding = readTranscribedChapterGrounding(draft.grounding_json);
                        return (
                          <TranscribedChapterDraftCard
                            key={draft.id}
                            rtpCycleId={cycle.id}
                            chapterId={chapter.id}
                            draft={{
                              id: draft.id,
                              status: draft.status,
                              draftMarkdown: draft.draft_markdown,
                              acceptedMarkdown: draft.accepted_markdown,
                              groundingJson: draft.grounding_json,
                            }}
                            documentHref={
                              grounding?.kb_document_id
                                ? `/api/knowledge-base/documents/${grounding.kb_document_id}/download`
                                : null
                            }
                            canWrite={canWrite}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
