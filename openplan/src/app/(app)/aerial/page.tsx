import Link from "next/link";
import { redirect } from "next/navigation";
import { PlaneTakeoff } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { Worksurface, WorksurfaceSection } from "@/components/ui/worksurface";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  aerialMissionStatusTone,
  formatAerialMissionStatusLabel,
  formatAerialMissionTypeLabel,
  summarizeAerialMissionPackagePosture,
  type AerialMissionPackagePosture,
  type AerialMissionStatus,
  type AerialMissionType,
} from "@/lib/aerial/catalog";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

/**
 * `?projectId=` is how this register is TOLD which project it was opened for.
 *
 * THE DEFECT. The project spine board's Aerial evidence lane counts the missions
 * tied to one project — "2 missions tied to this project; 1 package ready" — and
 * then linked to a bare `/aerial`, which is every mission in the workspace in
 * reverse-chronological order. The planner arrived at a list that did not
 * contain the sentence they had just read, and had to find the two rows by
 * scanning the Project column. The board could not pass the id because this page
 * declared no `searchParams` to receive it.
 *
 * Optional on purpose: opening Aerial Ops from the sidebar still shows the whole
 * register, and says that is what it is showing.
 */
type AerialIndexSearchParams = Promise<{ projectId?: string | string[] }>;

/** First value of a repeatable query parameter, trimmed, or null. */
function singleParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

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
  package_posture: AerialMissionPackagePosture;
};

