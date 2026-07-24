import Link from "next/link";
import { ArrowRight, FileText, Map, MessageSquareText, ShieldCheck } from "lucide-react";
import { buildOpenPlanPublicMetadata } from "@/lib/public-page-metadata";

export const metadata = buildOpenPlanPublicMetadata({
  title: "Open-source planning workbench with managed services",
  description:
    "Apache-2.0 planning software for agencies, tribes, RTPAs, counties, and consultants, backed by optional Nat Ford hosting, onboarding, support, and implementation services.",
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
    href: "/pricing",
    label: "Services lane",
    title: "Review open-source, hosting, and implementation options",
    description: "See how Apache-2.0 software, optional managed hosting, onboarding, support, planning services, and custom extensions fit together.",
  },
  {
    href: "/examples",
    label: "Evidence catalog",
    title: "See a screening run with its caveats first",
    description: "A real screening run with its validation metrics and caveats shown verbatim, so you can judge the boundaries before you sign up.",
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
    label: "Commercial model",
    value: "Free software, paid services",
    detail: "Hosting, support, onboarding, implementation, and custom extensions are the paid services around the open-source core.",
  },
  {
    label: "Getting started",
    value: "Sign up, workspace ready",
    detail: "OpenPlan is live and self-serve: create a free account and your workspace is ready immediately. Optional managed hosting starts with a reviewed setup, but nothing gates the free software.",
  },
];

const operatingCommitments = [
  "The source-first stance is intentional: public agencies should be able to inspect the software behind their planning work.",
  "Managed hosting and billing start with a reviewed setup because support obligations, data handling, and workspace ownership matter.",
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
              OpenPlan is Apache-2.0 planning software for agencies, tribes, RTPAs, counties, and consulting teams. Nat Ford Planning supports it through managed hosting, onboarding, planning services, and custom implementation work.
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
            <Link href="/pricing" className="public-secondary-link">
              Review optional services
            </Link>
            <Link href="/sign-in" className="public-secondary-link">
              Sign in to existing workspace
            </Link>
          </div>
          <p className="public-fine-print mt-2 text-sm text-muted-foreground">
            Free and open source. Sign up and your workspace is ready immediately — no founder
            involvement, no access queue, no payment. Managed hosting and services are optional.
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
            OpenPlan is meant to feel like a serious planning workspace for agencies and consulting teams: inspectable software when transparency matters, managed hosting and support when a team needs someone accountable to run it.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">
              Public engagement stays connected to project context, moderation, and report generation.
            </div>
            <div className="public-rail-item">
              Services language is explicit about the difference between open-source code and paid hosting, support, onboarding, and planning implementation.
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
