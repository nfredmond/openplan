import Link from "next/link";
import { LandUsePlanReportPage } from "@/components/reports/land-use-plan-report-page";
import { EngagementReviewFiles } from "@/components/engagement/engagement-review-files";
import type { createClient } from "@/lib/supabase/server";

type Client = Pick<Awaited<ReturnType<typeof createClient>>, "from">;
type Report = {
  id: string;
  workspace_id: string;
  engagement_campaign_id?: string | null;
  title: string;
  summary: string | null;
};

// Only a retained export job selects this view. Older project reports may also
// cite a campaign, and still need their ordinary project report controls.
export async function loadEngagementReviewReportPage(client: Client, report: Report) {
  if (!report.engagement_campaign_id) return null;
  const job = await client.from("engagement_report_jobs")
    .select("id")
    .eq("report_id", report.id)
    .eq("campaign_id", report.engagement_campaign_id)
    .eq("workspace_id", report.workspace_id)
    .maybeSingle();
  if (job.error) {
    return <main className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-8">
      <h1 className="text-2xl font-semibold">This engagement report could not be read</h1>
      <p role="alert">The saved review record could not be loaded. Reload this page to try again.</p>
      <Link className="underline" href="/reports">Back to Reports</Link>
    </main>;
  }
  if (!job.data) return null;

  const campaign = await client.from("engagement_campaigns")
    .select("id, title, project_id")
    .eq("id", report.engagement_campaign_id)
    .eq("workspace_id", report.workspace_id)
    .maybeSingle();
  const project = !campaign.error && campaign.data?.project_id
    ? await client.from("projects").select("id, name")
      .eq("id", campaign.data.project_id)
      .eq("workspace_id", report.workspace_id)
      .maybeSingle()
    : null;

  return <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
    <header className="space-y-3 border-b pb-6">
      <p className="text-sm text-muted-foreground">Saved engagement review</p>
      <h1 className="break-words text-2xl font-semibold md:text-3xl">{report.title}</h1>
      {report.summary ? <p className="whitespace-pre-wrap">{report.summary}</p> : null}
      <p>The files below retain the consultation snapshot and selection saved for this report. Later campaign edits do not rewrite those files.</p>
      <nav aria-label="Report context" className="flex flex-wrap gap-4">
        <Link className="underline" href="/reports">Back to Reports</Link>
        {!campaign.error && campaign.data ? <Link className="underline" href={`/engagement/${campaign.data.id}?tab=record`}>Open campaign</Link> : null}
        {project && !project.error && project.data ? <Link className="underline" href={`/projects/${project.data.id}`}>Open project</Link> : null}
      </nav>
    </header>
    <section className="space-y-2" aria-label="Current campaign context">
      {campaign.error ? <p role="alert">Current campaign details could not be loaded. Reload to try again; retained file access is checked separately below.</p>
        : !campaign.data ? <p>The campaign is no longer available to this account.</p>
        : <p>Current campaign: <strong>{campaign.data.title}</strong></p>}
      {project?.error ? <p role="alert">Current project details could not be loaded. This does not change the saved report.</p>
        : project && !project.data ? <p>The linked project is no longer available to this account.</p>
        : project?.data ? <p>Current project: {project.data.name}</p> : null}
    </section>
    <EngagementReviewFiles campaignId={report.engagement_campaign_id} reportId={report.id} />
  </main>;
}

// Select the report's existing owner before the generic project report reads.
export async function loadSpecializedReportPage(client: Client, report: Report & Parameters<typeof LandUsePlanReportPage>[0]['report']) {
  if (report.land_use_plan_id) return <LandUsePlanReportPage report={report} />;
  return loadEngagementReviewReportPage(client, report);
}