export default async function AerialIndexPage({
  searchParams,
}: {
  searchParams?: AerialIndexSearchParams;
}) {
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
        title="Aerial Ops needs a workspace"
        description="Missions and evidence packages belong to a workspace. You are signed in, but this account is not in one yet — join a workspace or create one before planning aerial operations."
      />
    );
  }

  const workspaceId = membership.workspace_id;
  const requestedProjectId = singleParam((await searchParams)?.projectId);

  // Every read on this page feeds either a count or a list, and both of those
  // render a failed read as "zero" unless something says otherwise. Collect the
  // failures and disclose them; an empty register is a claim about the workspace.
  const reads = new ReadFailureLog();

  // Resolve the requested project BEFORE listing missions, because an empty
  // filtered register is a sentence about that project ("no missions are linked
  // to it") and the page has to have earned the right to say it. Scoped to this
  // workspace deliberately: the id arrives from a URL, so "some project by that
  // id exists" is not the question. RLS would refuse a foreign row anyway;
  // asking here turns it into an answer the page can explain rather than an
  // empty list it would have to guess at.
  const projectResult = requestedProjectId
    ? await supabase
        .from("projects")
        .select("id, name")
        .eq("id", requestedProjectId)
        .eq("workspace_id", workspaceId)
        .maybeSingle()
    : { data: null, error: null };

  const projectUnreadable = requestedProjectId
    ? reads.check("the project this register was opened for", projectResult)
    : false;

  const focusProject = (projectResult.data ?? null) as { id: string; name: string | null } | null;
  const focusLabel = focusProject ? focusProject.name?.trim() || "the project this page was opened for" : null;

  // Filtered in the database, not in memory. The register is capped at 100 rows,
  // so narrowing after the fetch would silently drop a project's older missions
  // behind ninety-nine newer ones belonging to other projects — and report the
  // shortfall as "this project has fewer missions than the board said".
  let missionsQuery = supabase
    .from("aerial_missions")
    .select(
      "id, title, status, mission_type, geography_label, collected_at, created_at, project_id, projects:projects!aerial_missions_project_id_fkey(name)"
    )
    .eq("workspace_id", workspaceId);

  if (focusProject) {
    missionsQuery = missionsQuery.eq("project_id", focusProject.id);
  }

  const missionsResult = await missionsQuery.order("created_at", { ascending: false }).limit(100);
  // Named for what was actually asked for. When the register is narrowed, the
  // failed read is not "this workspace's missions" — the query never looked at
  // the workspace, and a disclosure that overstates its own scope is the same
  // class of error the disclosure exists to prevent.
  const missionsUnreadable = reads.check(
    focusLabel ? `the aerial missions linked to ${focusLabel}` : "this workspace's aerial missions",
    missionsResult
  );
  const missionsRaw = missionsResult.data;

  const missionIds = (missionsRaw ?? []).map((m) => m.id);
  const packagesByMissionId = new Map<string, Array<{ status: string; verification_readiness: string | null }>>();
  let packagesUnreadable = false;

  if (missionIds.length > 0) {
    const packagesResult = await supabase
      .from("aerial_evidence_packages")
      .select("mission_id, status, verification_readiness")
      .eq("workspace_id", workspaceId)
      .in("mission_id", missionIds);

    packagesUnreadable = reads.check("evidence packages for these missions", packagesResult);

    for (const pkg of packagesResult.data ?? []) {
      const existing = packagesByMissionId.get(pkg.mission_id) ?? [];
      existing.push({ status: pkg.status, verification_readiness: pkg.verification_readiness });
      packagesByMissionId.set(pkg.mission_id, existing);
    }
  }

  const missions: AerialMissionRow[] = (missionsRaw ?? []).map((row) => {
    const packagePosture = summarizeAerialMissionPackagePosture(packagesByMissionId.get(row.id) ?? []);
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
      package_count: packagePosture.packageCount,
      ready_package_count: packagePosture.readyPackageCount,
      package_posture: packagePosture,
    };
  });

  const totalMissions = missions.length;
  const activeMissions = missions.filter((m) => m.status === "active").length;
  const completeMissions = missions.filter((m) => m.status === "complete").length;
  const readyPackages = missions.reduce((acc, m) => acc + m.ready_package_count, 0);

  /**
   * A count only gets to be a number if the read behind it succeeded.
   *
   * `missions` is `[]` both when this workspace has no missions and when the
   * query failed, and every tile below would have printed the second case as a
   * confident "0". An em dash plus the disclosure banner is the difference
   * between "none" and "not known".
   */
  const missionCount = (value: number) => (missionsUnreadable ? "—" : String(value));
  const packageCount = missionsUnreadable || packagesUnreadable ? "—" : String(readyPackages);

  /**
   * Why the register is not narrowed to the project it was opened for, when it
   * is not. Falling through to the whole workspace is the safe behaviour — it
   * shows more, not less — but leaving it unexplained would let a full register
   * pass for a project's own missions.
   */
  const projectFilterNotice = !requestedProjectId
    ? null
    : projectUnreadable
      ? "This page was opened for a project whose record could not be read, so the register below was not narrowed to it. Every mission in this workspace is listed."
      : !focusProject
        ? "This page was opened for a project that is not in this workspace, so the register below was not narrowed to it. Every mission in this workspace is listed."
        : null;

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
        // "0" here would be a claim that this mission carries no evidence
        // package, which a failed package read cannot support.
        packagesUnreadable ? (
          <span className="text-muted-foreground">unknown</span>
        ) : row.package_count === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <StatusBadge tone={row.package_posture.tone}>{row.package_posture.label}</StatusBadge>
        ),
    },
  ];

  const header = (
    <div className="flex flex-col gap-4">
      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this page could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      {projectFilterNotice ? (
        <StateBlock
          tone="warning"
          title="This register was not narrowed to that project"
          description={projectFilterNotice}
        />
      ) : null}

      <div className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <PlaneTakeoff className="h-3.5 w-3.5" />
            Aerial operations lane
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Aerial Ops</h1>
            <p className="module-intro-description">
              Plan flights, track what came back from them, and attach the imagery that is ready to verify to the project it belongs to.
            </p>
            {focusLabel ? (
              // Named, and reversible in one click. Every count and every row
              // below is this project's, so the page has to say so somewhere the
              // reader cannot miss — otherwise the numbers read as the
              // workspace's.
              <p className="module-intro-description">
                Showing only missions linked to {focusLabel}.{" "}
                <Link href="/aerial" className="underline underline-offset-2 hover:text-foreground">
                  Show every mission in this workspace
                </Link>
                .
              </p>
            ) : null}
          </div>
          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Missions</p>
              <p className="module-summary-value">{missionCount(totalMissions)}</p>
              <p className="module-summary-detail">
                {focusLabel
                  ? `Planned, active, and completed missions linked to ${focusLabel}.`
                  : "Planned, active, and completed missions in this workspace."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{missionCount(activeMissions)}</p>
              <p className="module-summary-detail">Missions currently flying or in capture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Complete</p>
              <p className="module-summary-value">{missionCount(completeMissions)}</p>
              <p className="module-summary-detail">Missions whose collection phase is done.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Ready packages</p>
              <p className="module-summary-value">{packageCount}</p>
              <p className="module-summary-detail">Evidence packages marked ready or shared.</p>
            </div>
          </div>
        </article>
      </div>
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
          description={
            focusLabel
              ? `Chronological log of the aerial missions linked to ${focusLabel}. Open a mission to see evidence packages and verification state.`
              : "Chronological log of aerial missions. Open a mission to see evidence packages and verification state."
          }
          trailing={
            <StatusBadge tone="neutral">
              {missionsUnreadable ? "count unavailable" : `${totalMissions} total`}
            </StatusBadge>
          }
        >
          <DataTable<AerialMissionRow>
            columns={columns}
            rows={missions}
            getRowId={(row) => row.id}
            density="compact"
            emptyState={
              // Three different absences, three different sentences. There used
              // to be one — the workspace-wide "no missions recorded yet" — and
              // it was printed for a failed read and a narrowed register too.
              missionsUnreadable ? (
                <EmptyState
                  title="Missions could not be read"
                  description="The mission register did not load, so this list is unavailable rather than empty. An empty list here is not evidence that no missions exist."
                />
              ) : focusLabel ? (
                <EmptyState
                  title={`No aerial missions are linked to ${focusLabel}`}
                  description="This register was narrowed to one project; other missions may exist in this workspace. Create a mission for this project, or clear the filter to see the whole register."
                />
              ) : (
                <EmptyState
                  title="No aerial missions recorded yet"
                  description="Once missions are created for this workspace, they will appear here with their packages and verification state."
                />
              )
            }
          />
        </WorksurfaceSection>
      }
    />
  );
}
