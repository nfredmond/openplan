import * as React from "react";

import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";
import type { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * TWO READERS, ONE NOTICE.
 *
 * A page that could not read part of itself has to say so to a planner — who
 * needs to know which numbers on the screen to disbelieve and what to do next —
 * and it has to carry enough for whoever operates the deployment to fix it.
 * Those are different sentences for different people, and ten internal pages
 * had been concatenating them: `${reads.describe()} ${reads.messages()}`, which
 * puts `column projects.assignee_user_id does not exist` in the middle of a
 * paragraph a planner is reading. `read-failures.ts` is explicit that
 * `messages()` is the DATABASE'S OWN TEXT for an operator; the public plan
 * pages already honour that by rendering `describe()` alone.
 *
 * So: the planner sentence at full prominence, the operator text intact but
 * folded away behind a summary that names who it is for. Nothing is deleted —
 * a planner who is also the operator opens the disclosure and finds every word
 * that used to be inline.
 *
 * WHY A COMPONENT RATHER THAN A CONVENTION. The concatenation was written ten
 * times by lanes that each solved it locally. A shared component is the only
 * form of this rule that the eleventh lane inherits for free.
 */

/** Named once so the disclosure reads the same wherever it appears. */
export const OPERATOR_DETAIL_SUMMARY = "Technical detail for whoever runs this deployment";

/**
 * WHAT THE PLANNER CAN DO ABOUT IT — the half `describe()` cannot supply.
 *
 * `ReadFailureLog.describe()` says which parts of the page to disbelieve and
 * stops there, which leaves the reader at a dead end: a notice that only says
 * something is broken tells them nothing to try. Its sibling test states this as
 * rule #2 and enforces it with `PLANNER_CAN_ACT` — but only on the surfaces that
 * pass their own sentence, so the DEFAULT was the one place the rule did not
 * reach.
 *
 * Both moves are named because either alone would be a guess about the cause. A
 * failed read is transient (a dropped connection, a restarting database) or
 * structural (a missing column, a policy that hides the row); a reload fixes the
 * first and never the second, and only the person who runs the deployment can
 * fix the second. Saying "reload, and if it persists, ask them" is true either
 * way, and points at the disclosure that holds what they will need.
 */
export const READ_FAILURE_PLANNER_ACTION =
  "Reload the page to try again. If it keeps happening, ask whoever runs this deployment — the technical detail below is for them.";

/**
 * The collapsed second register: operator plumbing — a database message, an
 * environment variable, a migration number, a cron path — kept on the page and
 * out of the planner's sentence.
 *
 * Colours are inherited rather than declared, so this sits correctly inside a
 * danger `StateBlock`, a `.module-alert`, or a plain muted panel, in either
 * theme. Its parent must be a block element: `<details>` is not valid inside a
 * `<p>`, which is why the callers that used `<p className="module-alert">` are
 * now `<div className="module-alert">`.
 */
export function OperatorDetail({
  children,
  summary = OPERATOR_DETAIL_SUMMARY,
  className,
  testId,
}: {
  children: React.ReactNode;
  summary?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <details className={cn("mt-1.5 text-xs", className)} data-testid={testId}>
      <summary className="cursor-pointer select-none opacity-80 transition hover:opacity-100">
        {summary}
      </summary>
      <div className="mt-1.5 space-y-1 opacity-90">{children}</div>
    </details>
  );
}

/**
 * What this page could not read, said to a planner, with the operator's copy
 * folded underneath it.
 *
 * `description` overrides the default `reads.describe()` for the surfaces whose
 * disclosure is narrower than the whole page — a single panel says what an
 * empty panel would not mean, and a page-wide sentence there would overclaim.
 * Pass the planner sentence; never pass `reads.messages()`.
 *
 * `READ_FAILURE_PLANNER_ACTION` is appended to whichever sentence is used, so a
 * caller that narrows the disclosure does not also have to remember to restate
 * the move — the one thing every caller of this component has in common is that
 * their reader needs to know what to try.
 */
export function ReadFailureNotice({
  reads,
  title = "Part of this page could not be read",
  description,
  className,
  compact = false,
  testId,
}: {
  reads: ReadFailureLog;
  title?: string;
  description?: string;
  className?: string;
  compact?: boolean;
  testId?: string;
}) {
  if (!reads.any) {
    return null;
  }

  const messages = reads.messages();
  const plannerSentence = description ?? reads.describe();

  return (
    <StateBlock
      className={className}
      compact={compact}
      tone="danger"
      title={title}
      description={
        plannerSentence ? `${plannerSentence} ${READ_FAILURE_PLANNER_ACTION}` : READ_FAILURE_PLANNER_ACTION
      }
      testId={testId}
      detail={
        <OperatorDetail>
          <p>
            Each line is the failed read and the message the database returned for it. Check this
            deployment&apos;s database permissions, row-level security policies and pending
            migrations, then reload.
          </p>
          <ul className="space-y-0.5">
            {messages.map((message) => (
              <li key={message} className="break-words font-mono">
                {message}
              </li>
            ))}
          </ul>
        </OperatorDetail>
      }
    />
  );
}
