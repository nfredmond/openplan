import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";

import { RequestAccessForm } from "@/components/request-access/request-access-form";
import { buildRequestAccessPrefill } from "@/lib/access-request-query";

export const metadata = {
  title: "Contact | OpenPlan",
  description:
    "Get in touch about OpenPlan — questions, bug reports, and feedback from planners using the software.",
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
            <h1 className="public-title">Questions, bug reports, and feedback.</h1>
            <p className="public-lead max-w-4xl">
              You do not need to contact anyone to use OpenPlan — it is free and open source, and
              signing up provisions your workspace immediately. Use this if something is broken,
              something is unclear, or you want to tell us what planners in your agency actually
              need.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/sign-up" className="public-primary-link">
              Create your free workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#contact-form" className="public-secondary-link">
              Open contact form
            </Link>
          </div>
        </article>

        <aside className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <ClipboardCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="public-rail-kicker">Nothing is gated</p>
              <h2 className="public-rail-title">This is not a way to get access.</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            There is no access queue, no approval step, and no payment. Sign up and the software is
            yours to use. OpenPlan is open source — issues and pull requests on the repository are
            welcome too, and are often the fastest route for a bug.
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
