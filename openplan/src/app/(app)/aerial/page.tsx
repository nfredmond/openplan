import Link from "next/link";
import { redirect } from "next/navigation";
import { PlaneTakeoff } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { Worksurface, WorksurfaceSection } from "@/components/ui/worksurface";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  aerialMissionStatusTone,
  formatAerialMissionStatusLabel,
  formatAerialMissionTypeLabel,
  type AerialMissionStatus,
  type AerialMissionType,
} from "@/lib/aerial/catalog";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

type AerialMissionRow = {
  id: string;
  title: string;
  status: AerialMissionStatus;
  mission_type: AerialMissionType;
  geography_label: string | null;
  collected_at: string | null;
  created_at: string;
  project_id: string | null;
  project_name: string | null;
  package_count: number;
  ready_package_count: number;
};

export default async function AerialIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/aerial");
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership?.workspace_id) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Aerial operations"
        title="Aerial Ops needs a provisioned workspace"
        description="Missions and evidence packages are workspace-scoped. Create or join a workspace before planning aerial operations."
      />
    );
  }

  const workspaceId = membership.workspace_id;

  const { data: missionsRaw } = await supabase
    .from("aerial_missions")
    .select(
      "id, title, status, mission_type, geography_label, collected_at, created_at, project_id, projects:projects!aerial_missions_project_id_fkey(name)"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);

  const missionIds = (missionsRaw ?? []).map((m) => m.id);
  const packageCounts = new Map<string, { total: number; ready: number }>();

  if (missionIds.length > 0) {
    const { data: pkgs } = await supabase
      .from("aerial_evidence_packages")
      .select("mission_id, status")
      .eq("workspace_id", workspaceId)
      .in("mission_id", missionIds);

    for (const pkg of pkgs ?? []) {
      const existing = packageCounts.get(pkg.mission_id) ?? { total: 0, ready: 0 };
      existing.total += 1;
      if (pkg.status === "ready" || pkg.status === "shared") {
        existing.ready += 1;
      }
      packageCounts.set(pkg.mission_id, existing);
    }
  }

  const missions: AerialMissionRow[] = (missionsRaw ?? []).map((row) => {
    const counts = packageCounts.get(row.id) ?? { total: 0, ready: 0 };
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: row.id,
      title: row.title,
      status: row.status as AerialMissionStatus,
      mission_type: row.mission_type as AerialMissionType,
      geography_label: row.geography_label,
      collected_at: row.collected_at,
      created_at: row.created_at,
      project_id: row.project_id,
      project_name: project?.name ?? null,
      package_count: counts.total,
      ready_package_count: counts.ready,
    };
  });

  const totalMissions = missions.length;
  const activeMissions = missions.filter((m) => m.status === "active").length;
  const completeMissions = missions.filter((m) => m.status === "complete").length;
  const readyPackages = missions.reduce((acc, m) => acc + m.ready_package_count, 0);

  const columns: Array<DataTableColumn<AerialMissionRow>> = [
    {
      id: "title",
      header: "Mission",
      cell: (row) => (
        <Link
          href={`/aerial/missions/${row.id}`}
          className="text-foreground hover:underline"
        >
          {row.title}
        </Link>
      ),
    },
    {
      id: "project",
      header: "Project",
      cell: (row) =>
        row.project_id && row.project_name ? (
          <Link
            href={`/projects/${row.project_id}`}
            className="text-sky-400 hover:underline"
          >
            {row.project_name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => formatAerialMissionTypeLabel(row.mission_type),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge tone={aerialMissionStatusTone(row.status)}>
          {formatAerialMissionStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
    {
      id: "geography",
      header: "Geography",
      cell: (row) => row.geography_label ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "packages",
      header: "Packages",
      align: "right",
      cell: (row) =>
        row.package_count === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span>
            {row.ready_package_count}/{row.package_count}
          </span>
        ),
    },
  ];

  const header = (
    <div className="module-header-grid">
      <article className="module-intro-card">
        <div className="module-intro-kicker">
          <PlaneTakeoff className="h-3.5 w-3.5" />
          Aerial operations lane
        </div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">Aerial Ops</h1>
          <p className="module-intro-description">
            Plan aerial missions, track evidence packages, and link verification-ready captures back to project posture.
          </p>
        </div>
        <div className="module-summary-grid cols-4">
          <div className="module-summary-card">
            <p className="module-summary-label">Missions</p>
            <p className="module-summary-value">{totalMissions}</p>
            <p className="module-summary-detail">Planned, active, and completed missions in this workspace.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Active</p>
            <p className="module-summary-value">{activeMissions}</p>
            <p className="module-summary-detail">Missions currently flying or in capture.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Complete</p>
            <p className="module-summary-value">{completeMissions}</p>
            <p className="module-summary-detail">Missions whose collection phase is done.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Ready packages</p>
            <p className="module-summary-value">{readyPackages}</p>
            <p className="module-summary-detail">Evidence packages marked ready or shared.</p>
          </div>
        </div>
      </article>
    </div>
  );

  return (
    <Worksurface
      ariaLabel="Aerial operations"
      header={header}
      worksurface={
        <WorksurfaceSection
          id="aerial-missions-list"
          label="Missions"
          title="Mission register"
          description="Chronological log of aerial missions. Open a mission to see evidence packages and verification state."
          trailing={<StatusBadge tone="neutral">{totalMissions} total</StatusBadge>}
        >
          <DataTable<AerialMissionRow>
            columns={columns}
            rows={missions}
            getRowId={(row) => row.id}
            density="compact"
            emptyState={
              <EmptyState
                title="No aerial missions recorded yet"
                description="Once missions are created for this workspace, they will appear here with their packages and verification state."
              />
            }
          />
        </WorksurfaceSection>
      }
    />
  );
}
