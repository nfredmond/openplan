import Link from "next/link";
import { redirect } from "next/navigation";

import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceBesideTheMap } from "@/components/cartographic/surface-beside-the-map";
import { AerialMissionShowOnMap } from "@/components/aerial/aerial-mission-show-on-map";
import { fitInstructionFromGeometry, type FitInstruction } from "@/lib/cartographic/geometry-bbox";
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
import { AerialMissionLauncher, type AerialMissionLauncherProject } from "@/components/aerial/aerial-mission-launcher";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { moduleMetadata } from "@/lib/ui/page-title";
import { PlanningContextStrip } from "@/components/projects/planning-context-strip";
import {
  resolvePlanningContext,
  withPlanningContext,
} from "@/lib/projects/planning-context";

export const metadata = moduleMetadata("Aerial Imagery");

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
 * Optional on purpose: opening Aerial Imagery from the sidebar still shows the whole
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
  /** Where "Show on map" sends the camera; null when no usable area is drawn. */
  map_focus: FitInstruction | null;
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
        moduleLabel="Aerial Imagery"
        title="Aerial Imagery needs a workspace"
        description="Missions and evidence packages belong to a workspace. You are signed in, but this account is not in one yet. Join a workspace or create one before planning a mission."
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
  const planningContext = resolvePlanningContext(
    requestedProjectId,
    focusProject,
    requestedProjectId && projectUnreadable
      ? projectResult.error ?? { message: "Project context could not be read." }
      : null
  );
  const focusLabel = focusProject ? focusProject.name?.trim() || "the project this page was opened for" : null;

  // The picker's page size, not a place or a policy: when a workspace has more
  // projects than this, the launcher says so on screen instead of silently
  // offering a partial list as the whole one.
  const PROJECT_PICKER_LIMIT = 200;

  // The project list behind the "Start a mission" picker. Every mission belongs
  // to a project (the API requires it — the link is what carries imagery into
  // the evidence chain), so the register can only offer creation if it can also
  // offer the workspace's projects to hang the mission on.
  const projectListResult = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(PROJECT_PICKER_LIMIT);

  const projectListUnreadable = reads.check(
    "this workspace's projects (needed to start a new mission)",
    projectListResult
  );

  const projectListRaw = Array.isArray(projectListResult.data)
    ? (projectListResult.data as Array<{ id: string; name: string | null }>)
    : [];
  const launcherProjects: AerialMissionLauncherProject[] = projectListRaw.map((project) => ({
    id: project.id,
    name: project.name?.trim() || "Untitled project",
  }));

  // Filtered in the database, not in memory. The register is capped at 100 rows,
  // so narrowing after the fetch would silently drop a project's older missions
  // behind ninety-nine newer ones belonging to other projects — and report the
  // shortfall as "this project has fewer missions than the board said".
  let missionsQuery = supabase
    .from("aerial_missions")
    .select(
      "id, title, status, mission_type, geography_label, collected_at, created_at, project_id, aoi_geojson, projects:projects!aerial_missions_project_id_fkey(name)"
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
      map_focus: fitInstructionFromGeometry(row.aoi_geojson),
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

  const missionHref = (id: string) =>
    withPlanningContext(
      `/aerial/missions/${id}`,
      planningContext.status === "active" ? planningContext.project.id : null
    );

  const missionList =
    missions.length === 0 ? (
      // Three different absences, three different sentences. There used to be
      // one, the workspace-wide "no missions recorded yet", and it was printed
      // for a failed read and a narrowed register too.
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
          description="Start the first one below. It will appear here with its evidence packages and its area on the map."
        />
      )
    ) : (
      <ul className="divide-y divide-border/60" aria-label="Missions">
        {missions.map((row) => (
          <li key={row.id} className="space-y-1.5 py-3" data-testid="aerial-mission-row">
            <div className="flex items-start justify-between gap-3">
              <Link href={missionHref(row.id)} className="min-w-0 font-medium text-foreground hover:underline">
                {row.title}
              </Link>
              <StatusBadge tone={aerialMissionStatusTone(row.status)}>
                {formatAerialMissionStatusLabel(row.status)}
              </StatusBadge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {formatAerialMissionTypeLabel(row.mission_type)}
              {row.geography_label ? ` · ${row.geography_label}` : null}
              {" · "}
              {row.project_id && row.project_name ? (
                <Link href={`/projects/${row.project_id}`} className="underline underline-offset-2 hover:text-foreground">
                  {row.project_name}
                </Link>
              ) : (
                "No project linked"
              )}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              {/* "0" would claim this mission carries no evidence package, which a failed package read cannot support. */}
              {packagesUnreadable ? (
                <span className="text-muted-foreground">Evidence packages: unknown</span>
              ) : row.package_count === 0 ? (
                <span className="text-muted-foreground">No evidence packages yet</span>
              ) : (
                <StatusBadge tone={row.package_posture.tone}>{row.package_posture.label}</StatusBadge>
              )}
              {row.map_focus ? (
                <AerialMissionShowOnMap title={row.title} focus={row.map_focus} />
              ) : (
                <span className="text-muted-foreground">No area drawn yet</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    );

  const stats: Array<{ label: string; value: string }> = [
    { label: "Missions", value: missionCount(totalMissions) },
    { label: "Active", value: missionCount(activeMissions) },
    { label: "Complete", value: missionCount(completeMissions) },
    { label: "Packages ready", value: packageCount },
  ];

  return (
    <section className="module-page space-y-6" aria-label="Aerial Imagery">
      <SurfaceBesideTheMap />
      <PageHeader
        title="Aerial Imagery"
        description="Drone missions and the imagery they brought back. Each mission's area is drawn on the map."
        actions={
          <a href="#aerial-mission-launcher" className="module-inline-action">
            New mission
          </a>
        }
      >
        <dl className="grid grid-cols-4 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="text-xl font-semibold tabular-nums text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </PageHeader>

      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this page could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      {projectFilterNotice ? (
        <StateBlock tone="warning" title="This register was not narrowed to that project" description={projectFilterNotice} />
      ) : null}

      <PlanningContextStrip context={planningContext} />

      <section id="aerial-missions-list" aria-labelledby="aerial-missions-heading" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="aerial-missions-heading" className="text-base font-semibold text-foreground">
            Missions
          </h2>
          <span className="text-xs text-muted-foreground">
            {missionsUnreadable ? "count unavailable" : `${totalMissions} total`}
          </span>
        </div>
        {focusLabel ? (
          // Named, and reversible in one click. Every count and every row here
          // is this project's, so the page has to say so where the reader
          // cannot miss it; otherwise the numbers read as the workspace's.
          <p className="text-sm text-muted-foreground">
            Showing only missions linked to {focusLabel}.{" "}
            <Link href="/aerial" className="underline underline-offset-2 hover:text-foreground">
              Show every mission in this workspace
            </Link>
            .
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Every mission, newest first.</p>
        )}
        {missionList}
      </section>

      <section id="aerial-mission-launcher" aria-labelledby="aerial-launcher-heading" className="scroll-mt-6 space-y-2">
        <h2 id="aerial-launcher-heading" className="text-base font-semibold text-foreground">
          Start a mission
        </h2>
        <p className="text-sm text-muted-foreground">
          {focusLabel
            ? `The form starts on ${focusLabel} because this page was opened for it; any project in this workspace can be chosen instead.`
            : "Every mission belongs to a project. Choose which one this flight is for."}
        </p>
        <AerialMissionLauncher
          projects={launcherProjects}
          projectsUnreadable={projectListUnreadable}
          projectListTruncatedAt={launcherProjects.length >= PROJECT_PICKER_LIMIT ? PROJECT_PICKER_LIMIT : null}
          initialProjectId={focusProject?.id ?? null}
        />
      </section>
    </section>
  );
}
