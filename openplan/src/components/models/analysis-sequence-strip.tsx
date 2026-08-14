import Link from "next/link";

import {
  resolveAnalysisSequence,
  type AnalysisSequenceFacts,
  type AnalysisStepState,
} from "@/components/models/analysis-sequence";
import { SCREENING_GRADE_HELP_HREF } from "@/lib/help/screening-grade";

/**
 * THE ANALYSIS SEQUENCE, ON EVERY PAGE IN THE GROUP.
 *
 * A HEADING AND A NUMBERED LIST — deliberately not cards. The complaint that
 * produced this ("super confusing") is about a wall of parallel boxes on four
 * pages that are actually one procedure, and answering it with a fifth wall of
 * boxes would make the page worse while looking like an improvement. Nothing
 * here draws a border with a radius, so this adds zero to the nesting depth the
 * browser audit measures; the left rule on the list is a rule, not a box.
 *
 * WHY THE ORDER IS SHOWN EVEN WHEN EVERYTHING IS DONE. The order is the thing
 * being taught. A strip that disappears once the work is finished teaches it to
 * exactly the people who no longer need it and nobody else.
 *
 * THE LAST ITEM IS NOT A TASK. It is the claim boundary, and it says the same
 * thing whether or not the checking step passed — a validated screening run is
 * still a screening run. Its wording is Help's, cited rather than retyped.
 */

const STATE_LABEL: Record<AnalysisStepState, string> = {
  done: "Done",
  next: "Do this next",
  waiting: "Waiting",
  unknown: "Not known",
};

const STATE_TONE: Record<AnalysisStepState, string> = {
  done: "text-emerald-700 dark:text-emerald-300",
  next: "text-sky-700 dark:text-sky-300",
  waiting: "text-muted-foreground",
  unknown: "text-amber-700 dark:text-amber-300",
};

export function AnalysisSequenceStrip({
  facts,
  currentStepId,
}: {
  facts: AnalysisSequenceFacts;
  /** The step this page IS. Marked so the reader can place themselves. */
  currentStepId?: string;
}) {
  const steps = resolveAnalysisSequence(facts);

  return (
    <section className="mb-6" data-testid="analysis-sequence">
      <h2 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-foreground">
        Models, Scenarios and Model Validation are one job, in this order
      </h2>
      <p className="mt-2 max-w-[36rem] text-[1.0625rem] leading-[1.65] text-muted-foreground">
        You can work out of order, and sometimes you will have to. This is what each page is for
        and what it needs from the one before it. Corridor Analysis is not part of this — it is a
        separate map tool for looking at one corridor, and it keeps its own history.
      </p>

      <ol className="mt-5 max-w-[36rem] space-y-5 border-l border-border/60 pl-5">
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStepId;
          return (
            <li key={step.id} data-testid={`analysis-step-${step.id}`} data-state={step.state}>
              <p className={`text-[0.8rem] font-semibold uppercase tracking-[0.14em] ${STATE_TONE[step.state]}`}>
                <span data-testid={`analysis-step-state-${step.id}`}>{STATE_LABEL[step.state]}</span>
                {isCurrent ? <span className="ml-2 text-muted-foreground">· you are here</span> : null}
              </p>
              <h3 className="mt-1 text-[1.0625rem] font-semibold leading-snug text-foreground">
                {index + 1}. {step.title}
              </h3>
              <p className="mt-1 text-[1.0625rem] leading-[1.65] text-muted-foreground">{step.what}</p>
              <p className="mt-1 text-[1.0625rem] leading-[1.65] text-foreground/80">
                {step.standing}
                {step.waitingOn ? ` Waiting for “${step.waitingOn}” first.` : ""}
              </p>
              {step.id === "claim" ? (
                <p className="mt-1 text-[1.0625rem] leading-[1.65]">
                  <Link href={SCREENING_GRADE_HELP_HREF} className="underline underline-offset-2 hover:text-foreground">
                    What that lets you say, and what it does not
                  </Link>
                </p>
              ) : step.href && step.state !== "done" ? (
                <p className="mt-1 text-[1.0625rem] leading-[1.65]">
                  <Link href={step.href} className="underline underline-offset-2 hover:text-foreground">
                    {step.hrefLabel}
                  </Link>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
