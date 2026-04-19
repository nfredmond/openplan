import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Practices — OpenPlan",
  description:
    "How OpenPlan handles workspace data, client information, and AI-assisted content during supervised early access.",
};

const dataHandling = [
  {
    title: "Workspace-scoped access",
    description:
      "Planning records, engagement inputs, modeling runs, and grant artifacts are isolated to the workspace they belong to. Row-level access controls enforce this at the database layer — not just in the UI.",
  },
  {
    title: "No cross-client reuse",
    description:
      "Data uploaded by one agency or consulting team is not used to train shared models, seed other workspaces, or inform deliverables for another client. Workspace data stays within the workspace.",
  },
  {
    title: "Minimization by default",
    description:
      "We ask for the data the planning work requires and nothing more. Sensitive engagement inputs, respondent identifiers, and confidential planning context are treated as confidential by default.",
  },
];

const aiContent = [
  "AI-assisted drafting is used inside OpenPlan for analysis, summarization, report scaffolding, and data cleanup. The platform labels AI-drafted content where it appears so reviewers can tell it apart from hand-authored work.",
  "Screening-grade outputs from the behavioral modeling runtime and other internal prototype modules are never presented as planning-grade conclusions. Final client-critical analysis must be reviewed by qualified staff.",
  "We do not sell or share workspace data with third-party model providers beyond what is strictly required to deliver the requested analysis. Where third-party inference is used, the integration is disclosed on the surface that invokes it.",
];

const storagePosture = [
  "Workspaces are backed by Supabase (Postgres + PostGIS). Authentication, storage, and row-level security are enforced by the database. Access is scoped to workspace members invited by the owner.",
  "Planning deliverables, aerial imagery, model inputs, and generated packets are stored inside the workspace's own storage buckets. Owners can export their workspace data at any time for archival or handoff.",
  "Production deployments run on Vercel. Runtime logs, error telemetry, and access records are retained for operational support and are not shared externally.",
];

const userRights = [
  "Workspace owners may request export of their data, deletion of specific records, or full workspace teardown. Requests are handled through the operator support channel once a workspace is active.",
  "Engagement participants and survey respondents retain the rights granted by the agency or consulting team administering the engagement. OpenPlan does not independently monetize respondent data.",
  "Where a planning deliverable must be preserved for regulatory or audit purposes, records may be retained in line with the agency's own retention rules — not OpenPlan's default lifecycle.",
];

export default function PrivacyPage() {
  return (
    <main className="public-page">
      <div className="public-page-backdrop" />

      <section className="public-hero-grid">
        <article className="public-hero">
          <p className="public-kicker">Privacy practices</p>
          <div className="public-headline-block">
            <h1 className="public-title">How workspace data, client information, and AI-assisted content are handled.</h1>
            <p className="public-lead max-w-4xl">
              OpenPlan is operated by Nat Ford Planning for agencies, RTPAs, counties, tribes, and consulting teams. This page
              describes what data the platform collects, how it is stored, who can see it, and how AI-assisted features are
              governed during supervised early access.
            </p>
          </div>

          <div className="public-actions">
            <Link href="/legal" className="public-primary-link">
              Read combined legal notice
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/terms" className="public-secondary-link">
              Terms of use
            </Link>
          </div>
        </article>

        <aside className="public-rail">
          <div>
            <p className="public-rail-kicker">Operating posture</p>
            <h2 className="public-rail-title">Client data stays with the client.</h2>
          </div>
          <p className="public-rail-copy">
            Workspace isolation is enforced at the database layer. Planning records, engagement inputs, and modeling outputs
            belong to the workspace that produced them — not to OpenPlan, and not to other workspaces on the platform.
          </p>
        </aside>
      </section>

      <section className="public-content-grid public-content-grid--balanced">
        <article className="public-surface">
          <div className="public-section-header">
            <div>
              <p className="public-section-label">Data handling</p>
              <h2 className="public-section-title">How workspace data is kept separate</h2>
            </div>
          </div>
          <div className="public-ledger">
            {dataHandling.map((item, index) => (
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
              <p className="public-section-label">AI-assisted content</p>
              <h2 className="public-section-title">Where AI drafting is used and how it is labeled</h2>
            </div>
          </div>
          <div className="public-ledger">
            {aiContent.map((note, index) => (
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
              <p className="public-section-label">Storage posture</p>
              <h2 className="public-section-title">Where workspace data lives</h2>
            </div>
          </div>
          <div className="public-ledger">
            {storagePosture.map((note, index) => (
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
              <p className="public-section-label">User rights</p>
              <h2 className="public-section-title">Export, deletion, and retention</h2>
            </div>
          </div>
          <div className="public-ledger">
            {userRights.map((note, index) => (
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
              Privacy questions, export requests, and deletion requests can be directed to the operator via the sign-in
              surface&#39;s support channel once a workspace is active. During supervised early access, privacy posture is
              reviewed alongside terms and legal notices and may be updated as the platform matures.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}
