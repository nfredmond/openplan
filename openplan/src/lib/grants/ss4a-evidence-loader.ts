/**
 * Reads the saved records the SS4A evidence appendices cite, through the
 * caller's RLS-scoped client. Every read is scoped to the application's own
 * workspace and linked project. A failed read becomes an "unreadable" state
 * with its reason; it never becomes an empty record.
 *
 * Only the appendices the planner selected are read.
 */

import { buildLatestBcaScreeningByProjectId, type ProjectBcaScreeningRowLike } from "@/lib/grants/bca-evidence";
import {
  buildProjectEngagementEvidenceByProjectId,
  type ProjectEngagementCampaignRowLike,
} from "@/lib/grants/engagement-evidence";
import type { SafetySeedProvenance } from "@/lib/grants/safety-seed-origin";
import type { Ss4aAppendixKey } from "@/lib/grants/ss4a-appendix-keys";
import type { Ss4aEvidenceRecords, Ss4aHinRecomputeRead, Ss4aSafetySourceRead } from "@/lib/grants/ss4a-evidence-appendices";
import { readSafetyArtifactSnapshot } from "@/lib/reports/safety-comparison-snapshot";
import type { SafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { describeHighInjuryNetworkUnavailable } from "@/lib/safety/high-injury-network";
import { buildHighInjuryNetworkForIngest, type HighInjuryNetworkSupabaseLike } from "@/lib/safety/high-injury-network-loader";
import { readSafetyKsiBounds } from "@/lib/safety/ksi-concentrations";
import { readCachedUsRoadContext } from "@/lib/safety/road-context";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

type QueryError = { message: string } | null;
type QueryResult = { data: unknown; error: QueryError; count?: number | null };
type QueryBuilder = PromiseLike<QueryResult> & {
  select: (columns: string, options?: { count: "exact" }) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  neq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, values: unknown[]) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => PromiseLike<QueryResult>;
};
type QueryClient = { from: (table: string) => QueryBuilder };

/** Seeded artifacts considered at once. More than this is refused rather than sampled. */
const MAX_SEEDED_ARTIFACTS = 50;
/** Matches the report generator's cached road read, so a recomputation sees the same lines. */
const ROAD_CONTEXT_LIMIT = 2000;
const ENGAGEMENT_CAMPAIGN_LIMIT = 200;

const SS4A_ARTIFACT_PROJECTION = "id, report_id, generated_at, metadata_json";
const SS4A_ROAD_CONTEXT_PROJECTION = "id, road_name, geometry_geojson, source_id, source_vintage";
const SS4A_BCA_VERSION_PROJECTION = "id, project_id, created_at, document_json, engine_version";
const SS4A_BCA_SCREENING_PROJECTION = "id, project_id, result_json, engine_version, created_at";
const SS4A_ENGAGEMENT_PROJECTION =
  "id, project_id, title, status, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at";

