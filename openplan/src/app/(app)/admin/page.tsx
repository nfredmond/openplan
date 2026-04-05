import Link from "next/link";
import { 
  ArrowRight, 
  CreditCard, 
  FileCheck2, 
  ShieldCheck, 
  Users2, 
  Settings,
  Activity
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

export default function AdminPage() {
  const adminModules = [
    {
      title: "Billing & Subscription",
      description: "Manage your workspace plan, payment methods, and view invoice history.",
      href: "/billing",
      icon: CreditCard,
      status: "Active",
      tone: "success" as const
    },
    {
      title: "Pilot Readiness",
      description: "View production smoke test results and export evidence packets for pilot diligence.",
      href: "/admin/pilot-readiness",
      icon: FileCheck2,
      status: "Monitoring",
      tone: "info" as const
    },
    {
      title: "Team Management",
      description: "Manage workspace members, roles, and invitation settings.",
      href: "#",
      icon: Users2,
      status: "Upcoming",
      tone: "neutral" as const,
      disabled: true
    },
    {
      title: "Security & Audit",
      description: "Review audit trails, security posture, and access logs.",
      href: "#",
      icon: ShieldCheck,
      status: "Upcoming",
      tone: "neutral" as const,
      disabled: true
    }
  ];

  return (
    <section className="module-page">
      <header className="mb-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Settings className="h-4 w-4" />
          <span>Workspace Administration</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Control Room</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground leading-relaxed">
          Manage your Planning OS instance, monitor platform health, and control workspace-level governance.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        {adminModules.map((module) => (
          <div 
            key={module.title}
            className={`group relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 transition-all duration-200 ${
              module.disabled ? "opacity-60" : "hover:border-white/[0.12] hover:bg-white/[0.04]"
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-slate-300 group-hover:text-white transition-colors">
                <module.icon className="h-6 w-6" strokeWidth={1.5} />
              </span>
              <StatusBadge tone={module.tone}>{module.status}</StatusBadge>
            </div>
            
            <h3 className="mt-5 text-lg font-semibold text-white">{module.title}</h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              {module.description}
            </p>

            <div className="mt-6">
              {!module.disabled ? (
                <Link 
                  href={module.href}
                  className="inline-flex items-center gap-2 text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  Configure module
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Module Locked
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.02] p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-400">
              <Activity className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Platform Governance</h2>
            </div>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              Your workspace is currently operating under the Standard Governance profile. 
              Policy enforcement for AI synthesis and data retention is active.
            </p>
          </div>
          <button 
            disabled 
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-400 cursor-not-allowed"
          >
            Governance Settings
          </button>
        </div>
      </div>
    </section>
  );
}
