import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
  placeOfRecordFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import { resolveStudyArea } from "@/lib/models/study-area";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { StateBlock } from "@/components/ui/state-block";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type {
  SafetyIngestHistoryEntry,
  SafetyIngestSummary,
  SafetyProjectOption,
} from "@/lib/safety/client-types";

import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Safety");

/**
 * `?projectId=` is how this page is TOLD which project it was opened for.
 *
 * Before it existed, Safety had no way to know: it read the workspace's home
 * geography and nothing else, so an MPO whose workspace home is a county but
 * whose projects are corridors or cities retrieved crashes for the whole county
 * every time, without being told that a narrower area of record existed. The
 * parameter is optional — a planner who opens Safety directly still gets the
 * workspace-home behavior, disclosed as such.
 */
type SafetyPageSearchParams = Promise<{ projectId?: string | string[] }>;

/** First value of a repeatable query parameter, trimmed, or null. */
function singleParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

type ProjectPlaceRowWithIdentity = Parameters<typeof placeOfRecordFromProject>[0] & {
  id: string;
  name: string | null;
};

/**
 * Column-level variant of `looksLikePendingSchema`, mirroring the one in
 * models/[modelId]/page.tsx.
 *
 * A deployment that has not applied the workspace home-geography
 * (20260723000005) or project place (20260728000009) migration answers 42703 for
 * the columns below. That is not a read failure worth disclosing by name — the
 * deployment simply cannot carry an area of record yet, and preselecting nothing
 * already says so. Classify first; collect what is left.
 */
