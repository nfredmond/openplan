import Link from "next/link";
import { ArrowRight, FileText, FolderKanban, Map, Megaphone, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

const pilotWorkflowSteps = [
  {
    label: "1",
    title: "Project or county context",
    detail: "Start with a project workspace, county run, or planning program so every artifact has a home.",
    href: "/projects",
    cta: "Open projects",
    icon: FolderKanban,
  },
  {
    label: "2",
    title: "Analysis evidence",
    detail: "Run corridor analysis and preserve source transparency, scores, geometry, and comparison context.",
    href: "/explore",
    cta: "Open analysis",
    icon: Map,
  },
  {
    label: "3",
    title: "Engagement signal",
    detail: "Collect or review public input so report packets carry civic context alongside technical evidence.",
    href: "/engagement",
    cta: "Open engagement",
    icon: Megaphone,
  },
  {
    label: "4",
    title: "Packet assembly",
    detail: "Generate RTP, project, or grant-facing packets with provenance and refresh posture intact.",
    href: "/reports",
    cta: "Open reports",
    icon: FileText,
  },
  {
    label: "5",
    title: "Readiness proof",
    detail: "Review smoke evidence and operational warnings before sharing the pilot story externally.",
    href: "/admin/pilot-readiness",
    cta: "Open readiness",
    icon: ShieldCheck,
  },
];

export function DashboardPilotWorkflowSpine() {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Pilot workflow spine</p>
          <h2 className="module-section-title">Move one planning story from context to packet</h2>
          <p className="module-section-description">
            This is the shortest complete path through OpenPlan for a supervised pilot walkthrough.
          </p>
        </div>
        <StatusBadge tone="info">End-to-end path</StatusBadge>
      </div>

      <div className="mt-4 module-record-list">
        {pilotWorkflowSteps.map((step) => {
          const Icon = step.icon;
          return (
            <Link
              key={step.title}
              href={step.href}
              className="module-record-row transition-colors hover:border-emerald-600/30 hover:bg-emerald-50/30"
            >
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <span className="flex h-6 w-6 items-center justify-center rounded border border-emerald-600/15 bg-emerald-50 text-[0.72rem] font-bold text-emerald-800">
                      {step.label}
                    </span>
                    <Icon className="h-3.5 w-3.5 text-emerald-700" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{step.title}</h3>
                      <span className="inline-flex items-center gap-1 text-[0.74rem] font-semibold text-emerald-800">
                        {step.cta}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className="module-record-summary">{step.detail}</p>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </article>
  );
}
