import Link from "next/link";
import { ArrowRight, ClipboardCheck, ShieldCheck } from "lucide-react";

import { RequestAccessForm } from "@/components/request-access/request-access-form";

export const metadata = {
  title: "Request Access | OpenPlan",
  description: "Request supervised early access to OpenPlan for a planning agency or delivery team.",
};

const reviewFacts = [
  {
    label: "Activation",
    value: "Reviewed first",
    detail: "A request starts an internal review record, not a live workspace or subscription.",
  },
  {
    label: "Onboarding",
    value: "Workflow-led",
    detail: "Provisioning is tied to the first real planning workflow and the responsible operator.",
  },
  {
    label: "Boundary",
    value: "No auto-send",
    detail: "The intake form stores the request; outbound follow-up stays under human control.",
  },
];

const reviewSteps = [
  "Confirm the agency, responsible contact, and first planning lane.",
  "Decide whether the request fits the current supervised early-access surface.",
  "Provision or invite only after scope, workspace ownership, and activation posture are clear.",
];

export default function RequestAccessPage() {
  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Request access</p>
          <div className="public-headline-block">
            <h1 className="public-title">Start a supervised OpenPlan workspace review.</h1>
            <p className="public-lead max-w-4xl">
              Share the agency context, responsible contact, and first planning workflow so OpenPlan can evaluate whether a
              workspace should be provisioned for the current early-access surface.
            </p>
          </div>

          <div className="public-actions">
            <Link href="#request-access-form" className="public-primary-link">
              Open request form
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="public-secondary-link">
              Review pricing lane
            </Link>
          </div>

          <div className="public-fact-grid public-fact-grid--three">
            {reviewFacts.map((fact) => (
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
              <p className="public-rail-kicker">Onboarding posture</p>
              <h2 className="public-rail-title">Access stays deliberately gated.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            OpenPlan can accept self-serve interest without turning prospect intake into automatic workspace creation,
            billing activation, or customer communication.
          </p>
          <div className="public-rail-list">
            {reviewSteps.map((step) => (
              <div key={step} className="public-rail-item">
                {step}
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section id="request-access-form" className="scroll-mt-24">
        <RequestAccessForm />
      </section>

      <article className="public-surface">
        <div className="public-section-header">
          <div>
            <p className="public-section-label">What happens next</p>
            <h2 className="public-section-title">The request becomes an internal intake row.</h2>
          </div>
          <ClipboardCheck className="h-5 w-5 text-[color:var(--pine)]" />
        </div>
        <div className="public-ledger">
          <div className="public-ledger-row">
            <div className="public-ledger-index">01</div>
            <div className="public-ledger-body">
              <h3 className="public-ledger-title">Review fit before commitment</h3>
              <p className="public-ledger-copy">
                The request is checked against the live product surface, data posture, and support capacity before any
                activation decision.
              </p>
            </div>
          </div>
          <div className="public-ledger-row">
            <div className="public-ledger-index">02</div>
            <div className="public-ledger-body">
              <h3 className="public-ledger-title">Keep billing separate</h3>
              <p className="public-ledger-copy">
                Pricing and checkout remain on the pricing lane, with workspace selection and subscription status confirmed
                separately from this request.
              </p>
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}
