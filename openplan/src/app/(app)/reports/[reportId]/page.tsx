import { notFound, redirect } from "next/navigation";
import {
  Clock3,
  FileOutput,
  Hash,
  Link2,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import {
  formatDateTime,
  formatReportStatusLabel,
  formatReportTypeLabel,
  reportStatusTone,
  titleize,
} from "@/lib/reports/catalog";
import { extractEngagementCampaignId } from "@/lib/reports/engagement";

type RouteParams = {
  params: Promise<{ reportId: string }>;
};

type ReportArtifact = {
  id: string;
  artifact_kind: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type LinkedRunRow = {
  id: string;
  title: string;
  summary_text: string | null;
  created_at: string;
};

type EngagementCampaignLinkRow = {
  id: string;
  title: string;
  summary: string | null;
  public_description: string | null;
  status: string;
  engagement_type: string;
  share_token: string | null;
  allow_public_submissions: boolean;
  submissions_closed_at: string | null;
  updated_at: string;
};

function asHtmlContent(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  return typeof metadata.htmlContent === "string"
    ? metadata.htmlContent
    : null;
}

function asRunAudit(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || !Array.isArray(metadata.runAudit)) {
    return [];
  }

  return metadata.runAudit.filter(
    (
      item
    ): item is {
      runId: string;
      gate: { decision: string; missingArtifacts: string[] };
    } => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const record = item as Record<string, unknown>;
      const gate = record.gate;

      return (
        typeof record.runId === "string" &&
        Boolean(gate) &&
        typeof gate === "object"
      );
    }
  );
}

function asSourceContext(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return null;
  const sourceContext = metadata.sourceContext;
  if (!sourceContext || typeof sourceContext !== "object") {
    return null;
  }

  return sourceContext as Record<string, unknown>;
}

