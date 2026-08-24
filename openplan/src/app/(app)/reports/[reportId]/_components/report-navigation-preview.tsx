import Link from "next/link";
import { Download, FileOutput, Link2, ScrollText } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { formatDateTime } from "@/lib/reports/catalog";
import type { EngagementCampaignLinkRow, ReportArtifact } from "./_types";

type Props = {
  reportId: string;
  projectId: string | null;
  engagementCampaign: EngagementCampaignLinkRow | null;
  engagementPublicHref: string | null;
  latestHtml: string | null;
  latestArtifact: ReportArtifact | null;
};

export function ReportNavigationPreview({
  reportId,
  projectId,
  engagementCampaign,
  engagementPublicHref,
  latestHtml,
  latestArtifact,
}: Props) {
  return (
    <>
      <article className="module-section-surface">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-slate-500/10 text-slate-700 dark:text-slate-300">
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
        <MetaList className="mt-4">
          {projectId ? (
            <MetaItem>
              <Link href={`/projects/${projectId}`} className="inline-flex items-center gap-2 transition hover:text-primary">
                <FileOutput className="h-4 w-4" />
                Open project
              </Link>
            </MetaItem>
          ) : null}
          {projectId ? (
            <MetaItem>
              <Link href={`/grants?focusProjectId=${projectId}#grants-awards-reimbursement`} className="inline-flex items-center gap-2 transition hover:text-primary">
                <Link2 className="h-4 w-4" />
                Open grants lane for this project
              </Link>
            </MetaItem>
          ) : null}
          {engagementCampaign ? (
            <MetaItem>
              <Link href={`/engagement/${engagementCampaign.id}`} className="inline-flex items-center gap-2 transition hover:text-primary">
                <Link2 className="h-4 w-4" />
                Open engagement campaign
              </Link>
            </MetaItem>
          ) : null}
          {engagementPublicHref ? (
            <MetaItem>
              <Link href={engagementPublicHref} className="inline-flex items-center gap-2 transition hover:text-primary">
                <Link2 className="h-4 w-4" />
                Open public engagement page
              </Link>
            </MetaItem>
          ) : null}
          <MetaItem>
            <Link href="/reports" className="inline-flex items-center gap-2 transition hover:text-primary">
              <ScrollText className="h-4 w-4" />
              Back to catalog
            </Link>
          </MetaItem>
        </MetaList>
      </article>

      {latestHtml || latestArtifact ? (
        <article className="module-section-surface">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Preview
              </p>
              <h2 className="text-xl font-semibold tracking-tight">
                Latest report preview
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {latestArtifact ? (
                <a
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition hover:bg-muted"
                  href={`/api/reports/${reportId}/artifacts/${latestArtifact.id}/download`}
                >
                  <Download className="h-4 w-4" />
                  Download {latestArtifact.artifact_kind.toUpperCase()}
                </a>
              ) : null}
              {latestArtifact ? <StatusBadge tone="info">{formatDateTime(latestArtifact.generated_at)}</StatusBadge> : null}
            </div>
          </div>
          {latestHtml ? (
            <div className="mt-5 overflow-hidden rounded-[0.5rem] border border-border/70 bg-white shadow-inner">
              <iframe
                title="Latest report artifact preview"
                className="h-[900px] w-full"
                // Scripts, forms, popups, and top navigation remain disabled.
                // Same-origin is needed only so private frozen-image requests can
                // carry the planner's session cookie to their authenticated route.
                sandbox="allow-same-origin"
                srcDoc={latestHtml}
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">This file has no in-page preview. Download it to read the report.</p>
          )}
        </article>
      ) : null}
    </>
  );
}
