"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FUNDING_AWARD_MATCH_POSTURE_OPTIONS,
  FUNDING_AWARD_RISK_FLAG_OPTIONS,
  FUNDING_AWARD_SPENDING_STATUS_OPTIONS,
} from "@/lib/programs/catalog";

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
  const [spendingStatus, setSpendingStatus] = useState<(typeof FUNDING_AWARD_SPENDING_STATUS_OPTIONS)[number]["value"]>("not_started");
  const [riskFlag, setRiskFlag] = useState<(typeof FUNDING_AWARD_RISK_FLAG_OPTIONS)[number]["value"]>("none");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
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
          spendingStatus,
          riskFlag,
          notes: notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create funding award");
      }

      setTitle(defaultTitle ?? "");
      setOpportunityId(defaultOpportunityId ?? "");
      setAwardedAmount("");
      setMatchAmount("");
      setMatchPosture("partial");
      setObligationDueAt("");
      setSpendingStatus("not_started");
      setRiskFlag("none");
      setNotes("");
      setMessage("Funding award saved.");
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
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Obligation due</label>
            <Input type="datetime-local" value={obligationDueAt} onChange={(event) => setObligationDueAt(event.target.value)} />
          </div>
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
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Match posture</label>
            <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35" value={matchPosture} onChange={(event) => setMatchPosture(event.target.value as (typeof FUNDING_AWARD_MATCH_POSTURE_OPTIONS)[number]["value"])}>
              {FUNDING_AWARD_MATCH_POSTURE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Spending status</label>
            <select className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35" value={spendingStatus} onChange={(event) => setSpendingStatus(event.target.value as (typeof FUNDING_AWARD_SPENDING_STATUS_OPTIONS)[number]["value"])}>
              {FUNDING_AWARD_SPENDING_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
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
          <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Award terms, obligation risks, reimbursement posture, or scope notes." />
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
