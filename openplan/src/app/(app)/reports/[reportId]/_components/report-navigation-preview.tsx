import Link from "next/link";
import { FileOutput, Link2, ScrollText } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { formatDateTime } from "@/lib/reports/catalog";
import type { EngagementCampaignLinkRow, ReportArtifact } from "./_types";

type Props = {
  projectId: string | null;
  engagementCampaign: EngagementCampaignLinkRow | null;
  engagementPublicHref: string | null;
  latestHtml: string | null;
  latestArtifact: ReportArtifact | null;
};

export function ReportNavigationPreview({
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

      {latestHtml ? (
        <article className="module-section-surface">
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
          <div className="mt-5 overflow-hidden rounded-[0.5rem] border border-border/70 bg-white shadow-inner">
            <iframe
              title="Latest report artifact preview"
              className="h-[900px] w-full"
              sandbox=""
              srcDoc={latestHtml}
            />
          </div>
        </article>
      ) : null}
    </>
  );
}
