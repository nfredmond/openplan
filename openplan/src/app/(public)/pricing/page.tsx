import Link from "next/link";
import { ArrowRight, CreditCard, ShieldCheck } from "lucide-react";

const plans = [
  {
    name: "Starter",
    slug: "starter",
    price: "$249/mo",
    features: [
      "1 workspace",
      "Operator-grade app shell + Analysis Studio access",
      "Up to 100 corridor runs/month",
      "ATP + SS4A report templates",
      "Email support (2-business-day target)",
    ],
    cta: "Create Starter account",
    fit: "Good for a supervised pilot team validating one active workspace and a bounded planning workflow.",
  },
  {
    name: "Professional",
    slug: "professional",
    price: "$799/mo",
    features: [
      "Up to 5 workspaces",
      "Up to 500 corridor runs/month",
      "Priority support + onboarding office hours",
      "Advanced reporting workflow and KPI review",
      "Early access to new OpenPlan features and data connectors",
    ],
    cta: "Create Professional account",
    fit: "Best for teams already using OpenPlan across several project threads and needing a wider delivery surface.",
  },
];

const implementationNotes = [
  "Pricing shown is the current early-access baseline and may vary for negotiated supervised pilots, agency complexity, data requirements, and implementation scope.",
  "Current scope includes the core workspace, billing workspace selection, and the live Analysis Studio foundation; broader OpenPlan features continue to roll out in phases.",
  "Checkout starts only after account creation, sign-in, and explicit workspace billing selection. Returning from Stripe does not by itself guarantee activation until webhook status confirms it.",
  "No hidden fees, punitive change orders, or black-box scoring claims.",
];

const pricingFacts = [
  {
    label: "Activation posture",
    value: "Supervised billing",
    detail: "Pricing is public, but activation still respects explicit workspace selection and webhook-confirmed billing state.",
  },
  {
    label: "Current scope",
    value: "Core workbench first",
    detail: "The live pricing lane matches the product surface already proven in the workspace and Analysis Studio.",
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
          <p className="public-kicker">Pricing</p>
          <div className="public-headline-block">
            <h1 className="public-title">OpenPlan Early Access Pricing</h1>
            <p className="public-lead max-w-4xl">
              Transparent supervised-pilot pricing for the current OpenPlan product surface. Account creation is self-serve,
              while workspace activation, billing status, and first-success onboarding remain intentionally bounded to the
              features proven today. AI accelerates drafting, but final planning recommendations must be reviewed and approved
              by a qualified human professional.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/sign-up" className="public-primary-link">
              Create an account
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/sign-in" className="public-secondary-link">
              Sign in to an existing workspace
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
              <h2 className="public-rail-title">Clear pricing without bait-and-switch mechanics</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            The pricing surface sets expectations plainly: what is live, what is supervised, and what has to happen before a
            workspace becomes an active paid environment.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">Create the account first, then sign in, then choose the correct workspace before billing is launched.</div>
            <div className="public-rail-item">A return from Stripe is not treated as activation until webhook status confirms the subscription state.</div>
            <div className="public-rail-item">Negotiated pilots can still adjust for agency complexity, data posture, and implementation scope.</div>
          </div>
        </aside>
      </div>

      <article className="public-surface">
        <div className="public-section-header">
          <div>
            <p className="public-section-label">Plan catalog</p>
            <h2 className="public-section-title">Choose the right operating lane</h2>
          </div>
          <p className="public-section-description max-w-2xl">
            The current plans are intentionally simple so teams can understand what they are buying without decoding a stack of add-ons.
          </p>
        </div>

        <div className="public-ledger">
          {plans.map((plan) => (
            <article key={plan.name} className="public-plan-row">
              <div className="public-ledger-body">
                <div className="public-ledger-meta-row">
                  <span className="public-inline-label">Early access</span>
                  <span className="public-ledger-label">{plan.slug}</span>
                </div>
                <h3 className="public-ledger-title public-ledger-title--large">{plan.name}</h3>
                <p className="public-ledger-copy max-w-3xl">{plan.fit}</p>
                <ul className="public-bullet-list">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>

              <aside className="public-price-rail">
                <p className="public-ledger-label">Price</p>
                <p className="public-price">{plan.price}</p>
                <Link href={`/sign-up?plan=${plan.slug}`} className="public-primary-link public-primary-link--full">
                  {plan.cta}
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
              <h2 className="public-section-title">Operational details that matter before billing goes live</h2>
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
              <h2 className="public-rail-title">Keep the workspace target explicit</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            Billing actions in OpenPlan are tied to a specific workspace, because project records, run history, and payment posture all need to stay aligned.
          </p>
          <div className="public-rail-list">
            <div className="public-rail-item">Do not start billing until the account is attached to the intended workspace.</div>
            <div className="public-rail-item">Use the public sign-up lane to create identity first, then select the plan and workspace with intent.</div>
            <div className="public-rail-item">If the subscription state or workspace scope is unclear, stop and resolve it before operators begin paid delivery work.</div>
          </div>
        </article>
      </div>
    </section>
  );
}
