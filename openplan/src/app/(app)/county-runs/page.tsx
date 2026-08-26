import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";
import { PlanningContextStrip } from "@/components/projects/planning-context-strip";
import { AnalysisSequenceStrip } from "@/components/models/analysis-sequence-strip";
import { loadAnalysisSequenceFacts } from "@/components/models/analysis-sequence-facts";
import { isCountyOnrampWorkerConfigured } from "@/lib/config/deployment-health-facts";
import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
  placeOfRecordFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import { resolveStudyArea } from "@/lib/models/study-area";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { StateBlock } from "@/components/ui/state-block";
import { moduleMetadata } from "@/lib/ui/page-title";
import { resolvePlanningContext } from "@/lib/projects/planning-context";

export const metadata = moduleMetadata("Model Validation");

/**
 * `?projectId=` is how this page is TOLD which project it was opened for.
 *
 * Before it existed, county onboarding could only ever start from the
 * workspace's home geography. For an agency whose home IS the county that is the
 * right answer; for an MPO covering several counties whose projects each sit in
 * one of them, it prefilled a county the planner then had to re-pick every time.
 * The parameter is optional — opening the page directly still starts from the
 * workspace home, disclosed as such.
 */
type CountyRunsPageSearchParams = Promise<{ projectId?: string | string[] }>;

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
 * models/[modelId]/page.tsx and safety/page.tsx.
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

export default async function CountyRunsPage({
  searchParams,
}: {
  searchParams?: CountyRunsPageSearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/county-runs");
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership?.workspace_id) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Model Validation"
        title="Model Validation needs a workspace"
        description="Validation runs belong to a workspace. You are signed in, but this account is not in one yet — join a workspace or create one before launching and reviewing validation runs."
      />
    );
  }

  const workspaceId = membership.workspace_id;
  const requestedProjectId = singleParam((await searchParams)?.projectId);

  // Both reads are registered, because an area that failed to load must not
  // arrive on screen as a plain preselection — and on this page the selection
  // determines which county gets onboarded.
  const reads = new ReadFailureLog();

  // The workspace already stated where it works, and a project opened for
  // onboarding states a narrower area still. Resolving both here — on the
  // server, where the rows are already in reach — is what stops this page asking
  // a planner to be the FIPS lookup table for their own county.
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
          // "a project by that id exists somewhere" is not the question.
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
  const planningContext = resolvePlanningContext(
    requestedProjectId,
    projectRow,
    requestedProjectId && (projectSchemaPending || projectUnreadable)
      ? projectResult.error ?? { message: "Project context could not be read" }
      : null,
  );

  // Precedence lives in `resolveStudyArea`, stated once for the whole app: the
  // project's own area outranks the workspace home, and nothing here can invent
  // a place when neither carries one.
  //
  // NOTE what this page does NOT do with the result. Whatever area is inherited,
  // `CountyRunsPageClient` still refuses to launch on anything that is not a
  // county and names the county to pick instead. Seeding a city-scoped project's
  // area here therefore surfaces a visible refusal, not a silent substitution of
  // whichever county happens to contain it.
  const studyArea = resolveStudyArea({
    project: placeOfRecordFromProject(projectRow),
    workspaceHome: placeOfRecordFromHomeGeography(parseWorkspaceHomeGeography(workspaceResult.data)),
  });

  /**
   * Whether this deployment has a county onramp worker configured to RECEIVE
   * jobs, answered here because only the server can answer it:
   * `OPENPLAN_COUNTY_ONRAMP_WORKER_URL` is an unprefixed variable and the URL
   * itself is an internal endpoint that has no business in a browser bundle.
   * What crosses to the client is the VERDICT — a boolean — never the address.
   *
   * A boolean rather than `null` from this page onwards. `null` means "the page
   * did not say", which was true while nothing read the variable; now that this
   * page has looked, passing `null` would understate what is known and leave the
   * first launch on a worker-less deployment undisclosed, which is the whole
   * defect. The client keeps `null` as its default for any caller not yet wired.
   *
   * `isCountyOnrampWorkerConfigured` mirrors `dispatchCountyOnrampJob`'s own
   * test, so what this page discloses and what the dispatcher then does cannot
   * disagree.
   */
  const countyOnrampWorkerConfigured = isCountyOnrampWorkerConfigured();

  /** Why the requested project's area is NOT the one below, when it isn't. */
  const projectAreaNotice = !requestedProjectId
    ? null
    : projectSchemaPending
      ? "This copy of OpenPlan does not store an area for each project yet, so nothing could be carried over from the project this page was opened for. Whoever installed OpenPlan for your agency needs to finish the setup, and then it will."
      : projectUnreadable
        ? "This page was opened for a project that could not be read, so the area you plan for could not be taken from it. The area below is the one already saved here, not that project’s."
        : !projectRow
          ? "This page was opened for a project that is not in this workspace, so the area you plan for could not be taken from it. The area below is the one already saved here."
          : studyArea.origin !== "project"
            ? `${projectRow.name ?? "That project"} has no area of its own yet, so nothing could be carried over from it. Set one on the project and this page will open on it.`
            : null;

  // The order of the analysis work, said the same way on every page in the
  // group. This page is step six of seven — the one that checks a run against
  // counts collected in the field.
  const sequenceFacts = await loadAnalysisSequenceFacts(
    supabase,
    workspaceId,
    planningContext.status === "active" ? planningContext.project.id : null
  );

  return (
    <>
      <PlanningContextStrip context={planningContext} />
      <AnalysisSequenceStrip
        facts={sequenceFacts}
        currentStepId="check"
        projectId={planningContext.status === "active" ? planningContext.project.id : null}
      />

      {reads.any || projectAreaNotice ? (
        <div className="mb-4 grid gap-4">
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
              title="This page did not open on the project’s area"
              description={projectAreaNotice}
              action={
                projectRow ? (
                  <Link
                    href={`/projects/${projectRow.id}`}
                    className="inline-flex items-center rounded border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-primary/35 hover:text-primary"
                  >
                    Open the project
                  </Link>
                ) : undefined
              }
            />
          ) : null}
        </div>
      ) : null}

      <CountyRunsPageClient
        workspaceId={workspaceId}
        initialStudyArea={{
          corridorText: studyArea.corridorText,
          place: studyArea.place,
          // `originLabel`, not the bare place name: it is the picker's
          // `externalLabel`, and the resolver documents it as what the planner
          // is TOLD about where the area came from. When the place has a name
          // that name IS the label; when it does not, this says "this project's
          // study area" rather than leaving an inherited boundary anonymous.
          label: studyArea.originLabel,
        }}
        countyOnrampWorkerConfigured={countyOnrampWorkerConfigured}
      />
    </>
  );
}
