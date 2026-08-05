import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowLeft, Download, Hexagon, PlaneTakeoff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { Worksurface, WorksurfaceSection } from "@/components/ui/worksurface";
import { Inspector, InspectorField, InspectorGroup, InspectorEmpty } from "@/components/ui/inspector";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { AerialProcessingFreshness } from "@/components/aerial/aerial-processing-freshness";
import { AerialProcessingJobsPanel } from "@/components/aerial/aerial-processing-jobs-panel";
import { AerialProcessingRequestForm } from "@/components/aerial/aerial-processing-request";
import { isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";
import {
  aerialMissionStatusTone,
  aerialPackageStatusTone,
  aerialVerificationReadinessTone,
  buildAerialProjectPosture,
  describeAerialProcessingRequestSurface,
  describeAerialProjectPosture,
  formatAerialMissionStatusLabel,
  formatAerialMissionTypeLabel,
  formatAerialPackageStatusLabel,
  formatAerialVerificationReadinessLabel,
  resolveAerialProcessingSilenceMinutes,
  summarizeAerialEvidenceAttachmentReadiness,
  summarizeAerialMissionPackagePosture,
  summarizeAerialMissionProcessingPosture,
  summarizeAerialProcessingJob,
  type AerialMissionStatus,
  type AerialPackageStatus,
  type AerialVerificationReadiness,
} from "@/lib/aerial/catalog";
import {
  describeAerialProcessingAvailability,
  isAerialProcessingWorkerConfigured,
} from "@/lib/aerial/processing-availability";
import { loadAerialArtifactCustodyForMission, loadAerialProcessingJobsForMission, loadAerialProjectPosture } from "@/lib/aerial/queries";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type PackageRow = {
  id: string;
  title: string;
  package_type: string;
  status: AerialPackageStatus;
  verification_readiness: AerialVerificationReadiness;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type AerialMissionDetailPageProps = {
  params: Promise<{ missionId: string }>;
};

export default async function AerialMissionDetailPage({ params }: AerialMissionDetailPageProps) {
  const { missionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?next=/aerial/missions/${missionId}`);
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership?.workspace_id) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Aerial operations"
        title="Aerial mission detail needs a workspace"
        description="A mission record belongs to the workspace that planned it. You are signed in, but this account is not in a workspace yet, so there is no mission here to open."
      />
    );
  }

  const workspaceId = membership.workspace_id;

  const { data: mission, error: missionErr } = await supabase
    .from("aerial_missions")
    .select(
      "id, workspace_id, project_id, title, status, mission_type, geography_label, collected_at, notes, aoi_geojson, created_at, updated_at, projects:projects!aerial_missions_project_id_fkey(id, name)"
    )
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  // A FAILED READ IS NOT A MISSING MISSION. These were one branch, so a database
  // error on `aerial_missions` rendered the 404 page — telling an operator their
  // mission does not exist when OpenPlan had simply failed to look. That is the
  // same class of untruth this page's processing and package sections were
  // rewritten to avoid, and it is the loudest instance of it: the operator's
  // next move is to re-create work that is still there.
  if (missionErr) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <StateBlock
          tone="danger"
          title="This mission could not be read"
          description={`The database refused the query for this mission: ${
            missionErr.message ?? "no reason was returned"
          }. This is not the same as the mission not existing — OpenPlan cannot tell you either way right now, so do not treat this page as evidence the record is gone.`}
        />
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href="/aerial">
              <ArrowLeft className="h-4 w-4" />
              Back to Aerial Ops
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!mission) {
    notFound();
  }

  const project = Array.isArray(mission.projects) ? mission.projects[0] : mission.projects;
  // Cached project posture now lives in the aerial-owned aerial_project_posture
  // table (not a column on projects).
  const { posture: projectAerialPosture, updatedAt: projectAerialPostureUpdatedAt } = mission.project_id
    ? await loadAerialProjectPosture(supabase, mission.project_id)
    : { posture: null, updatedAt: null };
  const projectAerialPostureDetail = projectAerialPosture
    ? describeAerialProjectPosture(projectAerialPosture)
    : null;
  const hasAoi = isAoiPolygonGeoJson(mission.aoi_geojson);
  const aoiVertexCount = hasAoi
    ? Math.max(0, (mission.aoi_geojson as { coordinates: [number, number][][] }).coordinates[0].length - 1)
    : 0;

  // Every read below this point is collected rather than swallowed: a query that
  // failed may not be rendered as an answer. See src/lib/ui/read-failures.ts.
  const reads = new ReadFailureLog();

  const packagesResult = await supabase
    .from("aerial_evidence_packages")
    .select(
      "id, title, package_type, status, verification_readiness, notes, created_at, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .eq("mission_id", missionId)
    .order("created_at", { ascending: false });

  const packagesUnreadable = reads.check("evidence packages for this mission", packagesResult);
  const pkgRows = packagesResult.data;

  const packages: PackageRow[] = (pkgRows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    package_type: row.package_type,
    status: row.status as AerialPackageStatus,
    verification_readiness: row.verification_readiness as AerialVerificationReadiness,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const posture = buildAerialProjectPosture(
    [{ status: mission.status }],
    packages.map((p) => ({ status: p.status, verification_readiness: p.verification_readiness }))
  );
  const packagePosture = summarizeAerialMissionPackagePosture(packages);
  const attachmentSummary = summarizeAerialEvidenceAttachmentReadiness({
    missionTitle: mission.title,
    missionStatus: mission.status,
    missionType: mission.mission_type,
    hasProjectLink: Boolean(project?.id),
    hasAoi,
    packages,
  });
  const postureDescription = describeAerialProjectPosture(posture);
  // Read on the server, from the same condition the dispatch route decides on,
  // so this page cannot tell a configured deployment that its worker is a
  // future release. See src/lib/aerial/processing-availability.ts.
  const workerConfigured = isAerialProcessingWorkerConfigured();
  const unconfiguredNotice = describeAerialProcessingAvailability(false);
  const canRequestProcessing = workerConfigured && !isReadOnlyWorkspaceRole(membership.role);
  const processingSurface = describeAerialProcessingRequestSurface({
    workerConfigured,
    canRequest: canRequestProcessing,
  });

  // ── Imagery processing jobs ────────────────────────────────────────────
  // `aerial_processing_jobs` has been written by the dispatch route and the
  // processing callback since 20260721000001 and read back by nothing. An
  // operator who dispatched a flight saw a page that rendered as though it had
  // never happened.
  const renderedAt = new Date();
  const silenceMinutes = resolveAerialProcessingSilenceMinutes(
    process.env.OPENPLAN_AERIAL_PROCESSING_SILENCE_MINUTES
  );
  const {
    jobs: processingJobs,
    unreadableReason: processingJobsUnreadable,
    truncated: processingJobsTruncated,
  } = await loadAerialProcessingJobsForMission(supabase, { workspaceId, missionId });

  /*
    WHAT OPENPLAN ACTUALLY HOLDS for each of those jobs.

    This loader was written alongside the custody engine and had NO CALLER — so
    the bytes were being fetched, hashed and stored, and no planner could see
    that any of it had happened, or that an orthomosaic's vendor link had lapsed
    with nothing held behind it. Meanwhile the panel carried a standing sentence
    saying "OpenPlan records the list, not the files", which the custody work had
    just made false.

    Read separately from the jobs rather than joined, so a failure here degrades
    to "we could not establish what is held" instead of taking the whole job
    list down with it. Those are different sentences and the panel says both.
  */
  const { byProcessingJobId: custodyByJobId, unreadableReason: custodyUnreadable } =
    await loadAerialArtifactCustodyForMission(supabase, missionId);
  const processingJobSummaries = processingJobs.map((job) =>
    summarizeAerialProcessingJob(job, { now: renderedAt, silenceMinutes })
  );
  const processingPosture = summarizeAerialMissionProcessingPosture(processingJobSummaries);

  const attachmentSummaryTone =
    attachmentSummary.readiness === "ready"
      ? "success"
      : attachmentSummary.readiness === "needs_source_context"
        ? "warning"
        : "neutral";

  const columns: Array<DataTableColumn<PackageRow>> = [
    { id: "title", header: "Package", cell: (row) => row.title },
    { id: "type", header: "Type", cell: (row) => row.package_type },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge tone={aerialPackageStatusTone(row.status)}>
          {formatAerialPackageStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
    {
      id: "verification",
      header: "Verification",
      cell: (row) => (
        <StatusBadge tone={aerialVerificationReadinessTone(row.verification_readiness)}>
          {formatAerialVerificationReadinessLabel(row.verification_readiness)}
        </StatusBadge>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      align: "right",
      cell: (row) => formatDate(row.updated_at),
    },
  ];

  const header = (
    <div className="flex flex-col gap-3">
      <Link
        href="/aerial"
        className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Aerial Ops
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
          <PlaneTakeoff className="h-3 w-3" />
          Aerial mission
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{mission.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={aerialMissionStatusTone(mission.status as AerialMissionStatus)}>
            {formatAerialMissionStatusLabel(mission.status)}
          </StatusBadge>
          <span className="text-xs text-muted-foreground">
            {formatAerialMissionTypeLabel(mission.mission_type)}
          </span>
          {mission.geography_label ? (
            <span className="text-xs text-muted-foreground">· {mission.geography_label}</span>
          ) : null}
        </div>
      </div>
    </div>
  );

  // Every number in the two groups below is derived from the evidence-package
  // read. If that read failed, "0 ready · 0 total" is not a small inaccuracy —
  // it is the page stating a finding it does not have.
  const evidenceChain = (
    <Inspector
      title="Evidence chain"
      subtitle={
        packagesUnreadable
          ? (reads.describe() ?? "Some of this page could not be read.")
          : (postureDescription ??
            "Once packages are recorded and marked ready, their verification chain will summarize here.")
      }
    >
      {packagesUnreadable ? (
        <InspectorGroup label="This mission only">
          <InspectorEmpty
            title="Evidence packages could not be read"
            description="Package counts, verification state, and attachment readiness are all derived from that read, so none of them are shown. They are unavailable, not zero."
          />
        </InspectorGroup>
      ) : (
        <>
      <InspectorGroup label="This mission only">
        <InspectorField
          label="Packages recorded"
          value={`${posture.readyPackageCount} ready · ${packages.length} total`}
          hint={packagePosture.attachmentReadyLabel}
        />
        <InspectorField
          label="Verification"
          value={
            <StatusBadge
              tone={aerialVerificationReadinessTone(
                posture.verificationReadiness === "none" ? "pending" : posture.verificationReadiness
              )}
            >
              {posture.verificationReadiness === "none"
                ? "No packages yet"
                : formatAerialVerificationReadinessLabel(posture.verificationReadiness)}
            </StatusBadge>
          }
        />
      </InspectorGroup>

      <InspectorGroup label="Attachment readiness">
        <InspectorField
          label="Project / grant / report"
          value={<StatusBadge tone={attachmentSummaryTone}>{attachmentSummary.label}</StatusBadge>}
          hint={attachmentSummary.detail}
        />
        <InspectorField
          label="Source context"
          value={`${attachmentSummary.sourceContextPackageCount}/${Math.max(attachmentSummary.attachmentReadyPackageCount, packages.length)} source-backed`}
          hint={attachmentSummary.sourceContext}
        />
        {attachmentSummary.blockers.length > 0 ? (
          <div className="rounded-md border border-[color:var(--line)] bg-background/60 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Before attaching downstream</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {attachmentSummary.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </InspectorGroup>
        </>
      )}

      <InspectorGroup label="Processing jobs">
        {processingJobsUnreadable ? (
          <InspectorEmpty
            title="Processing jobs could not be read"
            description="OpenPlan cannot say whether this mission has jobs running. Do not read the absence of a job as evidence that nothing was dispatched."
          />
        ) : processingPosture.jobCount === 0 ? (
          <InspectorEmpty
            title="Nothing dispatched yet"
            description="No imagery has been sent to a processing worker for this mission."
          />
        ) : (
          <>
            <InspectorField
              label="Jobs recorded"
              // The list is capped, so "total" is only true when the read was
              // not truncated. Every count beside it describes the shown page.
              value={
                processingJobsTruncated
                  ? `${processingPosture.jobCount} most recent`
                  : `${processingPosture.jobCount} total`
              }
              hint={`${processingPosture.succeededCount} succeeded · ${processingPosture.failedCount} failed · ${processingPosture.canceledCount} canceled${
                processingJobsTruncated
                  ? `, across the ${processingPosture.jobCount} shown. This mission has more jobs than that, so these are not totals for the mission.`
                  : ""
              }`}
            />
            <InspectorField
              label="Still open"
              value={
                <StatusBadge tone={processingPosture.tone}>{processingPosture.label}</StatusBadge>
              }
              hint={
                processingPosture.silentCount > 0
                  ? `${processingPosture.silentCount} job${processingPosture.silentCount === 1 ? " has" : "s have"} sent no callback inside this deployment's ${silenceMinutes}-minute reporting window. That is silence, not a verdict — the work may still be running on the worker.`
                  : "OpenPlan learns a job's state only from worker callbacks; it never polls."
              }
            />
          </>
        )}
      </InspectorGroup>

      <InspectorGroup label="Linked project">
        {project ? (
          <InspectorField
            label="Project"
            value={
              <Link
                href={`/projects/${project.id}`}
                className="text-sky-400 hover:underline"
              >
                {project.name}
              </Link>
            }
            hint="Evidence packages flowing ready here will refresh this project's aerial posture."
          />
        ) : (
          <InspectorEmpty
            title="Not linked to a project"
            description="Missions without a project link cannot feed aerial posture back to RTP/grants."
          />
        )}
      </InspectorGroup>

      {project ? (
        <InspectorGroup label="Project aerial posture (cached)">
          {projectAerialPosture ? (
            <>
              <InspectorField
                label="Roll-up"
                value={`${projectAerialPosture.readyPackageCount} ready · ${projectAerialPosture.missionCount} mission${projectAerialPosture.missionCount === 1 ? "" : "s"}`}
                hint={projectAerialPostureDetail ?? undefined}
              />
              <InspectorField
                label="Verification"
                value={
                  <StatusBadge
                    tone={aerialVerificationReadinessTone(
                      projectAerialPosture.verificationReadiness === "none"
                        ? "pending"
                        : projectAerialPosture.verificationReadiness
                    )}
                  >
                    {projectAerialPosture.verificationReadiness === "none"
                      ? "No missions yet"
                      : formatAerialVerificationReadinessLabel(projectAerialPosture.verificationReadiness)}
                  </StatusBadge>
                }
              />
              <InspectorField
                label="Posture cached"
                value={formatDateTime(projectAerialPostureUpdatedAt)}
                hint="Read from the aerial_project_posture table — refreshed after evidence-package mutations."
              />
            </>
          ) : (
            <InspectorEmpty
              title="Posture not yet cached"
              description="Will populate after the first evidence-package mutation on this project's missions."
            />
          )}
        </InspectorGroup>
      ) : null}

      <InspectorGroup label="Timing">
        <InspectorField label="Collected" value={formatDate(mission.collected_at)} />
        <InspectorField label="Created" value={formatDate(mission.created_at)} />
        <InspectorField label="Updated" value={formatDate(mission.updated_at)} />
      </InspectorGroup>

      {mission.notes ? (
        <InspectorGroup label="Mission notes">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{mission.notes}</p>
        </InspectorGroup>
      ) : null}
    </Inspector>
  );

  return (
    <>
      <CartographicSurfaceWide />
      <Worksurface
      ariaLabel={`Aerial mission ${mission.title}`}
      header={header}
      worksurface={
        <>
          <WorksurfaceSection
            id="aerial-mission-authoring"
            label="Authoring"
            title="Mission AOI & export"
            // "or request ODM processing" used to close this line, but nothing
            // in this section requests anything. Requesting imagery processing
            // now has its own section below, so this one describes only what it
            // actually does.
            description="Draw the area of interest and export a DJI waypoint file for pilot handoff."
            trailing={
              <StatusBadge tone={hasAoi ? "success" : "neutral"}>
                {hasAoi ? `${aoiVertexCount} vertex polygon` : "No AOI yet"}
              </StatusBadge>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link href={`/aerial/missions/${mission.id}/edit`}>
                  <Hexagon className="h-4 w-4" />
                  {hasAoi ? "Edit AOI" : "Draw AOI"}
                </Link>
              </Button>
              {hasAoi ? (
                <Button asChild variant="outline">
                  <a href={`/api/aerial/missions/${mission.id}/export?format=dji-json`}>
                    <Download className="h-4 w-4" />
                    Export DJI JSON
                  </a>
                </Button>
              ) : null}
            </div>
          </WorksurfaceSection>
          <WorksurfaceSection
            id="aerial-mission-processing"
            label="Processing"
            title="Imagery processing jobs"
            description={
              processingJobsTruncated
                ? `The ${processingPosture.jobCount} most recent processing jobs for this mission, in the state the worker last reported them. This mission has more than that; older jobs are not shown. OpenPlan cannot poll the worker, so a job advances only when a callback arrives — what is shown is as of the last one.`
                : "Every processing job dispatched for this mission, in the state the worker last reported it. OpenPlan cannot poll the worker, so a job advances only when a callback arrives — what is shown is as of the last one."
            }
            // A roll-up derived from a read that failed is not a small
            // inaccuracy — "No processing jobs" is an answer, and this page does
            // not have one. Same treatment the packages section below gets.
            trailing={
              processingJobsUnreadable ? (
                <StatusBadge tone="danger">Unavailable</StatusBadge>
              ) : (
                <StatusBadge tone={processingPosture.tone}>{processingPosture.label}</StatusBadge>
              )
            }
          >
            {workerConfigured ? (
              <StateBlock
                title={processingSurface.title}
                description={processingSurface.description}
                tone={processingSurface.tone === "info" ? "info" : "neutral"}
                compact
              />
            ) : (
              <StateBlock
                title={unconfiguredNotice.title}
                description={unconfiguredNotice.description}
                tone="info"
                compact
              />
            )}

            {canRequestProcessing ? (
              <div className="mt-3">
                <AerialProcessingRequestForm missionId={mission.id} />
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              <AerialProcessingFreshness
                renderedAt={renderedAt.toISOString()}
                hasOpenJob={processingPosture.hasOpenJob}
              />
              <AerialProcessingJobsPanel
                jobs={processingJobs}
                summaries={processingJobSummaries}
                now={renderedAt}
                unreadableReason={processingJobsUnreadable}
          custodyByJobId={custodyByJobId}
          custodyUnreadableReason={custodyUnreadable}
                truncated={processingJobsTruncated}
              />
            </div>
          </WorksurfaceSection>
          <WorksurfaceSection
            id="aerial-mission-packages"
            label="Evidence"
            title="Packages"
            description="Each package captures a processed output (orthos, models, surfaces, QA bundles) with its status, verification readiness, and report-attachment posture."
            trailing={
              packagesUnreadable ? (
                <StatusBadge tone="danger">Unavailable</StatusBadge>
              ) : (
                <StatusBadge tone={packagePosture.attachmentReady ? "success" : packagePosture.tone}>
                  {packagePosture.attachmentReadyLabel}
                </StatusBadge>
              )
            }
          >
            {packagesUnreadable ? (
              <StateBlock
                tone="danger"
                title="Evidence packages could not be read"
                description={`${reads.messages().join(" ")} An empty list here would not mean this mission has no packages — the query failed, so OpenPlan cannot say either way.`}
              />
            ) : (
              <DataTable<PackageRow>
                columns={columns}
                rows={packages}
                getRowId={(row) => row.id}
                density="compact"
                emptyState={
                  <EmptyState
                    title="No evidence packages yet"
                    description="Once packages are recorded for this mission, they will appear here with status and verification state."
                  />
                }
              />
            )}
          </WorksurfaceSection>
        </>
      }
      inspector={evidenceChain}
    />
    </>
  );
}
