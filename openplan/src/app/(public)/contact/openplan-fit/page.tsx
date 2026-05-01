import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { RequestAccessForm } from "@/components/request-access/request-access-form";
import { buildRequestAccessPrefill } from "@/lib/access-request-query";

export const metadata = {
  title: "OpenPlan Fit Review | OpenPlan",
  description: "Start OpenPlan implementation, support, managed deployment, or custom-fork fit review.",
};

export default async function OpenPlanFitPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = buildRequestAccessPrefill("/contact/openplan-fit", (await searchParams) ?? {});

  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">OpenPlan fit review</p>
          <div className="public-headline-block">
            <h1 className="public-title">Review OpenPlan implementation and support fit before checkout.</h1>
            <p className="public-lead max-w-4xl">
              Direct OpenPlan tier checkout is disabled. Use this intake to scope managed deployment, onboarding, support, planning services, or a custom fork before any billing or workspace commitment is made.
            </p>
          </div>

          <div className="public-actions">
            <Link href="#openplan-fit-form" className="public-primary-link">
              Open fit review form
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="public-secondary-link">
              Review service posture
            </Link>
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Checkout disabled</p>
              <h2 className="public-rail-title">Legacy tier context is preserved for intake only.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            Product, tier, checkout, and workspace query values are sanitized and stored as intake context so old links can be triaged without reopening public OpenPlan subscriptions.
          </p>
        </aside>
      </section>

      <section id="openplan-fit-form" className="scroll-mt-24">
        <RequestAccessForm
          initialValues={prefill.initialValues}
          sourcePath={prefill.sourcePath}
          sourceContext={prefill.sourceContext}
        />
      </section>
    </main>
  );
}
