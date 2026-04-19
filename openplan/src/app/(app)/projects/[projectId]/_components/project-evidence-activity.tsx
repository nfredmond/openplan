import Link from "next/link";
import { Clock3, Database, FileClock, Radar } from "lucide-react";
import { AerialEvidencePackageCreator } from "@/components/aerial/aerial-evidence-package-creator";
import { AerialMissionCreator } from "@/components/aerial/aerial-mission-creator";
import { AerialMissionStatusEditor } from "@/components/aerial/aerial-mission-status-editor";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  aerialVerificationReadinessTone,
  formatAerialMissionTypeLabel,
  formatAerialVerificationReadinessLabel,
  type AerialMissionStatus,
  type AerialProjectPosture,
} from "@/lib/aerial/catalog";
import { fmtDateTime, titleize, toneForDatasetStatus } from "./_helpers";
import type {
  AerialMission,
  AerialPackage,
  LinkedDatasetItem,
  RecentRun,
  TimelineItem,
} from "./_types";

type ProjectEvidenceAndActivityProps = {
  dataHubMigrationPending: boolean;
  linkedDatasets: LinkedDatasetItem[];
  recentRuns: RecentRun[] | null;
  aerialProjectPosture: AerialProjectPosture;
  aerialProjectPostureDetail: string | null;
  aerialMissions: AerialMission[];
  aerialPackages: AerialPackage[];
  projectId: string;
  timelineItems: TimelineItem[];
};

export function ProjectEvidenceAndActivity({
  dataHubMigrationPending,
  linkedDatasets,
  recentRuns,
  aerialProjectPosture,
  aerialProjectPostureDetail,
  aerialMissions,
  aerialPackages,
  projectId,
  timelineItems,
}: ProjectEvidenceAndActivityProps) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <Database className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Data dependencies</p>
                <h2 className="module-section-title">Linked datasets</h2>
              </div>
            </div>
          </div>
          {dataHubMigrationPending ? (
            <div className="module-alert mt-5 text-sm">
              Project-linked datasets will appear here once the Data Hub schema is available in this environment.
            </div>
          ) : linkedDatasets.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No datasets linked yet. Use <Link href="/data-hub" className="font-semibold text-foreground underline">Data Hub</Link> to register a source and connect it back to this project.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {linkedDatasets.map((dataset) => (
                <div key={dataset.datasetId} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDatasetStatus(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(dataset.relationshipType)}</StatusBadge>
                      {dataset.connectorLabel ? <StatusBadge tone="neutral">{dataset.connectorLabel}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{dataset.name}</h3>
                        <p className="module-record-stamp">Refreshed {fmtDateTime(dataset.lastRefreshedAt)}</p>
                      </div>
                      <p className="module-record-summary">{dataset.vintageLabel ? `Vintage: ${dataset.vintageLabel}` : "Vintage not captured yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Clock3 className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Recent analysis activity</p>
                <h2 className="module-section-title">Latest runs in this project workspace</h2>
              </div>
            </div>
          </div>
          {!recentRuns || recentRuns.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No runs yet. Use <Link href="/explore" className="font-semibold text-foreground underline">Analysis Studio</Link> to create the first project-linked run.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {recentRuns.map((run) => (
                <div key={run.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="success">Analysis run</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{run.title}</h3>
                        <p className="module-record-stamp">{fmtDateTime(run.created_at)}</p>
                      </div>
                      <p className="module-record-summary">{run.summary_text || "Run created with no summary yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Radar className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Aerial evidence</p>
              <h2 className="module-section-title">Field collection and evidence packages</h2>
              <p className="module-section-description">
                Aerial missions and evidence packages linked to this project. Evidence package readiness flows into the project evidence chain.
              </p>
            </div>
          </div>
        </div>

        {aerialProjectPosture.missionCount === 0 ? (
          <div className="mt-5 space-y-4">
            <div className="module-empty-state text-sm">
              No aerial missions linked yet. Log the first mission to start connecting field collection to this project evidence chain.
            </div>
            <AerialMissionCreator
              projectId={projectId}
              description="Corridor surveys, site inspections, and AOI captures linked here contribute to the field evidence chain."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="module-metric-card">
                <p className="module-metric-label">Missions</p>
                <p className="module-metric-value text-sm">{aerialProjectPosture.missionCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aerialProjectPosture.activeMissionCount} active, {aerialProjectPosture.completeMissionCount} complete.
                </p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Evidence packages</p>
                <p className="module-metric-value text-sm">{aerialPackages.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {aerialProjectPosture.readyPackageCount} ready or shared.
                </p>
              </div>
              <div className="module-metric-card col-span-2">
                <p className="module-metric-label">Verification readiness</p>
                <div className="mt-1">
                  <StatusBadge tone={aerialVerificationReadinessTone(aerialProjectPosture.verificationReadiness)}>
                    {formatAerialVerificationReadinessLabel(aerialProjectPosture.verificationReadiness)}
                  </StatusBadge>
                </div>
                {aerialProjectPostureDetail ? (
                  <p className="mt-2 text-xs text-muted-foreground">{aerialProjectPostureDetail}</p>
                ) : null}
              </div>
            </div>

            <div className="module-record-list">
              {aerialMissions.map((mission) => {
                const missionPackages = aerialPackages.filter((p) => p.mission_id === mission.id);
                return (
                  <div key={mission.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <AerialMissionStatusEditor
                          missionId={mission.id}
                          currentStatus={mission.status as AerialMissionStatus}
                        />
                        <StatusBadge tone="neutral">{formatAerialMissionTypeLabel(mission.mission_type)}</StatusBadge>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{mission.title}</h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(mission.updated_at)}</p>
                        </div>
                        {mission.geography_label ? (
                          <p className="module-record-summary">{mission.geography_label}</p>
                        ) : null}
                      </div>
                      {missionPackages.length > 0 ? (
                        <div className="module-record-meta">
                          {missionPackages.map((pkg) => (
                            <span key={pkg.id} className="module-record-chip">
                              {pkg.title} · <StatusBadge tone={aerialVerificationReadinessTone(pkg.verification_readiness)}>{formatAerialVerificationReadinessLabel(pkg.verification_readiness)}</StatusBadge>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">No evidence packages yet for this mission.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <AerialEvidencePackageCreator
              missionOptions={aerialMissions.map((m) => ({ id: m.id, title: m.title }))}
            />
            <AerialMissionCreator projectId={projectId} titleLabel="Log another mission" />
          </div>
        )}
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <FileClock className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Activity timeline</p>
              <h2 className="module-section-title">Everything happening in one feed</h2>
              <p className="module-section-description">
                The feed is intentionally tighter than the page intro: type first, timestamp second, short read after that.
              </p>
            </div>
          </div>
        </div>
        {timelineItems.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">No project activity yet.</div>
        ) : (
          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            {timelineItems.map((item) => (
              <div key={item.id} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={item.tone}>{item.badge}</StatusBadge>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{item.title}</h3>
                      <p className="module-record-stamp">{fmtDateTime(item.at)}</p>
                    </div>
                    <p className="module-record-summary">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </>
  );
}
