import Link from "next/link";
import { isGrantsCommand, resolveWorkspaceCommandHref } from "@/lib/operations/grants-links";
import type { WorkspaceCommandQueueItem, WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

function buildWorkspaceRuntimeCue(summary: WorkspaceOperationsSummary) {
  const command = summary.nextCommand;
  if (!command) return null;

  const href = resolveWorkspaceCommandHref(command);

  if (command.key === "start-project-reimbursement-packets") {
    return {
      message: `Next across this workspace: start the lead reimbursement packet in ${command.targetProjectName ?? "the linked project"} so delivery work does not get ahead of the funding paper trail.`,
      href,
      ctaLabel: "Open reimbursement start",
    };
  }

  if (command.key === "advance-project-reimbursement-invoicing") {
    return {
      message: `Next across this workspace: reimbursement is already underway in ${command.targetProjectName ?? "the linked project"} — invoice follow-through is now the priority.`,
      href,
      ctaLabel: "Open reimbursement triage",
    };
  }

  if (command.key === "review-current-report-packets" && summary.counts.rtpFundingReviewPackets > 0) {
    return {
      message:
        command.moduleKey === "grants"
          ? `Next across this workspace: ${summary.counts.rtpFundingReviewPackets} current RTP packet${summary.counts.rtpFundingReviewPackets === 1 ? " still carries" : "s still carry"} grant follow-through from linked projects — finish that in Grants before treating ${summary.counts.rtpFundingReviewPackets === 1 ? "it" : "them"} as settled.`
          : `Next across this workspace: ${summary.counts.rtpFundingReviewPackets} current RTP packet${summary.counts.rtpFundingReviewPackets === 1 ? " still carries" : "s still carry"} funding follow-up from linked projects — release review should confirm funding status before treating ${summary.counts.rtpFundingReviewPackets === 1 ? "it" : "them"} as settled.`,
      href,
      ctaLabel: command.moduleKey === "grants" ? "Open Grants follow-through" : "Open RTP funding review",
    };
  }

  if (isGrantsCommand(command)) {
    return {
      message: `Next across this workspace: the lead Grants action is ${command.title.toLowerCase()}. ${command.detail}`,
      href,
      ctaLabel: `Open ${resolveGrantsRuntimeCueCtaTarget(command)}`,
    };
  }

  return null;
}

function resolveGrantsRuntimeCueCtaTarget(command: WorkspaceCommandQueueItem) {
  return command.moduleLabel ?? "Grants OS command";
}

export function WorkspaceRuntimeCue({
  summary,
  className = "",
}: {
  summary: WorkspaceOperationsSummary;
  className?: string;
}) {
  const cue = buildWorkspaceRuntimeCue(summary);
  if (!cue) {
    return null;
  }

  return (
    <div className={["module-subpanel border-amber-500/25 bg-amber-500/8 text-sm text-foreground", className].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{cue.message}</p>
        <Link href={cue.href} className="text-sm font-semibold text-foreground underline-offset-4 transition hover:text-primary hover:underline">
          {cue.ctaLabel}
        </Link>
      </div>
    </div>
  );
}
