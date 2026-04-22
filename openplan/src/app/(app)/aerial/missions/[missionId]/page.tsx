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
import { isAoiPolygonGeoJson } from "@/lib/aerial/dji-export";
import {
  aerialMissionStatusTone,
  aerialPackageStatusTone,
  aerialVerificationReadinessTone,
  buildAerialProjectPosture,
  describeAerialProjectPosture,
  formatAerialMissionStatusLabel,
  formatAerialMissionTypeLabel,
  formatAerialPackageStatusLabel,
  formatAerialVerificationReadinessLabel,
  type AerialMissionStatus,
  type AerialPackageStatus,
  type AerialProjectPosture,
  type AerialVerificationReadiness,
} from "@/lib/aerial/catalog";
import { createClient } from "@/lib/supabase/server";
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

function isAerialProjectPosture(value: unknown): value is AerialProjectPosture {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.missionCount === "number" &&
    typeof v.activeMissionCount === "number" &&
    typeof v.completeMissionCount === "number" &&
    typeof v.readyPackageCount === "number" &&
    typeof v.verificationReadiness === "string"
  );
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
        title="Aerial mission detail needs a provisioned workspace"
        description="Missions are workspace-scoped. Join or create a workspace to open mission records."
      />
    );
  }

  const workspaceId = membership.workspace_id;

  const { data: mission, error: missionErr } = await supabase
    .from("aerial_missions")
    .select(
      "id, workspace_id, project_id, title, status, mission_type, geography_label, collected_at, notes, aoi_geojson, created_at, updated_at, projects:projects!aerial_missions_project_id_fkey(id, name, aerial_posture, aerial_posture_updated_at)"
    )
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (missionErr || !mission) {
    notFound();
  }

  const project = Array.isArray(mission.projects) ? mission.projects[0] : mission.projects;
  const projectAerialPosture = isAerialProjectPosture(project?.aerial_posture) ? project.aerial_posture : null;
  const projectAerialPostureUpdatedAt =
    typeof project?.aerial_posture_updated_at === "string" ? project.aerial_posture_updated_at : null;
  const projectAerialPostureDetail = projectAerialPosture
    ? describeAerialProjectPosture(projectAerialPosture)
    : null;
  const hasAoi = isAoiPolygonGeoJson(mission.aoi_geojson);
  const aoiVertexCount = hasAoi
    ? Math.max(0, (mission.aoi_geojson as { coordinates: [number, number][][] }).coordinates[0].length - 1)
    : 0;

  const { data: pkgRows } = await supabase
    .from("aerial_evidence_packages")
    .select(
      "id, title, package_type, status, verification_readiness, notes, created_at, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .eq("mission_id", missionId)
    .order("created_at", { ascending: false });

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
  const postureDescription = describeAerialProjectPosture(posture);

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

  const evidenceChain = (
    <Inspector
      title="Evidence chain"
      subtitle={
        postureDescription ??
        "Once packages are recorded and marked ready, their verification chain will summarize here."
      }
    >
      <InspectorGroup label="This mission only">
        <InspectorField
          label="Packages recorded"
          value={`${posture.readyPackageCount} ready · ${packages.length} total`}
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
                hint="Read from projects.aerial_posture — refreshed after evidence-package mutations."
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
            description="Draw the area of interest, export a DJI waypoint file for pilot handoff, or request ODM processing."
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
            <StateBlock
              className="mt-3"
              title="ODM processing is not implemented"
              description="Imagery → ortho/DSM processing is explicitly out of scope for this prototype. The POST /api/aerial/missions/[id]/process endpoint returns HTTP 501 with an honest integration-boundary payload. No fake processing, no silent stubs."
              tone="warning"
              compact
            />
          </WorksurfaceSection>
          <WorksurfaceSection
            id="aerial-mission-packages"
            label="Evidence"
            title="Packages"
            description="Each package captures a processed output (orthos, models, surfaces, QA bundles) with its status and verification readiness."
            trailing={<StatusBadge tone="neutral">{packages.length} total</StatusBadge>}
          >
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
          </WorksurfaceSection>
        </>
      }
      inspector={evidenceChain}
    />
    </>
  );
}
