import type { ReactNode } from "react";

export function DashboardWorkspaceIntro({
  workspaceName,
  workspaceRole,
  workspacePlan,
  description,
  children,
}: {
  workspaceName: string;
  workspaceRole: string;
  workspacePlan: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <article className="module-intro-card">
      <div className="module-intro-kicker">Workspace dashboard</div>
      <div className="module-intro-body">
        <div className="flex flex-wrap gap-2">
          <div className="module-record-chip">
            <span>Role</span>
            <strong>{workspaceRole}</strong>
          </div>
          <div className="module-record-chip">
            <span>Plan</span>
            <strong>{workspacePlan}</strong>
          </div>
        </div>
        <h1 className="module-intro-title">{workspaceName}</h1>
        <p className="module-intro-description">
          {description ??
            "Use this overview to see current work, recent activity, and the next planning tasks that need attention."}
        </p>
      </div>
      {children}
    </article>
  );
}
