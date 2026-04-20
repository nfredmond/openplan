import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderKanban,
  Map,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

type PilotWorkflowStepKey = "context" | "analysis" | "engagement" | "packet" | "readiness";

type PilotWorkflowStep = {
  key: PilotWorkflowStepKey;
  label: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  icon: LucideIcon;
};

type PilotWorkflowHandoffProps = {
  currentStep?: PilotWorkflowStepKey;
  projectId?: string | null;
  reportId?: string | null;
  engagementCampaignId?: string | null;
  publicEngagementHref?: string | null;
  title?: string;
  description?: string;
};

function buildPilotWorkflowSteps(input: {
  projectId?: string | null;
  reportId?: string | null;
  engagementCampaignId?: string | null;
  publicEngagementHref?: string | null;
}): PilotWorkflowStep[] {
  const projectHref = input.projectId ? `/projects/${input.projectId}` : "/projects";
  const engagementHref = input.engagementCampaignId
    ? `/engagement/${input.engagementCampaignId}`
    : input.projectId
      ? `/engagement?projectId=${input.projectId}`
      : input.publicEngagementHref ?? "/engagement";
  const packetHref = input.reportId ? `/reports/${input.reportId}` : "/reports";

  return [
    {
      key: "context",
      label: "1",
      title: "Project or county context",
      detail: "Anchor the planning story in a project, county run, or program before evidence starts moving.",
      href: projectHref,
      cta: input.projectId ? "Review project context" : "Open projects",
      icon: FolderKanban,
    },
    {
      key: "analysis",
      label: "2",
      title: "Analysis evidence",
      detail: "Run or review corridor evidence with source transparency, geometry, and comparison context intact.",
      href: "/explore",
      cta: "Open analysis",
      icon: Map,
    },
    {
      key: "engagement",
      label: "3",
      title: "Engagement signal",
      detail: "Review campaign input and handoff-ready public comments before packet assembly.",
      href: engagementHref,
      cta: input.engagementCampaignId ? "Review campaign" : "Open engagement",
      icon: Megaphone,
    },
    {
      key: "packet",
      label: "4",
      title: "Packet assembly",
      detail: "Generate or refresh the report packet so provenance and readiness signals are current.",
      href: packetHref,
      cta: input.reportId ? "Review this packet" : "Open reports",
      icon: FileText,
    },
    {
      key: "readiness",
      label: "5",
      title: "Readiness proof",
      detail: "Check smoke evidence and operational warnings before using the packet externally.",
      href: "/admin/pilot-readiness",
      cta: "Open readiness",
      icon: ShieldCheck,
    },
  ];
}

export function PilotWorkflowHandoff({
  currentStep,
  projectId,
  reportId,
  engagementCampaignId,
  publicEngagementHref,
  title = "Pilot story handoff",
  description = "Use this path to keep one planning story moving from local context through evidence, engagement, packet assembly, and readiness proof.",
}: PilotWorkflowHandoffProps) {
  const steps = buildPilotWorkflowSteps({
    projectId,
    reportId,
    engagementCampaignId,
    publicEngagementHref,
  });
  const currentIndex = currentStep ? steps.findIndex((step) => step.key === currentStep) : -1;

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Pilot workflow spine</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{description}</p>
        </div>
        <StatusBadge tone="info">End-to-end path</StatusBadge>
      </div>

      <div className="mt-4 module-record-list">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isCurrent = step.key === currentStep;
          const isComplete = currentIndex > -1 && index < currentIndex;
          const statusLabel = isCurrent ? "Current surface" : isComplete ? "Context carried" : "Next handoff";

          return (
            <Link
              key={step.key}
              href={step.href}
              className={[
                "module-record-row transition-colors hover:border-emerald-600/30 hover:bg-emerald-50/30",
                isCurrent ? "border-emerald-600/35 bg-emerald-50/35" : "",
              ].join(" ")}
            >
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <span className="flex h-6 w-6 items-center justify-center rounded border border-emerald-600/15 bg-emerald-50 text-[0.72rem] font-bold text-emerald-800">
                      {step.label}
                    </span>
                    {isComplete ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 text-emerald-700" />
                    )}
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {statusLabel}
                    </span>
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
