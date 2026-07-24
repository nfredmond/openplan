import Link from "next/link";
import { ArrowRight, FileText, Map, MessageSquareText, ShieldCheck } from "lucide-react";
import { buildOpenPlanPublicMetadata } from "@/lib/public-page-metadata";

export const metadata = buildOpenPlanPublicMetadata({
  title: "Free, open-source planning software",
  description:
    "Apache-2.0 planning software for agencies, tribes, RTPAs, counties, cities, non-profits, and consultants anywhere in the United States. Free to use, free to self-host, no paid tier.",
  path: "/",
});


const sourceProofLinks = [
  {
    href: "https://github.com/nfredmond/openplan",
    label: "Source repository",
  },
  {
    href: "https://github.com/nfredmond/openplan/blob/main/LICENSE",
    label: "Apache-2.0 license text",
  },
];

const operatingFlows = [
  {
    title: "Move from corridor question to delivery packet",
    description:
      "Corridor review, overlays, run history, and reporting stay tied together so the analysis does not get stranded in separate tools.",
  },
  {
    title: "Keep project records, engagement, and reporting in one ledger",
    description:
      "OpenPlan keeps project context visible while engagement campaigns and deliverables mature into report-ready material.",
  },
  {
    title: "Publish a public lane without leaving the planning system",
    description:
      "Share-token engagement pages let teams collect structured public input while preserving moderation and traceability.",
  },
];

const publicSurfaces = [
  {
    href: "/examples",
    label: "Evidence catalog",
    title: "See a real screening run with its caveats",
    description:
      "A real screening run validated against observed traffic counts — screening-grade evidence with caveats and validation metrics shown verbatim.",
  },
  {
    href: "/sign-up?source=landing&intent=modeling",
    label: "Analysis Studio",
    title: "Open the map and scenario workspace",
    description:
      "Analysis Studio is a signed-in workspace. Create a free account and work with corridor maps, overlays, run history, and map-ready outputs for your own geography.",
  },
  {
    href: "/sign-up?source=landing&intent=engagement",
    label: "Engagement workspace",
    title: "Open the engagement workspace",
    description:
      "Public share links can be published from a signed-in workspace with moderation and human review. Create a free account to run a campaign for your community.",
  },
];

const releaseFacts = [
  {
    label: "License",
    value: "Apache-2.0 core",
    detail: "OpenPlan is inspectable planning software, not a closed black-box SaaS dependency.",
  },
  {
    label: "Cost",
    value: "Free, with no paid tier",
    detail: "No plans, no seats, no usage quotas, and no payment step anywhere in the software. Nothing is held back behind an upgrade.",
  },
  {
    label: "Getting started",
    value: "Sign up, workspace ready",
    detail: "Self-serve: create an account and your workspace is provisioned immediately. No access queue, no approval, no one to talk to first.",
  },
];

const operatingCommitments = [
  "The source-first stance is intentional: public agencies should be able to inspect the software behind their planning work.",
  "Every feature is available to every workspace: there is no tier that unlocks more of the software, and no limit you have to pay to lift.",
  "Public engagement portals preserve review and moderation before feedback enters formal reporting or summaries.",
  "The platform is built for agencies and consulting teams that need traceable planning work, not another static status page.",
];

const coreLanes = [
  {
    title: "Map and analysis",
    description: "Keep corridor questions, overlays, and run outputs visible inside a planning-grade workspace.",
    icon: Map,
    accentClass: "text-[color:var(--accent)]",
  },
  {
    title: "Public engagement",
    description: "Collect structured public input with moderation, topic organization, and report-ready traceability.",
    icon: MessageSquareText,
    accentClass: "text-[color:var(--pine)]",
  },
  {
    title: "Reporting",
    description: "Carry evidence forward into deliverables without manually rebuilding context in a separate packet workflow.",
    icon: FileText,
    accentClass: "text-[color:var(--copper)]",
  },
];

