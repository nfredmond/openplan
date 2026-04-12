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

  return <div className={["module-subpanel border-amber-500/25 bg-amber-500/8 text-sm text-foreground", className].filter(Boolean).join(" ")}>{message}</div>;
}
