import { notFound } from "next/navigation";
import { Clock3, MessageSquareText, ShieldCheck } from "lucide-react";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import { loadPublicPortalBundle } from "@/lib/engagement/public-portal-data";

function fmtDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getEngagementLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export default async function PublicEngagementPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;

  const bundle = await loadPublicPortalBundle(shareToken);
  if (!bundle) {
    notFound();
  }

  const { campaign, project, acceptingSubmissions, portalProps } = bundle;

  return (
    <section className="public-page">
      <div className="public-page-backdrop" />

      <div className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">
            <MessageSquareText className="h-3.5 w-3.5" />
            Community engagement
          </p>

          <div className="public-meta-strip">
            {project ? <span>Linked project: {project.name}</span> : <span>Standalone public engagement page</span>}
            <span>Share-ready public lane</span>
            <span>Mode: {getEngagementLabel(campaign.engagement_type)}</span>
          </div>

          <div className="public-headline-block">
            <h1 className="public-title">{campaign.title}</h1>
            {campaign.public_description ? (
              <p className="public-lead max-w-4xl">{campaign.public_description}</p>
            ) : campaign.summary ? (
              <p className="public-lead max-w-4xl">{campaign.summary}</p>
            ) : null}
          </div>

          {project ? (
            <div className="public-context-strip">
              <p className="public-section-label">This input supports</p>
              <p className="public-context-title">{project.name}</p>
              {project.summary ? <p className="public-context-copy">{project.summary}</p> : null}
            </div>
          ) : null}

          <div className="public-fact-grid public-fact-grid--three">
            <div className="public-fact">
              <p className="public-fact-label">Submission status</p>
              <p className="public-fact-value">{acceptingSubmissions ? "Submissions open" : "Submissions closed"}</p>
              <p className="public-fact-detail">The project team reviews submissions before they are used in public-facing materials.</p>
            </div>
            <div className="public-fact">
              <p className="public-fact-label">Published feedback</p>
              <p className="public-fact-value">{portalProps.approvedItems.length}</p>
              <p className="public-fact-detail">Approved community items currently visible on this campaign page.</p>
            </div>
            <div className="public-fact">
              <p className="public-fact-label">Engagement mode</p>
              <p className="public-fact-value">{getEngagementLabel(campaign.engagement_type)}</p>
              <p className="public-fact-detail">Structured public input collected in a planning-grade workflow.</p>
            </div>
          </div>
        </article>

        <article className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Portal posture</p>
              <h2 className="public-rail-title">Public input with review and traceability</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            This page gives the public a focused place to submit and review campaign feedback while preserving planning context,
            moderation, and category structure inside OpenPlan.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">Submissions are reviewed before they are reflected in public-facing summaries or technical materials.</div>
            <div className="public-rail-item">Published feedback represents approved items from the campaign, not an unfiltered public message board.</div>
            <div className="public-rail-item">Location-based comments can be tied to a specific place when that improves the planning record.</div>
          </div>
          <div className="public-rail-meta">
            <Clock3 className="h-4 w-4" />
            <span>Last updated {fmtDateTime(campaign.updated_at)}</span>
          </div>
        </article>
      </div>

      <PublicEngagementPortal {...portalProps} />
    </section>
  );
}
