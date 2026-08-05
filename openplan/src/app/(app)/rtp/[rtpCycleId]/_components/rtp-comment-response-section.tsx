/**
 * What the public said about this plan, and what the agency said back.
 *
 * A SERVER component that renders an already-built summary. The record is the
 * thing an agency publishes to show it listened, so the two states this must
 * never confuse are "nobody commented" and "the comments could not be read" —
 * the second rendered as the first is an agency claiming silence it never
 * heard.
 *
 * Nathaniel's decision, implemented here exactly: an approved comment with no
 * response is RECORDED AND WARNED, never a block on adoption. OpenPlan cannot
 * know every agency's response obligation, so it surfaces the gap where a
 * planner will act on it and stops short of asserting a threshold.
 */
import { MessageSquare } from "lucide-react";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  describeRtpCommentResponse,
  type RtpCommentResponseSummary,
} from "@/lib/rtp/comment-response";

export function RtpCommentResponseSection({
  summary,
}: {
  summary: RtpCommentResponseSummary;
}) {
  const anythingUnreadable =
    !summary.campaignsReadable || !summary.commentsReadable || !summary.responsesReadable;

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Comment-response record</p>
          <h2 className="module-section-title">What the public said, and what we said back</h2>
          <p className="module-section-description">
            Approved public comments on this plan, paired with the agency&apos;s published responses.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
          <MessageSquare className="h-5 w-5" />
        </span>
      </div>

      {!summary.campaignsReadable ? (
        <StateBlock
          tone="danger"
          title="The public engagement on this plan could not be read"
          description="No comment-response record is shown, because the consultations attached to this plan could not be loaded. This is a failed read — it is not a finding that nobody commented."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{describeRtpCommentResponse(summary)}</p>

          {/*
            The warning, not a block. It names the number outstanding so a
            planner can close them, and says in words that adoption is not
            gated on it.
          */}
          {summary.hasUnansweredComments === true ? (
            <div className="rounded-[0.5rem] border border-amber-300/60 bg-amber-50/50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/25">
              <StatusBadge tone="warning">Outstanding responses</StatusBadge>
              <p className="mt-1.5 text-muted-foreground">
                Some approved comments have no published response yet. This does not stop the plan
                being adopted — it is recorded here so it can be closed before the board sees it.
              </p>
            </div>
          ) : null}

          {anythingUnreadable && summary.campaignsReadable ? (
            <div className="rounded-[0.5rem] border border-amber-300/60 bg-amber-50/40 px-4 py-2.5 text-xs text-muted-foreground dark:border-amber-900/50 dark:bg-amber-950/20">
              Part of this record could not be read, so the counts above are incomplete. They are not
              a finding about how much the public said or how much was answered.
            </div>
          ) : null}

          {summary.entries.length === 0 && summary.commentsReadable ? (
            <EmptyState
              title="No approved public comments yet"
              description="Comments appear here once they have been through moderation. Only approved comments are published in the record — an agency should not publish input it has not reviewed."
            />
          ) : (
            <ul className="space-y-2">
              {summary.entries.map((entry) => (
                <li key={entry.comment.id} className="rounded-[0.5rem] border border-border/60 px-4 py-3">
                  <p className="text-sm text-foreground">{entry.comment.body}</p>
                  {entry.response ? (
                    <p className="mt-2 border-l-2 border-emerald-400/60 pl-3 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Our response: </span>
                      {entry.response.weDid || entry.response.youSaid}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No published response yet.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
