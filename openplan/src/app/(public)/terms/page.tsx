import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Use — OpenPlan",
  description:
    "Terms that govern Nat Ford managed hosting and services for OpenPlan, an Apache-2.0 civic-planning workbench.",
};

const accessBoundaries = [
  {
    title: "Open-source software, hosted service when managed by Nat Ford",
    description:
      "OpenPlan source code is provided under the Apache License, Version 2.0, unless a file says otherwise. These terms govern Nat Ford-hosted workspaces and related services; they do not replace the Apache-2.0 license for self-hosted use of the open-source code.",
  },
  {
    title: "Supervised managed hosting",
    description:
      "Managed workspace activation, billing, support, and production rollout are intentionally gated and individually reviewed before live use.",
  },
  {
    title: "Internal prototype posture",
    description:
      "Several modules — notably the behavioral modeling runtime — are labeled internal prototype only. Outputs are shared with caveats rather than as planning-grade conclusions.",
  },
  {
    title: "Traceable planning work",
    description:
      "OpenPlan is designed for agencies and consulting teams that need traceable planning work. It is not a consumer analytics product and is not sold as one.",
  },
];

const permittedUses = [
  "Accessing your own workspace, running analyses, generating reports, and managing the engagement, project, and RTP lanes for work you are authorized to perform.",
  "Exporting your own workspace data for planning deliverables, board packets, or archival purposes.",
  "Collaborating with invited workspace members under row-level access controls enforced by the platform.",
];

const prohibitedUses = [
  "Using OpenPlan to generate or publish decisions as planning-grade when the underlying data is still flagged screening-grade or internal prototype only.",
  "Extracting workspace data belonging to other organizations, circumventing access controls, or using the platform to bypass agency-level data-sharing rules.",
  "Misrepresenting AI-drafted content as independently verified analysis. Final analysis, conclusions, and client-critical decisions must be reviewed by qualified staff.",
];

const changeExpectations = [
  "These terms may change as OpenPlan moves from supervised rollout toward broader availability. Material changes are announced to active managed-workspace owners.",
  "Managed-hosting pricing posture, activation boundaries, and billing policies are published on the services lane and reflect the current supervised release, not a final commercial contract.",
];

export default function TermsPage() {
  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Terms of use</p>
          <div className="public-headline-block">
            <h1 className="public-title">How OpenPlan is made available as open-source software and as a Nat Ford managed service.</h1>
            <p className="public-lead max-w-4xl">
              OpenPlan is built by Nat Ford Planning as Apache-2.0 planning software. These terms describe the hosted-service and support boundaries for Nat Ford-managed workspaces, plus the safeguards that protect clients and the communities their work serves.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/legal" className="public-primary-link">
              Read combined legal notice
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/privacy" className="public-secondary-link">
              Privacy practices
            </Link>
          </div>
        </article>

        <aside className="public-rail">
          <div>
            <p className="public-rail-kicker">Operating posture</p>
            <h2 className="public-rail-title">Open-source core, honest managed-service boundary.</h2>
          </div>
          <p className="public-rail-copy">
            OpenPlan is in deliberate supervised release. The source license, hosted-service terms, and screening-grade limits are kept separate so agencies can understand what they may reuse, what Nat Ford operates, and what still requires review.
          </p>
        </aside>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Access boundaries</p>
              <h2 className="public-section-title">What the platform is and is not right now</h2>
            </div>
          </div>
          <div className="public-ledger">
            {accessBoundaries.map((item, index) => (
              <div key={item.title} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <h3 className="public-ledger-title">{item.title}</h3>
                  <p className="public-ledger-copy">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Permitted use</p>
              <h2 className="public-section-title">What users may do</h2>
            </div>
          </div>
          <div className="public-ledger">
            {permittedUses.map((use, index) => (
              <div key={use} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{use}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Prohibited use</p>
              <h2 className="public-section-title">What the platform is not for</h2>
            </div>
          </div>
          <div className="public-ledger">
            {prohibitedUses.map((use, index) => (
              <div key={use} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{use}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">How these terms may change</p>
              <h2 className="public-section-title">Release posture, not final contract</h2>
            </div>
          </div>
          <div className="public-ledger">
            {changeExpectations.map((note, index) => (
              <div key={note} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{note}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="public-content-grid">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Operator</p>
              <h2 className="public-section-title">Nat Ford Planning</h2>
            </div>
            <p className="public-section-description max-w-2xl">
              OpenPlan is built and operated by Nat Ford Planning, a transportation and urban planning firm serving agencies,
              consulting teams, tribes, and rural communities. Questions about these terms can be directed to the operator via
              the sign-in surface&#39;s support channel once a workspace is active.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}
