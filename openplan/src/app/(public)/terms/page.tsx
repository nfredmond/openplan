import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Use — OpenPlan",
  description:
    "Terms that govern supervised early-access use of OpenPlan, a civic-planning workbench operated by Nat Ford Planning.",
};

const accessBoundaries = [
  {
    title: "Supervised early access",
    description:
      "OpenPlan is provided as supervised early-access software. Workspace activation, billing, and production rollout are intentionally gated and individually reviewed before live use.",
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
  "These terms may change as OpenPlan moves from supervised early access toward broader availability. Material changes are announced to active workspace owners.",
  "Pilot pricing posture, activation boundaries, and billing policies are published on the pricing lane and reflect the current supervised release, not a final commercial contract.",
];

export default function TermsPage() {
  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Terms of use</p>
          <div className="public-headline-block">
            <h1 className="public-title">How OpenPlan is made available during supervised early access.</h1>
            <p className="public-lead max-w-4xl">
              OpenPlan is operated by Nat Ford Planning. These terms describe what the platform is, who may use it, what is
              expected of users, and the boundaries that protect clients and the communities their work serves.
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
            <h2 className="public-rail-title">Honest prototype, not a finished SaaS.</h2>
          </div>
          <p className="public-rail-copy">
            OpenPlan is in deliberate supervised release. Some modules produce planning-grade outputs; others are still labeled
            internal prototype only. The difference is shown to the user, not hidden behind marketing copy.
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