async function loadSafetySource(
  client: QueryClient,
  input: { workspaceId: string; projectId: string; seedHistory: readonly SafetySeedProvenance[] }
): Promise<Ss4aSafetySourceRead> {
  if (input.seedHistory.length === 0) return { status: "absent" };
  const artifactIds = [...new Set(input.seedHistory.map((seed) => seed.artifactId))];
  if (artifactIds.length > MAX_SEEDED_ARTIFACTS) {
    return { status: "unreadable", reason: `More than ${MAX_SEEDED_ARTIFACTS} Safety artifacts were seeded into this application, so none is chosen for the appendices.` };
  }
  const reportIds = [...new Set(input.seedHistory.map((seed) => seed.reportId))];
  const reports = await client
    .from("reports")
    .select("id, workspace_id, project_id")
    .in("id", reportIds)
    .eq("workspace_id", input.workspaceId)
    .eq("project_id", input.projectId);
  if (reports.error || !Array.isArray(reports.data)) {
    return { status: "unreadable", reason: "The seeded Safety reports could not be read while this package was assembled. That is a failed read, not an absence of Safety evidence." };
  }
  const ownedReportIds = (reports.data as Array<{ id?: unknown }>).flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
  if (ownedReportIds.length === 0) {
    return { status: "unreadable", reason: "The seeded Safety report no longer belongs to this application's project and workspace." };
  }
  const artifacts = await client
    .from("report_artifacts")
    .select(SS4A_ARTIFACT_PROJECTION)
    .in("id", artifactIds)
    .in("report_id", ownedReportIds);
  if (artifacts.error || !Array.isArray(artifacts.data)) {
    return { status: "unreadable", reason: "The seeded Safety artifact could not be read while this package was assembled. That is a failed read, not an absence of Safety evidence." };
  }

  const valid: SafetyPlanSnapshot[] = [];
  for (const row of artifacts.data as Array<{ id?: unknown; report_id?: unknown; generated_at?: unknown; metadata_json?: unknown }>) {
    const metadata = row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
      ? (row.metadata_json as Record<string, unknown>)
      : null;
    const recognized = readSafetyArtifactSnapshot(metadata);
    if (recognized.kind !== "v1") continue;
    const snapshot = recognized.snapshot;
    const seeded = input.seedHistory.some((seed) => seed.artifactId === row.id && seed.reportId === row.report_id && seed.snapshotHash === snapshot.hash);
    if (
      seeded &&
      snapshot.artifactId === row.id &&
      snapshot.reportId === row.report_id &&
      snapshot.workspaceId === input.workspaceId &&
      snapshot.projectId === input.projectId &&
      typeof row.generated_at === "string" &&
      Date.parse(row.generated_at) === Date.parse(snapshot.generatedAt)
    ) {
      valid.push(snapshot);
    }
  }
  if (valid.length === 0) {
    return { status: "unreadable", reason: "The seeded Safety artifact no longer matches the snapshot hash recorded when it was seeded, so its evidence is not restated." };
  }
  valid.sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt) || (left.artifactId < right.artifactId ? -1 : 1));
  return { status: "ready", snapshot: valid[0], otherSeededArtifactCount: artifactIds.length - 1 };
}

async function recomputeNetwork(
  client: QueryClient,
  input: { workspaceId: string; projectId: string; snapshot: SafetyPlanSnapshot }
): Promise<Ss4aHinRecomputeRead> {
  const { snapshot } = input;
  if (snapshot.draft.network.kind !== "computed" || snapshot.draft.network.rows.length === 0) return { status: "not_attempted" };
  const acquisition = snapshot.acquisition;
  const bbox = readSafetyKsiBounds([acquisition]);
  const years = Array.isArray(acquisition.years_requested)
    ? acquisition.years_requested.filter((year): year is number => typeof year === "number" && Number.isFinite(year))
    : [];
  if (!bbox || years.length === 0 || typeof acquisition.id !== "string") return { status: "not_attempted" };

  const roadResult = await client
    .from("safety_road_context_features")
    .select(SS4A_ROAD_CONTEXT_PROJECTION)
    .eq("workspace_id", input.workspaceId)
    .eq("project_id", input.projectId)
    .limit(ROAD_CONTEXT_LIMIT);
  if (roadResult.error || !Array.isArray(roadResult.data)) {
    return { status: "unreadable", reason: "Cached road lines could not be read. That is a failed read, not an absence of roads." };
  }
  const roads = readCachedUsRoadContext(
    (roadResult.data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id,
      name: row.road_name,
      geometry_geojson: row.geometry_geojson,
      source: row.source_id,
      vintage: row.source_vintage,
    }))
  );
  const network = await buildHighInjuryNetworkForIngest(client as unknown as HighInjuryNetworkSupabaseLike, {
    workspaceId: input.workspaceId,
    ingestId: acquisition.id,
    severityCompleteness: typeof acquisition.severity_completeness === "string" ? acquisition.severity_completeness : null,
    bbox,
    years,
    roads,
  });
  if (network.status !== "computed") return { status: "unreadable", reason: describeHighInjuryNetworkUnavailable(network.reason) };
  return { status: "computed", network, roads };
}

