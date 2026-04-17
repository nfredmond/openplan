import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";

export function GrantsWorkspaceQueueSection({
  grantsQueue,
}: {
  grantsQueue: WorkspaceCommandQueueItem[];
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Workspace queue</p>
          <h2 className="module-section-title">What should move next on the grants lane</h2>
          <p className="module-section-description">
            These commands come from the same workspace runtime already feeding the assistant and RTP surfaces, but filtered here to the grants operating lane.
          </p>
        </div>
        <StatusBadge tone={grantsQueue.length > 0 ? "warning" : "success"}>
          {grantsQueue.length > 0 ? `${grantsQueue.length} queued` : "Queue clear"}
        </StatusBadge>
      </div>

      <div className="mt-5 grid gap-3">
        {grantsQueue.length > 0 ? (
          grantsQueue.map((item) => (
            <Link key={item.key} href={item.href} className="module-subpanel block transition-colors hover:border-primary/35">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <StatusBadge tone={item.tone}>{item.tone === "warning" ? "Next" : "Queue"}</StatusBadge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.badges.map((badge) => (
                  <StatusBadge key={`${item.key}-${badge.label}`} tone="neutral">
                    {badge.label}
                    {badge.value !== null && badge.value !== undefined ? `: ${badge.value}` : ""}
                  </StatusBadge>
                ))}
              </div>
            </Link>
          ))
        ) : (
          <div className="module-subpanel text-sm text-muted-foreground">
            No immediate grants-specific queue pressure is visible from the current workspace snapshot.
          </div>
        )}
      </div>
    </article>
  );
}
