import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";

import { RequestAccessForm } from "@/components/request-access/request-access-form";
import { buildRequestAccessPrefill } from "@/lib/access-request-query";

export const metadata = {
  title: "Contact | OpenPlan",
  description: "Contact Nat Ford Planning for OpenPlan implementation, support, managed deployment, or custom-fork review.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = buildRequestAccessPrefill("/contact", (await searchParams) ?? {});

  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Contact</p>
          <div className="public-headline-block">
            <h1 className="public-title">Request OpenPlan implementation, support, or managed deployment review.</h1>
            <p className="public-lead max-w-4xl">
              Share the agency context, first workflow, and deployment question so Nat Ford can route the request to fit review before any hosted workspace, services scope, or custom fork is created.
            </p>
          </div>

          <div className="public-actions">
            <Link href="#contact-form" className="public-primary-link">
              Open contact form
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/pricing" className="public-secondary-link">
              Review service lanes
            </Link>
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ClipboardCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Fit review first</p>
              <h2 className="public-rail-title">No automatic checkout or workspace creation.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            Contact requests become internal intake rows. The next step is a human review of implementation/support fit, deployment posture, and responsibility boundaries.
          </p>
        </aside>
      </section>

      <section id="contact-form" className="scroll-mt-24">
        <RequestAccessForm
          initialValues={prefill.initialValues}
          sourcePath={prefill.sourcePath}
          sourceContext={prefill.sourceContext}
        />
      </section>
    </main>
  );
}
