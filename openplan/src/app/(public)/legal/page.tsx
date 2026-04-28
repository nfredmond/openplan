import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Legal Notice — OpenPlan",
  description:
    "Combined legal notice for OpenPlan: open-source license boundary, hosted-service posture, AI disclosure, and screening-grade limits.",
};

const operatingPosture = [
  {
    title: "Internal prototype posture",
    description:
      "OpenPlan is currently in supervised early access. Some modules — notably the behavioral modeling runtime — are labeled internal prototype only. Those outputs are shared with caveats, not as planning-grade conclusions.",
  },
  {
    title: "Open-source license boundary",
    description:
      "OpenPlan source code is made available under the Apache License, Version 2.0, unless a file says otherwise. That source license does not grant rights to Nat Ford trademarks, private credentials, client confidential information, third-party datasets, third-party media, or client-specific deliverables.",
  },
  {
    title: "Managed hosting and services",
    description:
      "Nat Ford commercial terms cover managed hosting, onboarding, support, planning services, and custom implementation work around the open-source core. Workspace activation, service scope, and billing are gated and reviewed individually.",
  },
  {
    title: "Screening-grade boundary",
    description:
      "Where a module produces screening-grade output, the platform marks it as such on the surface that shows it. Planning-grade consumption is not permitted until the underlying evidence is promoted by a qualified reviewer.",
  },
];

const aiDisclosure = [
  "AI-assisted drafting is used throughout OpenPlan for analysis, summarization, scaffolding, and data cleanup. AI output is labeled where it appears so reviewers can distinguish it from hand-authored work.",
  "Final analysis, conclusions, and client-critical decisions must be reviewed by qualified staff before being published, shared externally, or relied upon for regulatory or funding purposes.",
  "AI-drafted content must not be misrepresented as independently verified analysis. The platform is built to surface this distinction, and users of the platform agree to honor it.",
];

const modelLimits = [
  "Behavioral modeling runtime outputs carry a documented error envelope. The current published ceiling is max APE 237.62% — suitable for screening-grade comparison, not for funding-grade conclusions.",
  "Aerial imagery outputs (orthos, models, surfaces) produced through the Aerial Operations OS modules are measurable but prototype-grade until the QA bundle for that mission is signed off.",
  "Grants and RTP decision records are authoritative once a packet is adopted by the responsible agency — not before. Drafts, preset packets, and preview surfaces are not substitutes for adopted records.",
];

const covenant = [
  "Truth without spin: assumptions, limitations, and uncertainty are labeled rather than smoothed over. Regulatory and technical claims are cited.",
  "Fair exchange: managed-hosting and service pricing aim to be sustainable, transparent, and non-predatory. Published service baselines are not proprietary software-license fees.",
  "Community protection: analysis and recommendations do not shift burden onto disadvantaged or tribal communities for convenience or optics. This is a standing constraint, not a soft preference.",
  "Rapid repair: when something is wrong, the operator communicates early and makes it right through rework, credits, or refunds as appropriate.",
  "Responsible AI use: AI accelerates drafting and QA; it does not replace qualified review on client-critical outputs.",
  "Accountability: final deliverables pass gates for truthfulness, citation support, equity impact, confidentiality, and client-safe readability.",
];

export default function LegalPage() {
  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Legal notice</p>
          <div className="public-headline-block">
            <h1 className="public-title">Combined safety harbor: how OpenPlan is governed as open-source software and a managed service.</h1>
            <p className="public-lead max-w-4xl">
              This page consolidates the open-source license boundary, hosted-service posture, AI disclosures, and model-output limits that govern OpenPlan today.
              It is the authoritative source for the &ldquo;internal prototype only&rdquo; and screening-grade language that appears elsewhere in the platform.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/terms" className="public-primary-link">
              Terms of use
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/privacy" className="public-secondary-link">
              Privacy practices
            </Link>
          </div>
        </article>

        <aside className="public-rail">
          <div>
            <p className="public-rail-kicker">Posture summary</p>
            <h2 className="public-rail-title">Screening-grade today, planning-grade only where promoted.</h2>
          </div>
          <p className="public-rail-copy">
            OpenPlan distinguishes between open-source software, Nat Ford managed services, planning-grade outputs, and modules that are still labeled internal prototype only. The difference is surfaced on the screen, not hidden behind marketing copy.
          </p>
        </aside>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Operating posture</p>
              <h2 className="public-section-title">What supervised early access means</h2>
            </div>
          </div>
          <div className="public-ledger">
            {operatingPosture.map((item, index) => (
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
              <p className="public-section-label">AI disclosure</p>
              <h2 className="public-section-title">Where AI is used and how it is labeled</h2>
            </div>
          </div>
          <div className="public-ledger">
            {aiDisclosure.map((note, index) => (
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

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Model-output limits</p>
              <h2 className="public-section-title">Screening-grade boundaries</h2>
            </div>
          </div>
          <div className="public-ledger">
            {modelLimits.map((note, index) => (
              <div key={note} className="public-ledger-row">
                <div className="public-ledger-index">0{index + 1}</div>
                <div className="public-ledger-body">
                  <p className="public-ledger-copy text-foreground">{note}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Operating covenant</p>
              <h2 className="public-section-title">Commitments that govern the work</h2>
            </div>
          </div>
          <div className="public-ledger">
            {covenant.map((note, index) => (
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
              consulting teams, tribes, and rural communities. The operating covenant summarized here is maintained in the
              company&#39;s one-page covenant document and is the source of truth for how OpenPlan work is conducted.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}