export default async function ReportDetailPage({ params }: RouteParams) {
  const { reportId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: report } = await supabase
    .from("reports")
    .select(
      "id, workspace_id, project_id, title, report_type, status, summary, generated_at, latest_artifact_url, latest_artifact_kind, created_at, updated_at"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    notFound();
  }

  const [
    { data: project },
    { data: workspace },
    { data: sections },
    { data: reportRunLinks },
    { data: artifacts },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at"
      )
      .eq("id", report.project_id)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("id, name, plan, slug")
      .eq("id", report.workspace_id)
      .maybeSingle(),
    supabase
      .from("report_sections")
      .select("id, section_key, title, enabled, sort_order, config_json")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_runs")
      .select("id, run_id, sort_order")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_artifacts")
      .select("id, artifact_kind, generated_at, metadata_json")
      .eq("report_id", report.id)
      .order("generated_at", { ascending: false }),
  ]);

  const runIds = (reportRunLinks ?? []).map((item) => item.run_id);
  const runsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at")
        .in("id", runIds)
    : { data: [], error: null };

  const sectionList = sections ?? [];
  const engagementCampaignId = extractEngagementCampaignId(sectionList);
  const engagementCampaignResult = engagementCampaignId
    ? await supabase
        .from("engagement_campaigns")
        .select(
          "id, title, summary, public_description, status, engagement_type, share_token, allow_public_submissions, submissions_closed_at, updated_at"
        )
        .eq("workspace_id", report.workspace_id)
        .eq("id", engagementCampaignId)
        .maybeSingle()
    : { data: null, error: null };

  const runMap = new Map(
    (runsResult.data ?? []).map((run) => [run.id, run])
  );
  const runs = (reportRunLinks ?? [])
    .map((link) => runMap.get(link.run_id) ?? null)
    .filter((item): item is LinkedRunRow => Boolean(item));

  const latestArtifact = ((artifacts ?? []) as ReportArtifact[])[0] ?? null;
  const latestHtml = asHtmlContent(latestArtifact?.metadata_json);
  const runAudit = asRunAudit(latestArtifact?.metadata_json);
  const sourceContext = asSourceContext(latestArtifact?.metadata_json);
  const engagementCampaign =
    (engagementCampaignResult.data as EngagementCampaignLinkRow | null) ?? null;
  const engagementPublicHref =
    engagementCampaign?.share_token && engagementCampaign.status === "active"
      ? `/engage/${engagementCampaign.share_token}`
      : null;
  const engagementSummaryText =
    engagementCampaign?.public_description ||
    engagementCampaign?.summary ||
    null;
  const artifactList = (artifacts ?? []) as ReportArtifact[];
  const enabledSections = sectionList.filter((s) => s.enabled).length;
  const runTitleById = new Map(runs.map((run) => [run.id, run.title]));

  return (
    <section className="space-y-6">
      {/* ── Hero row ─────────────────────────────────────────── */}
      <header className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        {/* Left: report identity */}
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] sm:p-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">
            <ScrollText className="h-3.5 w-3.5" />
            Report detail
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {report.title}
          </h1>
          <p className="mt-3 max-w-3xl text-[0.9rem] leading-relaxed text-muted-foreground sm:text-base">
            {report.summary ||
              "No summary provided. Use the controls to describe this report\u2019s purpose and generate an HTML packet."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <StatusBadge tone={reportStatusTone(report.status)}>
              {formatReportStatusLabel(report.status)}
            </StatusBadge>
            <StatusBadge tone="info">
              {formatReportTypeLabel(report.report_type)}
            </StatusBadge>
            {report.latest_artifact_kind ? (
              <StatusBadge tone="neutral">
                {report.latest_artifact_kind.toUpperCase()}
              </StatusBadge>
            ) : null}
          </div>

          {/* Stat tiles */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Project
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">
                {project?.name ?? "Unknown"}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Workspace
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground">
                {workspace?.name ?? "Unknown"}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Linked runs
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {runs.length}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Generated
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {report.generated_at
                  ? formatDateTime(report.generated_at)
                  : "Not yet"}
              </p>
            </div>
          </div>

          {/* Timestamps */}
          <div className="mt-4 flex flex-wrap gap-1.5 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
              Created {formatDateTime(report.created_at)}
            </span>
            <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
              Updated {formatDateTime(report.updated_at)}
            </span>
            {project?.updated_at ? (
              <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
                Project snapshot {formatDateTime(project.updated_at)}
              </span>
            ) : null}
          </div>
        </article>

        {/* Right: controls */}
        <ReportDetailControls
          report={{
            id: report.id,
            title: report.title,
            summary: report.summary,
            status: report.status,
            hasGeneratedArtifact: Boolean(report.latest_artifact_kind),
          }}
        />
      </header>

      {/* ── Composition + provenance row ─────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        {/* Left: packet composition */}
        <article className="space-y-6 rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          {/* Sections */}
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Composition
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Packet sections
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {enabledSections}/{sectionList.length} enabled
                  </span>
                </h2>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {sectionList.map((section, index) => (
                <div
                  key={section.id}
                  className="flex items-center gap-3 rounded-[18px] border border-border/80 bg-background/80 px-4 py-3 transition-colors"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-[0.7rem] font-semibold tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold tracking-tight">
                      {section.title}
                    </h3>
                    <p className="text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                      {titleize(section.section_key)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={section.enabled ? "success" : "neutral"}
                    className="shrink-0"
                  >
                    {section.enabled ? "Enabled" : "Hidden"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>

          {/* Linked runs */}
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <Hash className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Source data
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Linked runs
                </h2>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {runs.length === 0 ? (
                <EmptyState
                  title="No linked runs"
                  description="Attach analysis runs when creating a report to include their results in the generated packet."
                  compact
                />
              ) : (
                runs.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                  >
                    <h4 className="text-sm font-semibold tracking-tight">
                      {run.title}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-[0.82rem] leading-relaxed text-muted-foreground">
                      {run.summary_text || "No run summary available."}
                    </p>
                    <p className="mt-2 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                      Created {formatDateTime(run.created_at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Artifact history */}
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--copper)]/10 text-[color:var(--copper)]">
                <Clock3 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  History
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Generated artifacts
                </h2>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {artifactList.length === 0 ? (
                <EmptyState
                  title="No artifacts yet"
                  description="Use the generation control to produce the first HTML packet for this report."
                  compact
                />
              ) : (
                artifactList.map((artifact) => (
                  <div
                    id={`artifact-${artifact.id}`}
                    key={artifact.id}
                    className="flex items-center justify-between gap-3 rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold tracking-tight">
                        {artifact.artifact_kind.toUpperCase()} artifact
                      </h4>
                      <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                        Generated {formatDateTime(artifact.generated_at)}
                      </p>
                    </div>
                    <StatusBadge tone="info" className="shrink-0">
                      {artifact.id.slice(0, 8)}
                    </StatusBadge>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>

        {/* Right column */}
        <div className="space-y-6">
          {/* Provenance / audit trail */}
          <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Provenance
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Audit trail
                </h2>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              <p className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                Generated artifacts include run-level audit metadata so every
                packet can be traced back to its source analysis and reviewed
                for completeness.
              </p>
              {runAudit.length === 0 ? (
                <EmptyState
                  title="No audit data yet"
                  description="Generate the report to capture linked-run transparency notes and artifact gate decisions."
                  compact
                />
              ) : (
                runAudit.map((item) => (
                  <div
                    key={item.runId}
                    className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">
                          {runTitleById.get(item.runId) ?? `Run ${item.runId.slice(0, 8)}`}
                        </h3>
                        <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                          Gate decision: {item.gate.decision}
                        </p>
                      </div>
                      <StatusBadge
                        tone={
                          item.gate.decision === "PASS"
                            ? "success"
                            : "warning"
                        }
                      >
                        {item.gate.decision}
                      </StatusBadge>
                    </div>
                    {item.gate.missingArtifacts.length > 0 ? (
                      <ul className="mt-3 space-y-1.5">
                        {item.gate.missingArtifacts.map(
                          (missingArtifact) => (
                            <li
                              key={missingArtifact}
                              className="rounded-xl border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground"
                            >
                              {missingArtifact}
                            </li>
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="mt-2.5 text-sm text-muted-foreground">
                        All required artifacts were present for this run.
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
            {sourceContext || engagementCampaign ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Linked evidence
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {String(sourceContext?.linkedRunCount ?? runs.length)} runs,{" "}
                    {String(sourceContext?.deliverableCount ?? 0)} deliverables,{" "}
                    {String(sourceContext?.decisionCount ?? 0)} decisions
                  </p>
                </div>
                <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Source snapshot
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {formatDateTime(
                      typeof sourceContext?.projectUpdatedAt === "string"
                        ? sourceContext.projectUpdatedAt
                        : project?.updated_at ?? null
                    )}
                  </p>
                </div>
                {engagementCampaign ? (
                  <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3 sm:col-span-2 xl:col-span-1">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Engagement source
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {engagementCampaign.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {titleize(engagementCampaign.status)} · {titleize(engagementCampaign.engagement_type)} · {String(sourceContext?.engagementReadyForHandoffCount ?? 0)} ready for handoff · {String(sourceContext?.engagementItemCount ?? 0)} items
                    </p>
                    {engagementSummaryText ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {engagementSummaryText}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated {formatDateTime(engagementCampaign.updated_at)} · {engagementPublicHref ? "Public page available" : "Public page unavailable"}
                      {engagementCampaign.allow_public_submissions
                        ? engagementCampaign.submissions_closed_at
                          ? " · Submissions closed"
                          : " · Submissions open"
                        : " · Public submissions disabled"}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>

          {/* Related links */}
          <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
                <Link2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Navigation
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Related surfaces
                </h2>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {project ? (
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                >
                  <FileOutput className="h-4 w-4" />
                  Open project
                </Link>
              ) : null}
              {engagementCampaign ? (
                <Link
                  href={`/engagement/${engagementCampaign.id}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                >
                  <Link2 className="h-4 w-4" />
                  Open engagement campaign
                </Link>
              ) : null}
              {engagementPublicHref ? (
                <Link
                  href={engagementPublicHref}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                >
                  <Link2 className="h-4 w-4" />
                  Open public engagement page
                </Link>
              ) : null}
              <Link
                href="/reports"
                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
              >
                <ScrollText className="h-4 w-4" />
                Back to catalog
              </Link>
            </div>
          </article>

          {/* HTML preview */}
          {latestHtml ? (
            <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Preview
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Latest HTML artifact
                  </h2>
                </div>
                {latestArtifact ? (
                  <StatusBadge tone="info">
                    {formatDateTime(latestArtifact.generated_at)}
                  </StatusBadge>
                ) : null}
              </div>
              <div className="mt-5 overflow-hidden rounded-[18px] border border-border/70 bg-white shadow-inner">
                <iframe
                  title="Latest report artifact preview"
                  className="h-[900px] w-full"
                  sandbox=""
                  srcDoc={latestHtml}
                />
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}
