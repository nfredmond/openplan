import Link from "next/link";
import { resolveWorkspaceCommandHref } from "@/lib/operations/grants-links";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

export function WorkspaceRuntimeCue({
  summary,
  className = "",
}: {
  summary: WorkspaceOperationsSummary;
  className?: string;
}) {
  if (summary.nextCommand?.key !== "start-project-reimbursement-packets" && summary.nextCommand?.key !== "advance-project-reimbursement-invoicing") {
    return null;
  }

  const message =
    summary.nextCommand.key === "start-project-reimbursement-packets"
      ? `Shared runtime cue: start the lead reimbursement packet in ${summary.nextCommand.targetProjectName ?? "the linked project"} before delivery work outruns the funding trail.`
      : `Shared runtime cue: reimbursement work is already underway in ${summary.nextCommand.targetProjectName ?? "the linked project"}, and invoice follow-through now outranks more local polish.`;
  const href = resolveWorkspaceCommandHref(summary.nextCommand);
  const ctaLabel =
    summary.nextCommand.key === "start-project-reimbursement-packets"
      ? "Open reimbursement start"
      : "Open reimbursement triage";

  return (
    <div className={["module-subpanel border-amber-500/25 bg-amber-500/8 text-sm text-foreground", className].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{message}</p>
        <Link href={href} className="text-sm font-semibold text-foreground underline-offset-4 transition hover:text-primary hover:underline">
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