export default function PublicLandingPage() {
  return (
    <div className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Open-source planning platform</p>
          <div className="public-headline-block">
            <h1 className="public-title">Open-source planning software that keeps maps, engagement, and delivery in one record.</h1>
            <p className="public-lead max-w-4xl">
              OpenPlan is free, Apache-2.0 planning software for agencies, tribes, RTPAs, counties, cities, non-profits, and consulting teams. Run it hosted or on your own infrastructure — the software, the schema, and your data are yours.
            </p>
          </div>

          <div className="public-source-proof" aria-label="Open-source proof path">
            <span>Proof path for the Apache-2.0 claim:</span>
            {sourceProofLinks.map((link) => (
              <Link key={link.href} href={link.href} className="public-source-proof-link">
                {link.label}
              </Link>
            ))}
          </div>

          <div className="public-actions">
            <Link href="/sign-up?source=landing" className="public-primary-link">
              Create your free workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/sign-in" className="public-secondary-link">
              Sign in to existing workspace
            </Link>
          </div>
          <p className="public-fine-print mt-2 text-sm text-muted-foreground">
            Free and open source. Sign up and your workspace is ready immediately — no access
            queue, no approval step, and no payment at any point.
          </p>

          <div className="public-fact-grid public-fact-grid--three">
            {releaseFacts.map((fact) => (
              <div key={fact.label} className="public-fact">
                <p className="public-fact-label">{fact.label}</p>
                <p className="public-fact-value">{fact.value}</p>
                <p className="public-fact-detail">{fact.detail}</p>
              </div>
            ))}
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Planning delivery signal</p>
              <h2 className="public-rail-title">Built for real planning delivery</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            OpenPlan is meant to feel like a serious planning workspace for agencies and consulting teams — and to stay inspectable, so the software behind a public planning decision can be read by the public it serves.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">
              Public engagement stays connected to project context, moderation, and report generation.
            </div>
            <div className="public-rail-item">
              Claims stay inside what the software actually does: screening-grade results are labeled as such, and limits are stated rather than hidden.
            </div>
            <div className="public-rail-item">
              The product language stays practical and civic because the work itself is.
            </div>
          </div>
        </aside>
      </section>

      <section className="public-content-grid">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">How work moves</p>
              <h2 className="public-section-title">A planning flow, not a feature collage</h2>
            </div>
            <p className="public-section-description max-w-2xl">
              The public-facing entry points show how OpenPlan carries a team from intake to evidence, review, and delivery.
            </p>
          </div>

          <div className="public-ledger">
            {operatingFlows.map((flow, index) => (
              <div key={flow.title} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-label">Flow</p>
                  <h3 className="public-ledger-title">{flow.title}</h3>
                  <p className="public-ledger-copy">{flow.description}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Surface areas</p>
              <h2 className="public-section-title">Enter through the right lane</h2>
            </div>
            <p className="public-section-description max-w-xl">
              Each public route has a specific job and connects back to the broader planning record.
            </p>
          </div>

          <div className="public-ledger">
            {publicSurfaces.map((surface) => (
              <Link key={surface.href} href={surface.href} className="public-link-row">
                <div className="public-ledger-body">
                  <p className="public-ledger-label">{surface.label}</p>
                  <h3 className="public-ledger-title">{surface.title}</h3>
                  <p className="public-ledger-copy">{surface.description}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Operating commitments</p>
              <h2 className="public-section-title">What the current public release promises</h2>
            </div>
          </div>
          <div className="public-ledger">
            {operatingCommitments.map((boundary, index) => (
              <div key={boundary} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{boundary}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Core lanes</p>
              <h2 className="public-section-title">Three surfaces that matter immediately</h2>
            </div>
          </div>
          <div className="public-ledger">
            {coreLanes.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.title} className="public-ledger-row">
                  <div className="public-ledger-icon">
                    <Icon className={`h-4 w-4 ${lane.accentClass}`} />
                  </div>
                  <div className="public-ledger-body">
                    <h3 className="public-ledger-title">{lane.title}</h3>
                    <p className="public-ledger-copy">{lane.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
}
