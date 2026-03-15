"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PROGRAM_STATUS_OPTIONS, PROGRAM_TYPE_OPTIONS } from "@/lib/programs/catalog";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type CreateResponse = {
  programId: string;
  error?: string;
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function ProgramCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [programType, setProgramType] = useState<(typeof PROGRAM_TYPE_OPTIONS)[number]["value"]>("rtip");
  const [status, setStatus] = useState<(typeof PROGRAM_STATUS_OPTIONS)[number]["value"]>("draft");
  const [cycleName, setCycleName] = useState("");
  const [sponsorAgency, setSponsorAgency] = useState("");
  const [fiscalYearStart, setFiscalYearStart] = useState("");
  const [fiscalYearEnd, setFiscalYearEnd] = useState("");
  const [nominationDueAt, setNominationDueAt] = useState("");
  const [adoptionTargetAt, setAdoptionTargetAt] = useState("");
  const [summary, setSummary] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/programs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projectId || undefined,
          title,
          programType,
          status,
          cycleName,
          sponsorAgency: sponsorAgency || undefined,
          fiscalYearStart: fiscalYearStart ? Number(fiscalYearStart) : undefined,
          fiscalYearEnd: fiscalYearEnd ? Number(fiscalYearEnd) : undefined,
          nominationDueAt: toIsoDateTime(nominationDueAt),
          adoptionTargetAt: toIsoDateTime(adoptionTargetAt),
          summary: summary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create program");
      }

      router.refresh();
      router.push(`/programs/${payload.programId}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create program");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New programming cycle record</h2>
          <p className="module-section-description">
            Register the funding cycle, package timing, and primary project now. Use the detail page to attach plans,
            reports, and engagement evidence without pretending the packet is already authored in-app.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <ClipboardPlus className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="program-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input
            id="program-title"
            placeholder="2027 RTIP Downtown active transportation package"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-cycle" className="text-[0.82rem] font-semibold">
              Cycle label
            </label>
            <Input
              id="program-cycle"
              placeholder="2027 RTIP"
              value={cycleName}
              onChange={(event) => setCycleName(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-sponsor" className="text-[0.82rem] font-semibold">
              Sponsor agency
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="program-sponsor"
              placeholder="Nevada County Transportation Commission"
              value={sponsorAgency}
              onChange={(event) => setSponsorAgency(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-type" className="text-[0.82rem] font-semibold">
              Program lane
            </label>
            <select
              id="program-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={programType}
              onChange={(event) => setProgramType(event.target.value as (typeof PROGRAM_TYPE_OPTIONS)[number]["value"])}
            >
              {PROGRAM_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="program-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof PROGRAM_STATUS_OPTIONS)[number]["value"])}
            >
              {PROGRAM_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="program-project" className="text-[0.82rem] font-semibold">
            Primary project
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <select
            id="program-project"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No primary project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-fy-start" className="text-[0.82rem] font-semibold">
              Fiscal year start
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="program-fy-start"
              type="number"
              min={2000}
              max={2300}
              placeholder="2027"
              value={fiscalYearStart}
              onChange={(event) => setFiscalYearStart(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-fy-end" className="text-[0.82rem] font-semibold">
              Fiscal year end
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="program-fy-end"
              type="number"
              min={2000}
              max={2300}
              placeholder="2030"
              value={fiscalYearEnd}
              onChange={(event) => setFiscalYearEnd(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-nomination" className="text-[0.82rem] font-semibold">
              Nomination due
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="program-nomination"
              type="datetime-local"
              value={nominationDueAt}
              onChange={(event) => setNominationDueAt(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-adoption" className="text-[0.82rem] font-semibold">
              Adoption target
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="program-adoption"
              type="datetime-local"
              value={adoptionTargetAt}
              onChange={(event) => setAdoptionTargetAt(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="program-summary" className="text-[0.82rem] font-semibold">
            Summary
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="program-summary"
            rows={4}
            placeholder="Describe the package intent, readiness posture, and what planning basis or public record should support it."
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        <FormError error={error} />

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create program record
        </Button>
      </form>
    </article>
  );
}