function looksLikePendingPlaceColumns(message: string | null | undefined) {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

export default async function SafetyPage({
  searchParams,
}: {
  searchParams?: SafetyPageSearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership) {
    return (
      <section className="module-page">
        <div className="module-intro-card">
          <h1 className="module-section-title">Workspace access required</h1>
          <p className="module-note">
            You need to belong to a workspace to review its crash data — reported collisions
            retrieved from the source agency, mapped for screening-level safety analysis.
          </p>
          <div className="module-inline-list">
            <Link className="module-inline-item" href="/projects">
              Projects
            </Link>
            <Link className="module-inline-item" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const workspaceId = membership.workspace_id;
  const requestedProjectId = singleParam((await searchParams)?.projectId);

  // The two reads that decide which area this page opens on. Both are registered
  // here, because an area that loaded from the wrong place — or failed to load
  // at all — must not arrive on screen as a plain preselection.
  const reads = new ReadFailureLog();

  // The workspace's stated home geography and, when this page was opened for a
  // project, that project's area of record. Read here rather than in the client
  // component so no map surface fetches geography ad hoc. A missing column
  // (migration not applied) yields an error and no row, which narrows to an
  // empty place — the un-prefilled behavior, not a guessed one.
  const [workspaceResult, projectResult] = await Promise.all([
    supabase.from("workspaces").select(HOME_GEOGRAPHY_COLUMNS).eq("id", workspaceId).maybeSingle(),
    requestedProjectId
      ? supabase
          .from("projects")
          // Spelled out rather than interpolating PROJECT_PLACE_COLUMNS: a
          // template literal breaks supabase-js inference, and a projection
          // this guard cannot read as a literal is one
          // reference-count-projection-guard.test.ts silently stops checking.
          // The full place row INCLUDING geometry — the scope variant omits it
          // deliberately, and geometry is what makes an area seedable.
          .select(
            "id, name, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_geometry_geojson, place_set_at"
          )
          .eq("id", requestedProjectId)
          // Scoped to this workspace on purpose: the id arrives from the URL, so
          // "a project by that id exists somewhere" is not the question. RLS
          // would refuse another workspace's row anyway; saying it here makes
          // "not in this workspace" an answer the page can explain rather than
          // an empty result it has to guess at.
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (!looksLikePendingPlaceColumns(workspaceResult.error?.message)) {
    reads.check("this workspace's home geography", workspaceResult);
  }

  const projectSchemaPending =
    Boolean(requestedProjectId) && looksLikePendingPlaceColumns(projectResult.error?.message);
  const projectUnreadable =
    Boolean(requestedProjectId) && !projectSchemaPending
      ? reads.check("the project this page was opened for", projectResult)
      : false;

  const projectRow = (projectResult.data ?? null) as ProjectPlaceRowWithIdentity | null;

  // Precedence lives in `resolveStudyArea`, stated once for the whole app: the
  // project's own area outranks the workspace home, and nothing here can invent
  // a place when neither carries one.
  const studyArea = resolveStudyArea({
    project: placeOfRecordFromProject(projectRow),
    workspaceHome: placeOfRecordFromHomeGeography(parseWorkspaceHomeGeography(workspaceResult.data)),
  });

  /**
   * Why the requested project's area is NOT the one on screen, when it isn't.
   *
   * A planner who opened this page for a project intends to retrieve crashes for
   * that project's area. Falling through to the workspace's county is the
   * documented precedence and it is labeled as such below — but leaving the
   * fall-through unexplained would let a county-wide retrieval pass for a
   * corridor-scoped one. Each branch names a different thing to do about it.
   */
  const projectAreaNotice = !requestedProjectId
    ? null
    : projectSchemaPending
      ? "This deployment does not record project study areas yet, so nothing could be inherited from the project this page was opened for. Apply the latest migrations and it will."
      : projectUnreadable
        ? "This page was opened for a project whose record could not be read, so its study area could not be used. The area below is whatever this workspace had already stated, not that project's."
        : !projectRow
          ? "This page was opened for a project that is not in this workspace, so its study area could not be used. The area below is whatever this workspace had already stated."
          : studyArea.origin !== "project"
            ? `${projectRow.name ?? "That project"} has no study area of its own yet, so nothing could be inherited from it. Set one on the project record and this page will open on it.`
            : null;

  // Recent acquisitions drive the coverage banner (newest row) and the
  // acquisition-history list, with the project each run was attached to. A
  // missing table (schema not applied yet) is treated the same as "nothing
  // retrieved" rather than failing the page. Projects power the attach-on-
  // ingest selector — the same workspace projects list other modules offer.
  // Named results, not `{ data }`: a crash-ingest read that failed must not
  // render as "no crash data has been imported", which on this page reads as a
  // statement about the agency's safety record rather than about the query.
  const [ingestsResult, projectsResult] = await Promise.all([
    supabase
      .from("safety_crash_ingests")
      .select(
        "id,project_id,source_label,attribution,coverage_state,severity_completeness,status,crash_count,geocoded_count,truncated,years_requested,fetch_error,created_at"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("projects")
      .select("id, name, status")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  const ingestsReadFailed = reads.check("this workspace's crash imports", ingestsResult);
  reads.check("this workspace's projects", projectsResult);
  const ingestRows = ingestsResult.data;
  const projectRows = projectsResult.data;

  const ingestRow = (ingestRows ?? [])[0] ?? null;
  const latestIngest: SafetyIngestSummary | null = ingestRow
    ? {
        id: ingestRow.id as string,
        sourceLabel: (ingestRow.source_label as string | null) ?? null,
        attribution: (ingestRow.attribution as string | null) ?? null,
        coverageState: ingestRow.coverage_state as string,
        severityCompleteness: ingestRow.severity_completeness as string,
        status: ingestRow.status as string,
        crashCount: Number(ingestRow.crash_count ?? 0),
        geocodedCount: Number(ingestRow.geocoded_count ?? 0),
        truncated: Boolean(ingestRow.truncated),
        yearsRequested: (ingestRow.years_requested as number[] | null) ?? [],
        fetchError: (ingestRow.fetch_error as string | null) ?? null,
        createdAt: ingestRow.created_at as string,
      }
    : null;

  const ingestHistory: SafetyIngestHistoryEntry[] = ((ingestRows ?? []) as Array<
    Record<string, unknown>
  >).map((row) => ({
    id: row.id as string,
    projectId: (row.project_id as string | null) ?? null,
    sourceLabel: (row.source_label as string | null) ?? null,
    coverageState: row.coverage_state as string,
    status: row.status as string,
    crashCount: Number(row.crash_count ?? 0),
    geocodedCount: Number(row.geocoded_count ?? 0),
    yearsRequested: (row.years_requested as number[] | null) ?? [],
    createdAt: row.created_at as string,
  }));

  const projects = (projectRows ?? []) as SafetyProjectOption[];

  return (
    <section className="module-page">
      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this page could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      {projectAreaNotice ? (
        <StateBlock
          tone="warning"
          title="This page did not open on the project's study area"
          description={projectAreaNotice}
          action={
            projectRow ? (
              <Link
                href={`/projects/${projectRow.id}`}
                className="inline-flex items-center rounded border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-primary/35 hover:text-primary"
              >
                Open project record
              </Link>
            ) : undefined
          }
        />
      ) : null}

      <SafetyWorkspace
        workspaceId={workspaceId}
        latestIngest={latestIngest}
        ingestsReadFailed={ingestsReadFailed}
        studyArea={{
          corridorText: studyArea.corridorText,
          place: studyArea.place,
          label: studyArea.label,
          origin: studyArea.origin,
          originLabel: studyArea.originLabel,
        }}
        openedForProject={projectRow ? { id: projectRow.id, name: projectRow.name } : null}
        projects={projects}
        ingestHistory={ingestHistory}
      />
    </section>
  );
}
