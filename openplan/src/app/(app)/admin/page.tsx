import Link from "next/link";
import { ArrowRight, Activity, CreditCard, FileCheck2, Settings, ShieldCheck, Users2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

type AdminModule = {
  title: string;
  description: string;
  href: string;
  icon: typeof CreditCard;
  status: string;
  tone: "success" | "info" | "neutral";
  availabilityNote: string;
  disabled?: boolean;
  cta: string;
};

const adminModules: AdminModule[] = [
  {
    title: "Billing & subscription",
    description: "Manage workspace plan posture, payment methods, invoice history, and billing visibility.",
    href: "/billing",
    icon: CreditCard,
    status: "Live",
    tone: "success",
    availabilityNote: "Available now inside the supervised pilot shell.",
    cta: "Open billing controls",
  },
  {
    title: "Pilot readiness",
    description: "Review production smoke evidence and export a share-safe readiness packet for pilot diligence.",
    href: "/admin/pilot-readiness",
    icon: FileCheck2,
    status: "Evidence live",
    tone: "info",
    availabilityNote: "This is the launch-facing proof surface for current pilot confidence.",
    cta: "Open evidence center",
  },
  {
    title: "Team management",
    description: "Workspace membership, invitations, and role administration for broader self-serve control.",
    href: "#",
    icon: Users2,
    status: "Staged",
    tone: "neutral",
    availabilityNote: "Not self-serve in the current pilot. Keep this labeled as upcoming.",
    cta: "Staged for pilot follow-up",
    disabled: true,
  },
  {
    title: "Security & audit",
    description: "Audit trails, access review, and deeper governance controls for later operational maturity.",
    href: "#",
    icon: ShieldCheck,
    status: "Staged",
    tone: "neutral",
    availabilityNote: "Visibility remains deliberate and limited while the pilot is supervised.",
    cta: "Staged for pilot follow-up",
    disabled: true,
  },
];

const liveCount = adminModules.filter((module) => !module.disabled).length;
const stagedCount = adminModules.filter((module) => module.disabled).length;

export default function AdminPage() {
  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Settings className="h-3.5 w-3.5" />
            Workspace administration
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Admin control room</h1>
            <p className="module-intro-description">
              Keep this surface honest and launch-safe: show what operators can use today, show what is still staged,
              and route pilot diligence into evidence instead of vague platform language.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Live now</p>
              <p className="module-summary-value">{liveCount}</p>
              <p className="module-summary-detail">Billing and pilot-readiness evidence are operator-usable today.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Staged next</p>
              <p className="module-summary-value">{stagedCount}</p>
              <p className="module-summary-detail">Team administration and deep audit controls remain intentionally staged.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pilot posture</p>
              <p className="module-summary-value">Supervised</p>
              <p className="module-summary-detail">Admin controls stay explicit about current scope instead of implying full self-serve governance.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Launch-facing clarity</p>
              <h2 className="module-operator-title">Admin should reduce uncertainty, not create it</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            The current pilot does not need a dense settings maze. It needs a clean place to confirm what is live,
            what is monitored, and what still requires operator support.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Use Billing for plan and invoice posture.</div>
            <div className="module-operator-item">Use Pilot Readiness for smoke evidence and exportable proof packets.</div>
            <div className="module-operator-item">Keep team-management and audit tooling labeled as staged until they are genuinely self-serve.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Admin modules</p>
            <h2 className="module-section-title">Available controls and staged follow-ons</h2>
            <p className="module-section-description">
              Each card below is intentionally explicit about whether the route is live today or reserved for a later slice.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {adminModules.map((module) => {
            const Icon = module.icon;
            return (
              <div
                key={module.title}
                className={`rounded-3xl border p-5 transition-all duration-200 ${
                  module.disabled
                    ? "border-border/70 bg-background/70"
                    : "border-border/70 bg-card/85 shadow-[0_14px_34px_rgba(20,33,43,0.08)] hover:-translate-y-0.5 hover:border-primary/35"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-background/80 text-foreground">
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <StatusBadge tone={module.tone}>{module.status}</StatusBadge>
                </div>

                <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">{module.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{module.description}</p>
                <p className="mt-4 rounded-2xl border border-border/70 bg-background/75 px-4 py-3 text-sm text-muted-foreground">
                  {module.availabilityNote}
                </p>

                <div className="mt-5">
                  {module.disabled ? (
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {module.cta}
                    </span>
                  ) : (
                    <Link
                      href={module.href}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-primary transition hover:text-primary/80"
                    >
                      {module.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <article className="module-section-surface mt-6">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Governance posture</p>
            <h2 className="module-section-title">What operators can trust right now</h2>
            <p className="module-section-description">
              Pilot governance is active, but not every governance control is exposed as a full settings interface yet.
            </p>
          </div>
          <StatusBadge tone="info">Standard governance profile</StatusBadge>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="module-subpanel text-sm text-muted-foreground">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Activity className="h-4 w-4 text-emerald-600" />
              AI policy enforcement active
            </div>
            <p className="mt-2 leading-relaxed">
              Pilot routes are already operating under the active governance profile for synthesis and data-retention posture.
            </p>
          </div>
          <div className="module-subpanel text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">Evidence over assumption</div>
            <p className="mt-2 leading-relaxed">
              Pilot Readiness is the source of truth for smoke status and proof artifacts. It is not decorative marketing chrome.
            </p>
          </div>
          <div className="module-subpanel text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">Self-serve comes later</div>
            <p className="mt-2 leading-relaxed">
              Team administration and deeper audit surfaces will move forward when the product posture supports honest self-serve use.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
