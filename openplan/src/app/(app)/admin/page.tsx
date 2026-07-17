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
    availabilityNote: "Available now.",
    cta: "Open billing controls",
  },
  {
    title: "Pilot readiness",
    description: "Review production smoke evidence and export a share-safe readiness packet for pilot diligence.",
    href: "/admin/pilot-readiness",
    icon: FileCheck2,
    status: "Evidence live",
    tone: "info",
    availabilityNote: "Production smoke evidence and readiness packets live here.",
    cta: "Open evidence center",
  },
  {
    title: "Team management",
    description: "Workspace membership, invitations, and role administration for broader self-serve control.",
    href: "#",
    icon: Users2,
    status: "Staged",
    tone: "neutral",
    availabilityNote: "Ships in a future release. Membership changes run through support today.",
    cta: "On the roadmap",
    disabled: true,
  },
  {
    title: "Operational warnings",
    description: "Review body-limit events, CSP report-only telemetry, and observation-only AI cost warnings.",
    href: "/admin/operations",
    icon: ShieldCheck,
    status: "Telemetry map",
    tone: "info",
    availabilityNote: "Available now as a log-backed operations watchboard.",
    cta: "Open warning watchboard",
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
              See what is available today, what is on the roadmap, and where to find readiness evidence for
              diligence reviews.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Live now</p>
              <p className="module-summary-value">{liveCount}</p>
              <p className="module-summary-detail">Billing, readiness evidence, and operational warnings are available today.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Staged next</p>
              <p className="module-summary-value">{stagedCount}</p>
              <p className="module-summary-detail">Team administration is staged for a future release.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Roadmap</p>
              <p className="module-summary-value">Visible</p>
              <p className="module-summary-detail">Staged modules are labeled below and ship in future releases.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Administration</p>
              <h2 className="module-operator-title">Keep workspace settings clear and manageable</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Use this area to review workspace settings, billing status, and tools that are available to your team.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Use Billing to review plan and invoice details.</div>
            <div className="module-operator-item">Use Pilot Readiness to review launch checks and proof materials.</div>
            <div className="module-operator-item">Staged tools are labeled below until they ship.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Admin modules</p>
            <h2 className="module-section-title">Available controls</h2>
            <p className="module-section-description">
              Live features are linked below. Staged items are labeled and ship in future releases.
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-1">
          {adminModules.map((module) => {
            const Icon = module.icon;
            if (module.disabled) {
              return (
                <div key={module.title} className="flex items-start gap-3 rounded-[0.375rem] border border-border/70 bg-background/60 px-3 py-2.5 opacity-60">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/40 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.87rem] font-semibold text-foreground/80">{module.title}</p>
                    <p className="mt-0.5 text-[0.77rem] leading-snug text-muted-foreground">{module.description}</p>
                  </div>
                  <StatusBadge tone={module.tone}>{module.status}</StatusBadge>
                </div>
              );
            }
            return (
              <Link key={module.title} href={module.href} className="flex items-start gap-3 rounded-[0.375rem] border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-emerald-600/40 hover:bg-accent/60">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-emerald-600/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.87rem] font-semibold text-foreground">{module.title}</p>
                  <p className="mt-0.5 text-[0.77rem] leading-snug text-muted-foreground">{module.description}</p>
                </div>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      </article>

      <article className="module-section-surface mt-6">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Governance posture</p>
            <h2 className="module-section-title">What is enforced right now</h2>
            <p className="module-section-description">
              Governance controls are enforced in the runtime today; dedicated settings interfaces for each control are on the roadmap.
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
              All routes operate under the active governance profile for synthesis and data retention.
            </p>
          </div>
          <div className="module-subpanel text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">Evidence over assumption</div>
            <p className="mt-2 leading-relaxed">
              Pilot Readiness is the source of record for smoke status and proof artifacts.
            </p>
          </div>
          <div className="module-subpanel text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">On the roadmap</div>
            <p className="mt-2 leading-relaxed">
              Self-serve team administration and deeper audit surfaces ship in future releases.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