async function loadBca(client: QueryClient, projectId: string): Promise<Ss4aEvidenceRecords["bca"]> {
  const versions = await client
    .from("project_bca_versions")
    .select(SS4A_BCA_VERSION_PROJECTION)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  // An install without the workbench table falls back to saved screenings.
  if (versions.error && !looksLikePendingSchema(versions.error.message)) {
    return { status: "unreadable", reason: "Saved benefit-cost analyses could not be read. That is a failed read, not an absence of analysis." };
  }
  const latest = !versions.error && Array.isArray(versions.data) ? (versions.data[0] as Record<string, unknown> | undefined) : undefined;
  if (latest && typeof latest.id === "string" && typeof latest.project_id === "string") {
    return {
      status: "workbench",
      row: {
        id: latest.id,
        project_id: latest.project_id,
        created_at: typeof latest.created_at === "string" ? latest.created_at : null,
        engine_version: typeof latest.engine_version === "string" ? latest.engine_version : null,
        document_json: latest.document_json,
      },
    };
  }

  const screenings = await client
    .from("project_bca_screenings")
    .select(SS4A_BCA_SCREENING_PROJECTION)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (screenings.error || !Array.isArray(screenings.data)) {
    return { status: "unreadable", reason: "Saved benefit-cost screenings could not be read. That is a failed read, not an absence of analysis." };
  }
  if (screenings.data.length === 0) return { status: "absent" };
  const screening = buildLatestBcaScreeningByProjectId(screenings.data as ProjectBcaScreeningRowLike[]).get(projectId);
  return screening
    ? { status: "screening", screening }
    : { status: "unreadable", reason: "The saved benefit-cost screening does not carry its computed results." };
}

async function loadEngagement(client: QueryClient, projectId: string): Promise<Ss4aEvidenceRecords["engagement"]> {
  const result = await client
    .from("engagement_campaigns")
    .select(SS4A_ENGAGEMENT_PROJECTION, { count: "exact" })
    .eq("project_id", projectId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(ENGAGEMENT_CAMPAIGN_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    return { status: "unreadable", reason: "Engagement campaigns could not be read. That is a failed read, not an absence of engagement." };
  }
  const evidence = buildProjectEngagementEvidenceByProjectId(result.data as ProjectEngagementCampaignRowLike[]).get(projectId);
  if (!evidence) return { status: "absent" };
  return { status: "ready", evidence, truncated: typeof result.count !== "number" || result.count > result.data.length };
}

/** Load the records for the selected appendices. */
export async function loadSs4aEvidenceRecords(
  supabase: unknown,
  input: {
    workspaceId: string;
    projectId: string | null;
    seedHistory: readonly SafetySeedProvenance[];
    selected: ReadonlySet<Ss4aAppendixKey>;
  }
): Promise<Ss4aEvidenceRecords> {
  const client = supabase as QueryClient;
  const { workspaceId, projectId, selected } = input;
  if (!projectId) {
    return {
      projectId: null,
      projectName: null,
      safety: { status: "no_project" },
      hinRecompute: { status: "not_attempted" },
      bca: { status: "no_project" },
      engagement: { status: "no_project" },
    };
  }
  const needsSafety = selected.has("hin_map") || selected.has("crash_summary") || selected.has("countermeasures");
  const [safety, bca, engagement, project] = await Promise.all([
    needsSafety ? loadSafetySource(client, { workspaceId, projectId, seedHistory: input.seedHistory }) : Promise.resolve({ status: "absent" } as const),
    selected.has("bca") ? loadBca(client, projectId) : Promise.resolve({ status: "absent" } as const),
    selected.has("engagement") ? loadEngagement(client, projectId) : Promise.resolve({ status: "absent" } as const),
    selected.has("engagement")
      ? client.from("projects").select("id, name").eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const hinRecompute = selected.has("hin_map") && safety.status === "ready"
    ? await recomputeNetwork(client, { workspaceId, projectId, snapshot: safety.snapshot })
    : ({ status: "not_attempted" } as const);
  // The project name words the engagement appendix's claims, so a failed read
  // of it makes that appendix unreadable rather than quietly reworded.
  if (project.error) {
    return {
      projectId,
      projectName: null,
      safety,
      hinRecompute,
      bca,
      engagement: { status: "unreadable", reason: "The linked project could not be read, so its engagement summary was not built." },
    };
  }
  const projectName = (project.data as { name?: unknown } | null)?.name;
  return {
    projectId,
    projectName: typeof projectName === "string" && projectName.trim() ? projectName : null,
    safety,
    hinRecompute,
    bca,
    engagement,
  };
}
