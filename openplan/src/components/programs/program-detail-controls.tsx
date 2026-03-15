"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PROGRAM_STATUS_OPTIONS, PROGRAM_TYPE_OPTIONS } from "@/lib/programs/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type RecordOption = {
  id: string;
  title: string;
};

type ProgramDetailControlsProps = {
  program: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    program_type: string;
    cycle_name: string;
    project_id: string | null;
    sponsor_agency: string | null;
    fiscal_year_start: number | null;
    fiscal_year_end: number | null;
    nomination_due_at: string | null;
    adoption_target_at: string | null;
  };
  projects: ProjectOption[];
  plans: RecordOption[];
  reports: RecordOption[];
  engagementCampaigns: RecordOption[];
  selectedLinks: {
    plans: string[];
    reports: string[];
    engagementCampaigns: string[];
    relatedProjects: string[];
  };
};

function toLocalDateTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromLocalDateTimeValue(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readSelectedIds(event: React.ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

export function ProgramDetailControls({
  program,
  projects,
  plans,
  reports,
  engagementCampaigns,
  selectedLinks,
}: ProgramDetailControlsProps) {
  const router = useRouter();
  const [title, setTitle] = useState(program.title);
  const [summary, setSummary] = useState(program.summary ?? "");
  const [status, setStatus] = useState(program.status);
  const [programType, setProgramType] = useState(program.program_type);
  const [cycleName, setCycleName] = useState(program.cycle_name);
  const [projectId, setProjectId] = useState(program.project_id ?? "");
  const [sponsorAgency, setSponsorAgency] = useState(program.sponsor_agency ?? "");
  const [fiscalYearStart, setFiscalYearStart] = useState(
    program.fiscal_year_start ? String(program.fiscal_year_start) : ""
  );
  const [fiscalYearEnd, setFiscalYearEnd] = useState(program.fiscal_year_end ? String(program.fiscal_year_end) : "");
  const [nominationDueAt, setNominationDueAt] = useState(toLocalDateTimeValue(program.nomination_due_at));
  const [adoptionTargetAt, setAdoptionTargetAt] = useState(toLocalDateTimeValue(program.adoption_target_at));
  const [linkedPlanIds, setLinkedPlanIds] = useState<string[]>(selectedLinks.plans);
  const [linkedReportIds, setLinkedReportIds] = useState<string[]>(selectedLinks.reports);
  const [linkedCampaignIds, setLinkedCampaignIds] = useState<string[]>(selectedLinks.engagementCampaigns);
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>(selectedLinks.relatedProjects);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/programs/${program.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary.trim() ? summary.trim() : null,
          status,
          programType,
          cycleName,
          projectId: projectId || null,
          sponsorAgency: sponsorAgency.trim() ? sponsorAgency.trim() : null,
          fiscalYearStart: fiscalYearStart ? Number(fiscalYearStart) : null,
          fiscalYearEnd: fiscalYearEnd ? Number(fiscalYearEnd) : null,
          nominationDueAt: fromLocalDateTimeValue(nominationDueAt),
          adoptionTargetAt: fromLocalDateTimeValue(adoptionTargetAt),
          links: [
            ...linkedPlanIds.map((linkedId) => ({ linkType: "plan", linkedId })),
            ...linkedReportIds.map((linkedId) => ({ linkType: "report", linkedId })),
            ...linkedCampaignIds.map((linkedId) => ({ linkType: "engagement_campaign", linkedId })),
            ...linkedProjectIds
              .filter((linkedId) => linkedId !== projectId)
              .map((linkedId) => ({ linkType: "project_record", linkedId })),
          ],
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update program");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update program");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Controls</p>
          <h2 className="module-section-title">Programming record workflow</h2>
          <p className="module-section-description">
            Keep the cycle metadata and record linkages current. This is explicitly about package readiness, not packet
            prose editing.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="program-control-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input id="program-control-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-control-cycle" className="text-[0.82rem] font-semibold">
              Cycle label
            </label>
            <Input id="program-control-cycle" value={cycleName} onChange={(event) => setCycleName(event.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-control-sponsor" className="text-[0.82rem] font-semibold">
              Sponsor agency
            </label>
            <Input
              id="program-control-sponsor"
              value={sponsorAgency}
              onChange={(event) => setSponsorAgency(event.target.value)}
              placeholder="Agency or MPO lead"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-control-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="program-control-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {PROGRAM_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-control-type" className="text-[0.82rem] font-semibold">
              Program lane
            </label>
            <select
              id="program-control-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={programType}
              onChange={(event) => setProgramType(event.target.value)}
            >
              {PROGRAM_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="program-control-project" className="text-[0.82rem] font-semibold">
            Primary project
          </label>
          <select
            id="program-control-project"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No primary project</option>
            {projects.map((projectOption) => (
              <option key={projectOption.id} value={projectOption.id}>
                {projectOption.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-control-fy-start" className="text-[0.82rem] font-semibold">
              Fiscal year start
            </label>
            <Input
              id="program-control-fy-start"
              type="number"
              min={2000}
              max={2300}
              value={fiscalYearStart}
              onChange={(event) => setFiscalYearStart(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-control-fy-end" className="text-[0.82rem] font-semibold">
              Fiscal year end
            </label>
            <Input
              id="program-control-fy-end"
              type="number"
              min={2000}
              max={2300}
              value={fiscalYearEnd}
              onChange={(event) => setFiscalYearEnd(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-control-nomination" className="text-[0.82rem] font-semibold">
              Nomination due
            </label>
            <Input
              id="program-control-nomination"
              type="datetime-local"
              value={nominationDueAt}
              onChange={(event) => setNominationDueAt(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-control-adoption" className="text-[0.82rem] font-semibold">
              Adoption target
            </label>
            <Input
              id="program-control-adoption"
              type="datetime-local"
              value={adoptionTargetAt}
              onChange={(event) => setAdoptionTargetAt(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="program-control-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea
            id="program-control-summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Capture the package intent, cycle posture, and missing evidence plainly."
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-control-plans" className="text-[0.82rem] font-semibold">
              Linked plans
            </label>
            <select
              id="program-control-plans"
              multiple
              value={linkedPlanIds}
              onChange={(event) => setLinkedPlanIds(readSelectedIds(event))}
              className="min-h-32 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            >
              {plans.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-control-reports" className="text-[0.82rem] font-semibold">
              Linked reports
            </label>
            <select
              id="program-control-reports"
              multiple
              value={linkedReportIds}
              onChange={(event) => setLinkedReportIds(readSelectedIds(event))}
              className="min-h-32 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            >
              {reports.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="program-control-campaigns" className="text-[0.82rem] font-semibold">
              Linked engagement campaigns
            </label>
            <select
              id="program-control-campaigns"
              multiple
              value={linkedCampaignIds}
              onChange={(event) => setLinkedCampaignIds(readSelectedIds(event))}
              className="min-h-32 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            >
              {engagementCampaigns.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="program-control-project-links" className="text-[0.82rem] font-semibold">
              Additional related projects
            </label>
            <select
              id="program-control-project-links"
              multiple
              value={linkedProjectIds}
              onChange={(event) => setLinkedProjectIds(readSelectedIds(event))}
              className="min-h-32 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            >
              {projects.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Multi-select uses platform-native controls. Hold Command/Ctrl to keep multiple linked records selected.
        </p>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save program record
        </Button>
      </form>
    </article>
  );
}
