"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FUNDING_OPPORTUNITY_STATUS_OPTIONS } from "@/lib/programs/catalog";

type ProgramOption = {
  id: string;
  title: string;
};

type ProjectOption = {
  id: string;
  name: string;
};

function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function FundingOpportunityCreator({
  programs,
  projects,
  defaultProgramId,
  defaultProjectId,
  title = "New funding opportunity",
  description = "Capture active and upcoming grant or formula opportunities without waiting for a full grant OS rewrite.",
}: {
  programs: ProgramOption[];
  projects: ProjectOption[];
  defaultProgramId?: string | null;
  defaultProjectId?: string | null;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [programId, setProgramId] = useState(defaultProgramId ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [opportunityTitle, setOpportunityTitle] = useState("");
  const [status, setStatus] = useState<(typeof FUNDING_OPPORTUNITY_STATUS_OPTIONS)[number]["value"]>("upcoming");
  const [agencyName, setAgencyName] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [cadenceLabel, setCadenceLabel] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [decisionDueAt, setDecisionDueAt] = useState("");
  const [summary, setSummary] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/funding-opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          programId: programId || undefined,
          projectId: projectId || undefined,
          title: opportunityTitle,
          status,
          agencyName: agencyName || undefined,
          ownerLabel: ownerLabel || undefined,
          cadenceLabel: cadenceLabel || undefined,
          opensAt: toIsoDateTime(opensAt),
          closesAt: toIsoDateTime(closesAt),
          decisionDueAt: toIsoDateTime(decisionDueAt),
          summary: summary || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create funding opportunity");
      }

      setOpportunityTitle("");
      setStatus("upcoming");
      setAgencyName("");
      setOwnerLabel("");
      setCadenceLabel("");
      setOpensAt("");
      setClosesAt("");
      setDecisionDueAt("");
      setSummary("");
      if (!defaultProgramId) setProgramId("");
      if (!defaultProjectId) setProjectId("");
      setMessage("Funding opportunity saved.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create funding opportunity");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Funding</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{description}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <CalendarPlus2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="funding-opportunity-title" className="text-[0.82rem] font-semibold">
            Opportunity title
          </label>
          <Input
            id="funding-opportunity-title"
            placeholder="2027 ATP Cycle 8 countywide active transportation call"
            value={opportunityTitle}
            onChange={(event) => setOpportunityTitle(event.target.value)}
            required
          />
        </div>

        {defaultProgramId ? null : (
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-program" className="text-[0.82rem] font-semibold">
              Funding program
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <select
              id="funding-opportunity-program"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={programId}
              onChange={(event) => setProgramId(event.target.value)}
            >
              <option value="">No linked program</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-project" className="text-[0.82rem] font-semibold">
              Linked project
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <select
              id="funding-opportunity-project"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">No linked project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="funding-opportunity-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as (typeof FUNDING_OPPORTUNITY_STATUS_OPTIONS)[number]["value"])
              }
            >
              {FUNDING_OPPORTUNITY_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-agency" className="text-[0.82rem] font-semibold">
              Agency
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="funding-opportunity-agency"
              placeholder="Caltrans / CTC"
              value={agencyName}
              onChange={(event) => setAgencyName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-owner" className="text-[0.82rem] font-semibold">
              Owner
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="funding-opportunity-owner"
              placeholder="Grant lead"
              value={ownerLabel}
              onChange={(event) => setOwnerLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-cadence" className="text-[0.82rem] font-semibold">
              Cadence
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="funding-opportunity-cadence"
              placeholder="Annual cycle"
              value={cadenceLabel}
              onChange={(event) => setCadenceLabel(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-opens" className="text-[0.82rem] font-semibold">
              Opens
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input id="funding-opportunity-opens" type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-closes" className="text-[0.82rem] font-semibold">
              Closes
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input id="funding-opportunity-closes" type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="funding-opportunity-decision" className="text-[0.82rem] font-semibold">
              Decision due
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="funding-opportunity-decision"
              type="datetime-local"
              value={decisionDueAt}
              onChange={(event) => setDecisionDueAt(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="funding-opportunity-summary" className="text-[0.82rem] font-semibold">
            Summary
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="funding-opportunity-summary"
            rows={4}
            placeholder="What this opportunity funds, why it matters now, and any immediate package posture notes."
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus2 className="h-4 w-4" />}
          Save funding opportunity
        </Button>

        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </article>
  );
}
