"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FUNDING_AWARD_MATCH_POSTURE_OPTIONS,
  FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS,
  FUNDING_AWARD_RISK_FLAG_OPTIONS,
} from "@/lib/programs/catalog";

/**
 * "Fully spent" is deliberately absent from the spending-status select here.
 *
 * It was on it, and picking it created an award that was already closed: no
 * invoice-coverage check, no close-out milestone, no RTP posture rebuild — the
 * whole close-out contract skipped at birth. A new award cannot have earned a
 * close-out in any case, because invoices link to an award by id and a record
 * that does not exist yet has coverage of exactly zero.
 *
 * What replaces it is the checkbox below. A workspace importing awards that
 * closed years ago has a real need to say so, and that need is served by an
 * explicit act with a written basis — which the API audits under its own event
 * and stamps on the row as an imported closure — rather than by a value in a
 * dropdown that looks identical to a close-out this product verified.
 */
function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function ProjectFundingAwardCreator({
  projectId,
  opportunityOptions,
  defaultOpportunityId,
  defaultProgramId,
  defaultTitle,
  titleLabel = "Add awarded funding",
  description,
}: {
  projectId: string;
  opportunityOptions: Array<{ id: string; title: string }>;
  defaultOpportunityId?: string | null;
  defaultProgramId?: string | null;
  defaultTitle?: string;
  titleLabel?: string;
  description?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [opportunityId, setOpportunityId] = useState(defaultOpportunityId ?? "");
  const [awardedAmount, setAwardedAmount] = useState("");
  const [matchAmount, setMatchAmount] = useState("");
  const [matchPosture, setMatchPosture] = useState<(typeof FUNDING_AWARD_MATCH_POSTURE_OPTIONS)[number]["value"]>("partial");
  const [obligationDueAt, setObligationDueAt] = useState("");
  const [expenditureDeadlineAt, setExpenditureDeadlineAt] = useState("");
  const [spendingStatus, setSpendingStatus] = useState<(typeof FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS)[number]["value"]>("not_started");
  const [riskFlag, setRiskFlag] = useState<(typeof FUNDING_AWARD_RISK_FLAG_OPTIONS)[number]["value"]>("none");
  const [notes, setNotes] = useState("");
  const [isAlreadyClosed, setIsAlreadyClosed] = useState(false);
  const [closureNote, setClosureNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedClosureNote = closureNote.trim();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    // Checked here as well as at the API because the API's refusal would be a
    // generic payload rejection, and the person filling this in needs to be told
    // which box is empty. The server remains the authority; this is not a
    // substitute for it.
    if (isAlreadyClosed && !trimmedClosureNote) {
      setError(
        "Recording an award as already closed needs a written basis — what closed it, and on whose record."
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/funding-awards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          opportunityId: opportunityId || undefined,
          programId: defaultProgramId || undefined,
          title,
          awardedAmount: awardedAmount ? Number(awardedAmount) : 0,
          matchAmount: matchAmount ? Number(matchAmount) : 0,
          matchPosture,
          obligationDueAt: toIsoDateTime(obligationDueAt),
          expenditureDeadlineAt: toIsoDateTime(expenditureDeadlineAt),
          // The two are mutually exclusive at the API — sending both is a 400,
          // because they are two statements about the same field.
          spendingStatus: isAlreadyClosed ? undefined : spendingStatus,
          recordClosedOnImport: isAlreadyClosed ? { note: trimmedClosureNote } : undefined,
          riskFlag,
          notes: notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        // The API's `details` carries the specific reason and, on the refusals
        // that have one, the way through. Dropping it would leave a planner with
        // a headline and no next step.
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" ") || "Failed to create funding award"
        );
      }

      const savedAsImportedClosure = isAlreadyClosed;

      setTitle(defaultTitle ?? "");
      setOpportunityId(defaultOpportunityId ?? "");
      setAwardedAmount("");
      setMatchAmount("");
      setMatchPosture("partial");
      setObligationDueAt("");
      setExpenditureDeadlineAt("");
      setSpendingStatus("not_started");
      setRiskFlag("none");
      setNotes("");
      setIsAlreadyClosed(false);
      setClosureNote("");
      setMessage(
        savedAsImportedClosure
          ? "Funding award saved and recorded as closed on your statement. No invoice coverage was checked, and it will read as an imported closure wherever it is shown."
          : "Funding award saved."
      );
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create funding award");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <BadgeDollarSign className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Award record</p>
          <h3 className="text-sm font-semibold text-foreground">{titleLabel}</h3>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Title</label>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Cycle 8 ATP award" required />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Linked opportunity</label>
            <select
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={opportunityId}
              onChange={(event) => setOpportunityId(event.target.value)}
            >
              <option value="">No linked opportunity</option>
              {opportunityOptions.map((opportunity) => (
                <option key={opportunity.id} value={opportunity.id}>
                  {opportunity.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              htmlFor="funding-award-obligation-due"
            >
              Obligation due
            </label>
            <Input
              id="funding-award-obligation-due"
              type="datetime-local"
              value={obligationDueAt}
              onChange={(event) => setObligationDueAt(event.target.value)}
            />
          </div>
        </div>

        {/*
          THE TWO AWARD DEADLINES ARE NOT THE SAME DEADLINE, and the field is
          labelled to say so. Obligating is committing the money; expending is
          spending it, and the expenditure date is the one that loses an agency
          its funds. Both are optional and neither is ever filled in by OpenPlan:
          a lapse date it derived from a program name would be a date somebody
          plans around and nobody agreed to.
        */}
        <div className="space-y-1.5">
          <label
            className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="funding-award-expenditure-deadline"
          >
            Expenditure deadline (funds lapse)
          </label>
          <Input
            id="funding-award-expenditure-deadline"
            type="datetime-local"
            value={expenditureDeadlineAt}
            onChange={(event) => setExpenditureDeadlineAt(event.target.value)}
            aria-describedby="funding-award-expenditure-deadline-help"
          />
          <p id="funding-award-expenditure-deadline-help" className="text-xs text-muted-foreground">
            The date the funds must be spent by, if your agreement sets one — separate from the
            obligation date above. Recording it turns on a daily reminder that names what is still
            unclaimed on this award. Leave it blank if your agreement does not set one.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Awarded amount</label>
            <Input value={awardedAmount} onChange={(event) => setAwardedAmount(event.target.value)} inputMode="decimal" placeholder="1750000" required />
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Match amount</label>
            <Input value={matchAmount} onChange={(event) => setMatchAmount(event.target.value)} inputMode="decimal" placeholder="250000" />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Local match status</label>
            <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35" value={matchPosture} onChange={(event) => setMatchPosture(event.target.value as (typeof FUNDING_AWARD_MATCH_POSTURE_OPTIONS)[number]["value"])}>
              {FUNDING_AWARD_MATCH_POSTURE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground" htmlFor="funding-award-spending-status">Spending status</label>
            <select
              id="funding-award-spending-status"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35 disabled:cursor-not-allowed disabled:opacity-60"
              value={spendingStatus}
              disabled={isAlreadyClosed}
              onChange={(event) => setSpendingStatus(event.target.value as (typeof FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS)[number]["value"])}
            >
              {FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {isAlreadyClosed ? (
              <p className="text-xs text-muted-foreground">
                Not used — this award is being recorded as already closed below.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Risk flag</label>
            <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35" value={riskFlag} onChange={(event) => setRiskFlag(event.target.value as (typeof FUNDING_AWARD_RISK_FLAG_OPTIONS)[number]["value"])}>
              {FUNDING_AWARD_RISK_FLAG_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</label>
          <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Award terms, obligation risks, how and when you get reimbursed, or scope notes." />
        </div>

        <div className="rounded-[0.5rem] border border-border/60 bg-muted/15 px-3 py-3">
          <label className="flex items-start gap-2.5 text-sm" htmlFor="funding-award-already-closed">
            <input
              id="funding-award-already-closed"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={isAlreadyClosed}
              onChange={(event) => {
                setIsAlreadyClosed(event.target.checked);
                if (!event.target.checked) setClosureNote("");
              }}
            />
            <span>
              <span className="font-semibold">This award closed before it was recorded here.</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                For historical awards whose reimbursements were never invoiced through OpenPlan. The award
                is marked fully spent on your statement — no invoice coverage is checked and no close-out
                milestone is filed — and it is labelled an imported closure everywhere it appears, so it is
                never mistaken for a close-out this product verified.
              </span>
            </span>
          </label>

          {isAlreadyClosed ? (
            <div className="mt-3 space-y-1.5">
              <label
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                htmlFor="funding-award-closure-basis"
              >
                Basis for the closure (required)
              </label>
              <Textarea
                id="funding-award-closure-basis"
                rows={2}
                maxLength={2000}
                value={closureNote}
                onChange={(event) => setClosureNote(event.target.value)}
                placeholder="What closed this award, and where the record of it lives."
                aria-describedby="funding-award-closure-basis-help"
              />
              <p id="funding-award-closure-basis-help" className="text-xs text-muted-foreground">
                {/*
                  Required, not optional-with-a-generated-default. A default
                  sentence written by OpenPlan would be a statement about someone
                  else's money that nobody made, attributed to whoever saved the
                  form.
                */}
                Stored on the award and shown to anyone reading its closure. This is the only way to close
                an award without paid invoices covering it, so the record has to say on what authority.
              </p>
            </div>
          ) : null}
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeDollarSign className="h-4 w-4" />}
          Save award
        </Button>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </article>
  );
}
