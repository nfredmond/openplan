import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";

const plans = [
  {
    name: "Starter",
    slug: "starter",
    price: "$249/mo",
    badge: "Early access",
    features: [
      "1 workspace",
      "Operator-grade app shell + Analysis Studio access",
      "Up to 100 corridor runs/month",
      "ATP + SS4A report templates",
      "Email support (2-business-day target)",
    ],
    cta: "Create Starter account",
  },
  {
    name: "Professional",
    slug: "professional",
    price: "$799/mo",
    badge: "Early access",
    features: [
      "Up to 5 workspaces",
      "Up to 500 corridor runs/month",
      "Priority support + onboarding office hours",
      "Advanced reporting workflow and KPI review",
      "Early access to new Planning OS modules and data connectors",
    ],
    cta: "Create Professional account",
  },
];

export default function PricingPage() {
  return (
    <section className="space-y-8">
      <header className="space-y-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pricing</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">OpenPlan Early Access Pricing</h1>
        <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
          Transparent supervised-pilot pricing for the current OpenPlan product surface. Account creation is self-serve,
          while workspace activation, billing status, and first-success onboarding remain intentionally bounded to the
          features proven today. AI accelerates drafting, but final planning recommendations must be reviewed and approved
          by a qualified human professional.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => (
          <article key={plan.name} className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight">{plan.name}</h2>
              <StatusBadge tone="info">{plan.badge}</StatusBadge>
            </div>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{plan.price}</p>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Link
              href={`/sign-up?plan=${plan.slug}`}
              className="mt-5 inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--line)_84%,var(--ink)_16%)] bg-white px-4 py-2 text-sm font-semibold text-[color:var(--ink)] transition hover:border-[color:var(--pine)] hover:bg-[color:color-mix(in_srgb,var(--pine)_8%,white)] hover:text-[color:var(--pine-deep)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/40 focus-visible:ring-offset-2"
            >
              {plan.cta}
            </Link>
          </article>
        ))}
      </div>

      <article className="rounded-2xl border border-border/80 bg-card p-5 text-sm text-muted-foreground shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
        <p className="font-medium text-foreground">Implementation notes</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>Pricing shown is the current early-access baseline and may vary for negotiated supervised pilots, agency complexity, data requirements, and implementation scope.</li>
          <li>Current scope includes the production-backed planning shell, billing workspace selection, and the live Analysis Studio foundation; broader Planning OS modules remain phased in.</li>
          <li>Checkout starts only after account creation, sign-in, and explicit workspace billing selection. Returning from Stripe does not by itself guarantee activation until webhook status confirms it.</li>
          <li>No hidden fees, punitive change orders, or black-box scoring claims.</li>
        </ul>
      </article>
    </section>
  );
}
