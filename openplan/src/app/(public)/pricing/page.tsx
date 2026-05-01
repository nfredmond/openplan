import Link from "next/link";
import { ArrowRight, CreditCard, ShieldCheck } from "lucide-react";

const serviceLanes = [
  {
    name: "Self-hosted core",
    slug: "self-hosted",
    price: "$0 software license",
    features: [
      "Apache-2.0 source code license",
      "Run your own OpenPlan environment with your own infrastructure and data controls",
      "Reuse the planning workspace patterns, schemas, and public documentation that are committed to the repository",
      "Community contributions welcome through the public contribution process",
      "No OpenPlan license fee from Nat Ford for the open-source code",
    ],
    cta: "Request self-hosting review",
    fit: "Best for technical agencies, MPOs, universities, and civic-tech teams that can operate their own stack and want transparent planning software rather than a closed vendor dependency.",
  },
  {
    name: "Managed hosting + support",
    slug: "managed-hosting",
    price: "From $249/mo",
    features: [
      "Nat Ford-operated hosting for one or more planning workspaces",
      "Workspace activation, billing, backups, and support handled through the managed service lane",
      "Operator-grade app shell, Analysis Studio access, engagement, reporting, and billing infrastructure",
      "Email support with a 2-business-day target for baseline managed hosting",
      "Stripe remains the payment rail for hosted workspace support and service retainers",
    ],
    cta: "Request managed hosting",
    fit: "Good for a small agency, tribe, RTPA, or consultant team that wants the open-source product operated for them with clear support boundaries.",
  },
  {
    name: "Implementation + planning services",
    slug: "implementation",
    price: "Scoped by engagement",
    features: [
      "Onboarding, data setup, workflow configuration, and staff training",
      "RTP, ATP, grant-support, engagement, and project-list implementation help",
      "Custom extensions, integrations, reports, and client-specific planning workflows",
      "Human-reviewed planning support from Nat Ford Planning, not black-box automated recommendations",
      "Service scope can be paired with managed hosting or delivered against a self-hosted deployment",
    ],
    cta: "Scope implementation help",
    fit: "Best when the real need is not just software access, but a working planning process installed around local data, staff capacity, funding deadlines, and public accountability.",
  },
];

const implementationNotes = [
  "The OpenPlan codebase is intended to be open-source first under Apache-2.0. Managed hosting, onboarding, support, planning services, and custom extensions are the commercial lanes.",
  "Prices shown are service baselines, not proprietary software-license fees. Final managed-hosting or implementation scope may vary by agency complexity, data requirements, support level, and procurement path.",
  "Checkout and subscription records remain in the product because hosted workspaces need a reliable payment, entitlement, and support ledger. That infrastructure does not turn the open-source core into a proprietary software license.",
  "Current billing proof posture is historical live payment evidence plus current non-money-moving billing proof; no fresh same-cycle paid canary was run for this release packet, so sales language should call that canary waived rather than re-proven.",
  "No hidden fees, punitive change orders, black-box scoring claims, or unsupported planning-grade promises.",
];

const pricingFacts = [
  {
    label: "Software license",
    value: "Apache-2.0 core",
    detail: "The commercial offer is services around OpenPlan: managed hosting, implementation, onboarding, support, and extensions.",
  },
  {
    label: "Hosted workspaces",
    value: "Managed service",
    detail: "Nat Ford can operate OpenPlan for teams that do not want to run their own infrastructure.",
  },
  {
    label: "Planning standard",
    value: "Human-reviewed outputs",
    detail: "OpenPlan accelerates drafting and evidence handling, but professional judgment remains visible and accountable.",
  },
];

export default function PricingPage() {
  return (
    <section className="public-page">
      <div className="public-page-backdrop" />

      <div className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Services + hosting</p>
          <div className="public-headline-block">
            <h1 className="public-title">Open-source planning software, with managed hosting and implementation help when teams need it.</h1>
            <p className="public-lead max-w-4xl">
              OpenPlan is positioned as Apache-2.0 open-source software first. Nat Ford Planning earns revenue by operating hosted workspaces, onboarding teams, supporting planning workflows, and building custom extensions — not by locking agencies into a black-box license.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/request-access" className="public-primary-link">
              Request a services review
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/sign-in" className="public-secondary-link">
              Sign in to an existing workspace
            </Link>
            <Link href="/legal" className="public-secondary-link">
              Read license boundary
            </Link>
          </div>

          <div className="public-fact-grid public-fact-grid--three">
            {pricingFacts.map((fact) => (
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
              <p className="public-rail-kicker">Commercial posture</p>
              <h2 className="public-rail-title">Open core; paid operations when useful.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            OpenPlan should be legible to public agencies: they can inspect and reuse the code, or ask Nat Ford to host, configure, support, and extend it for real planning delivery.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">The open-source core is not priced as a seat-based proprietary license.</div>
            <div className="public-rail-item">Managed-hosting fees pay for infrastructure, support, onboarding, backups, and accountable operations.</div>
            <div className="public-rail-item">Implementation services cover the hard part: data, staff workflow, public process, deliverables, and local constraints.</div>
          </div>
        </aside>
      </div>

      <article className="public-surface">
        <div className="public-section-header">
          <div>
            <p className="public-section-label">Service catalog</p>
            <h2 className="public-section-title">Choose the right operating lane</h2>
          </div>
          <p className="public-section-description max-w-2xl">
            The lanes are intentionally plain: run OpenPlan yourself, ask Nat Ford to operate it, or pair the software with planning implementation support.
          </p>
        </div>

        <div className="public-ledger">
          {serviceLanes.map((lane) => (
            <article key={lane.name} className="public-plan-row">
              <div className="public-ledger-body">
                <div className="public-ledger-meta-row">
                  <span className="public-inline-label">Open-source first</span>
                  <span className="public-ledger-label">{lane.slug}</span>
                </div>
                <h3 className="public-ledger-title public-ledger-title--large">{lane.name}</h3>
                <p className="public-ledger-copy max-w-3xl">{lane.fit}</p>
                <ul className="public-bullet-list">
                  {lane.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>

              <aside className="public-price-rail">
                <p className="public-ledger-label">Commercial lane</p>
                <p className="public-price">{lane.price}</p>
                <Link href={`/request-access?lane=${lane.slug}`} className="public-primary-link public-primary-link--full">
                  {lane.cta}
                </Link>
                <Link href="/legal" className="public-secondary-link">
                  Review legal posture
                </Link>
              </aside>
            </article>
          ))}
        </div>
      </article>

      <div className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Implementation notes</p>
              <h2 className="public-section-title">Operational details that matter before a hosted workspace goes live</h2>
            </div>
          </div>
          <div className="public-ledger">
            {implementationNotes.map((note, index) => (
              <div key={note} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{note}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <CreditCard className="h-5 w-5 text-sky-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Billing lane</p>
              <h2 className="public-rail-title">Keep hosted-workspace billing explicit.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            Billing actions in OpenPlan are tied to a specific hosted workspace because project records, run history, support obligations, and payment posture all need to stay aligned.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">Do not start managed-hosting billing until the account is attached to the intended workspace.</div>
            <div className="public-rail-item">Use the current commercial proof waiver honestly: historical live payment plus current non-money-moving billing proof, not a fresh paid checkout canary.</div>
            <div className="public-rail-item">Use the request-access lane to decide whether the need is self-hosting, managed hosting, implementation, or a mix.</div>
            <div className="public-rail-item">If the service scope or workspace target is unclear, stop and resolve it before operators begin paid delivery work.</div>
          </div>
        </article>
      </div>
    </section>
  );
}
