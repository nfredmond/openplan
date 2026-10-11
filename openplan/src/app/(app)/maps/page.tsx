import Link from "next/link";
import { redirect } from "next/navigation";

import { MapPackageCreator } from "@/components/map-packages/map-package-creator";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { MAP_PACKAGE_DELIVERABLE_LABELS, type MapPackageDeliverable } from "@/lib/map-packages/catalog";
import { mapPackageStateLabel, mapPackageStateTone } from "@/lib/map-packages/presentation";
import { createClient } from "@/lib/supabase/server";
import { moduleMetadata } from "@/lib/ui/page-title";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export const metadata = moduleMetadata("Maps");

type SearchParams = Promise<{ projectId?: string | string[]; opportunityId?: string | string[]; new?: string | string[] }>;

function singleParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

type PackageRow = {
  id: string;
  title: string;
  state: string;
  source: string;
  deliverable: string;
  created_at: string;
  project_id: string;
  progress: { message?: string } | null;
  receipt: { figures?: unknown[] } | null;
  project: { id: string; name: string | null } | Array<{ id: string; name: string | null }> | null;
};

type ConnectionRow = { id: string; project_id: string; device_label: string; last_status: string; expires_at: string };

/** The planner's own computer connections that can still be used. */
function unexpiredConnections(rows: ConnectionRow[]) {
  const now = Date.now();
  return rows.filter(row => Date.parse(row.expires_at) > now)
    .map(row => ({ id: row.id, projectId: row.project_id, label: row.device_label, status: row.last_status }));
}

/**
 * Map packages for every project in the workspace: client-ready figures, map
 * books and GIS projects. A package is built by Claude Fable 5.1 on the
 * planner's own computer, or added by hand.
 */
export default async function MapsPage({ searchParams }: { searchParams?: SearchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/maps");

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership?.workspace_id) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Maps"
        title="Maps needs a workspace"
        description="Map packages belong to a project in a workspace. Join a workspace or create one first."
      />
    );
  }
  const workspaceId = membership.workspace_id;
  const params = (await searchParams) ?? {};
  const requestedProjectId = singleParam(params.projectId);
  const requestedOpportunityId = singleParam(params.opportunityId);
  const reads = new ReadFailureLog();

  const [projectsRead, opportunitiesRead, connectionsRead] = await Promise.all([
    supabase.from("projects").select("id, name").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("funding_opportunities").select("id, title, project_id").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("assistant_provider_connections").select("id, project_id, device_label, provider, last_status, revoked_at, expires_at")
      .eq("user_id", user.id).eq("workspace_id", workspaceId).eq("provider", "claude").is("revoked_at", null).limit(200),
  ]);
  reads.check("this workspace's projects", projectsRead);
  reads.check("this workspace's grant applications", opportunitiesRead);
  reads.check("your connected computers", connectionsRead);
  const projects = ((projectsRead.data ?? []) as Array<{ id: string; name: string | null }>).map(row => ({ id: row.id, name: row.name?.trim() || "Untitled project" }));
  const focusProject = requestedProjectId ? projects.find(project => project.id === requestedProjectId) ?? null : null;

  let packagesQuery = supabase.from("project_map_packages")
    .select("id, title, state, source, deliverable, created_at, project_id, progress, receipt, project:projects(id, name)")
    .eq("workspace_id", workspaceId);
  if (focusProject) packagesQuery = packagesQuery.eq("project_id", focusProject.id);
  const packagesRead = await packagesQuery.order("created_at", { ascending: false }).limit(100);
  const packagesUnreadable = reads.check(focusProject ? `the map packages for ${focusProject.name}` : "this workspace's map packages", packagesRead);
  const packages = (packagesRead.data ?? []) as PackageRow[];

  return (
    <section className="module-page space-y-6" aria-label="Maps">
      <PageHeader
        title="Maps"
        description="Figures, map books and GIS projects for your projects."
        actions={
          <MapPackageCreator
            workspaceId={workspaceId}
            workspaceName={workspace?.name ?? ""}
            projects={projects}
            opportunities={((opportunitiesRead.data ?? []) as Array<{ id: string; title: string; project_id: string | null }>).map(row => ({ id: row.id, title: row.title, projectId: row.project_id }))}
            connections={unexpiredConnections((connectionsRead.data ?? []) as ConnectionRow[])}
            initialProjectId={focusProject?.id ?? null}
            initialOpportunityId={requestedOpportunityId}
            startOpen={singleParam(params.new) === "1"}
          />
        }
      />

      {reads.any ? <StateBlock tone="danger" title="Part of this page could not be read" description={`${reads.describe()} ${reads.messages().join(" · ")}`} /> : null}

      {focusProject ? (
        <p className="text-sm text-muted-foreground">
          Showing packages for {focusProject.name}. <Link href="/maps" className="underline underline-offset-2">Show all</Link>
        </p>
      ) : null}

      {packages.length === 0 ? (
        packagesUnreadable ? (
          <EmptyState title="Map packages could not be read" description="This list did not load, so it is unavailable rather than empty." />
        ) : projects.length === 0 ? (
          <EmptyState title="No map packages yet" description="Create a project first. Every map package belongs to one." />
        ) : (
          <EmptyState title="No map packages yet" description="Make maps to start the first one." />
        )
      ) : (
        <ul className="divide-y divide-border/60" aria-label="Map packages">
          {packages.map(row => {
            const project = Array.isArray(row.project) ? row.project[0] : row.project;
            const figures = row.receipt?.figures?.length ?? 0;
            return (
              <li key={row.id} className="space-y-1 py-3" data-testid="map-package-row">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/maps/${row.id}`} className="min-w-0 font-medium text-foreground hover:underline">{row.title}</Link>
                  <StatusBadge tone={mapPackageStateTone(row.state)}>{mapPackageStateLabel(row.state)}</StatusBadge>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {project ? <Link href={`/projects/${project.id}`} className="underline underline-offset-2 hover:text-foreground">{project.name}</Link> : "Project"}
                  {" · "}{MAP_PACKAGE_DELIVERABLE_LABELS[row.deliverable as MapPackageDeliverable] ?? row.deliverable}
                  {" · "}{new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {row.state === "ready" && figures ? ` · ${figures} figures` : ""}
                  {row.state === "running" && row.progress?.message ? ` · ${row.progress.message}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
