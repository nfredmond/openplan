import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import { studyAreaPrefillFrom } from "@/lib/models/study-area";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { ExploreWorkbench } from "./_components/explore-workbench";

import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Corridor Analysis");

/**
 * `?projectId=` is how Analysis Studio is TOLD which project it was opened for.
 *
 * Before it existed, this page had no way to know: it read the workspace's home
 * geography and nothing else, so an MPO whose workspace home is a county but
 * whose projects are corridors or cities analyzed the whole county every time,
 * without being told that a narrower area of record existed. Safety and county
 * onboarding were converted first; Explore was the one left, and the one where
 * the substitution was silent, because analysis just ran on the wider area and
 * reported numbers for it.
 *
 * WHY THIS FILE IS A SERVER COMPONENT NOW. The workbench beneath it is still a
 * client component — the map, the run history and the workspace bootstrap all
 * live in the browser, and the workspace's home geography is still fetched from
 * there because `/explore` resolves its workspace client-side and can create one
 * mid-session. A project's area of record is different: it is named in the URL,
 * it is a row, and no client-reachable endpoint exposes it. Reading it here is
 * the same read Safety and county onboarding do, rather than a third front door
 * onto the same fact.
 *
 * The parameter is optional. A planner who opens Analysis Studio from the nav
 * still gets the workspace-home behavior, disclosed as such.
 */
type ExplorePageSearchParams = Promise<{ projectId?: string | string[] }>;

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
 * safety/page.tsx and county-runs/page.tsx.
 *
 * A deployment that has not applied the project place migration (20260728000009)
 * answers 42703 for the columns below. That is not a read failure worth
 * disclosing by name — the deployment simply cannot carry a project area of
 * record yet, and preselecting nothing already says so. Classify first; collect
 * what is left.
 */
function looksLikePendingPlaceColumns(message: string | null | undefined) {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams?: ExplorePageSearchParams;
}) {
  const requestedProjectId = singleParam((await searchParams)?.projectId);

  // Nothing to inherit from a project and nothing to disclose about one. The
  // workbench opens on the workspace's home geography exactly as before, which
  // it asks for itself.
  if (!requestedProjectId) {
    return <ExploreWorkbench projectPlace={null} openedForProject={null} projectAreaNotice={null} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No sign-in redirect here on purpose: the `(app)` layout already refuses an
  // unauthenticated visitor, and the workbench owns the signed-out and
  // no-workspace panels — including the bootstrap flow that creates the first
  // workspace. Duplicating that decision would give this page a second, quieter
  // opinion about who is allowed in.
  const { membership } = user
    ? await loadCurrentWorkspaceMembership(supabase, user.id)
    : { membership: null };
  const workspaceId = membership?.workspace_id ?? null;

  // The one read that decides which area this page opens on. It is registered,
  // because an area that failed to load must not arrive on screen as a plain
  // preselection.
  const reads = new ReadFailureLog();

  const projectResult = workspaceId
    ? await supabase
        .from("projects")
        // Spelled out rather than interpolating PROJECT_PLACE_COLUMNS: a
        // template literal breaks supabase-js inference, and a projection this
        // guard cannot read as a literal is one
        // reference-count-projection-guard.test.ts silently stops checking.
        // The full place row INCLUDING geometry — the scope variant omits it
        // deliberately, and geometry is what makes an area seedable.
        .select(
          "id, name, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_geometry_geojson, place_set_at"
        )
        .eq("id", requestedProjectId)
        // Scoped to this workspace on purpose: the id arrives from the URL, so
        // "a project by that id exists somewhere" is not the question. RLS would
        // refuse another workspace's row anyway; saying it here makes "not in
        // this workspace" an answer the page can explain rather than an empty
        // result it has to guess at.
        .eq("workspace_id", workspaceId)
        .maybeSingle()
    : { data: null, error: null };

  const projectSchemaPending = looksLikePendingPlaceColumns(projectResult.error?.message);
  const projectUnreadable = !projectSchemaPending
    ? reads.check("the project this page was opened for", projectResult)
    : false;

  const projectRow = (projectResult.data ?? null) as ProjectPlaceRowWithIdentity | null;
  const projectPlace = projectRow ? placeOfRecordFromProject(projectRow) : null;

  // Whether that place can actually seed a study area — the same test
  // `resolveStudyArea` applies, asked here so the notice below can tell "the
  // project has no area" apart from "the project has an area we used". A bbox
  // without a boundary cannot seed one, and saying it did would be the defect
  // in miniature.
  const projectAreaUsable = studyAreaPrefillFrom(projectPlace).geometry !== null;

  /**
   * Why the requested project's area is NOT the one on screen, when it isn't.
   *
   * A planner who opened this page for a project intends to analyze that
   * project's area. Falling through to the workspace's county is the documented
   * precedence and it is labeled as such in the panel — but leaving the
   * fall-through unexplained would let a county-wide analysis pass for a
   * corridor-scoped one. Each branch names a different thing to do about it.
   */
  const projectAreaNotice = !workspaceId
    ? // With no workspace there was nothing to scope the project read to, so it
      // was never attempted and this page has learned nothing to disclose. The
      // workbench's own membership panel — sign in, or create the first
      // workspace — is the real answer, and a second notice about a project
      // would sit on top of it saying less.
      null
    : projectSchemaPending
      ? "This deployment does not record project study areas yet, so nothing could be inherited from the project this page was opened for. Apply the latest migrations and it will."
      : projectUnreadable
        ? `This page was opened for a project whose record could not be read, so its study area could not be used. The area below is whatever this workspace had already stated, not that project's. ${reads
            .messages()
            .join(" · ")}`
        : !projectRow
          ? "This page was opened for a project that is not in this workspace, so its study area could not be used. The area below is whatever this workspace had already stated."
          : !projectAreaUsable
            ? `${projectRow.name ?? "That project"} has no study area of its own yet, so nothing could be inherited from it. Set one on the project record and Corridor Analysis will open on it.`
            : null;

  return (
    <ExploreWorkbench
      // Only a place that can seed an area is passed down. `resolveStudyArea`
      // would fall through to the workspace home on its own, so this is not
      // load-bearing for correctness — it keeps the boundary between "a
      // candidate" and "a row that happens to have place columns" visible at the
      // one point where the two are told apart, and keeps a useless payload off
      // the wire.
      projectPlace={projectAreaUsable ? projectPlace : null}
      openedForProject={projectRow ? { id: projectRow.id, name: projectRow.name } : null}
      projectAreaNotice={projectAreaNotice}
    />
  );
}
