/**
 * Reads the saved records the ATP evidence appendices cite, through the
 * caller's RLS-scoped client. Every read is scoped to the application's own
 * workspace and linked project. A failed read becomes an "unreadable" state
 * with its reason; it never becomes an empty record.
 *
 * Only the records the selected appendices need are read.
 */

import type { AtpEvidenceRecords, AtpProjectRecord } from "@/lib/grants/atp-evidence-appendices";
import { ATP_PACKET_PROJECT_SELECT, type AtpPacketRun } from "@/lib/grants/atp-packet";
import { loadProjectBcaRead, loadProjectEngagementRead, type EvidenceQueryClient } from "@/lib/grants/evidence-appendix-reads";
import {
  latestReadyIngestByProject,
  loadSafetyCrashEvidence,
  readSafetyCrashEvidenceIngest,
  SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION,
  type SafetyCrashEvidenceSupabaseLike,
} from "@/lib/safety/crash-evidence";

/** The packet's project columns plus when and from what the estimate was recorded. */
const ATP_EVIDENCE_PROJECT_SELECT = `${ATP_PACKET_PROJECT_SELECT}, estimated_cost_recorded_at, estimated_cost_source_document_id`;
const ATP_EVIDENCE_RUN_SELECT = "id, title, created_at, metrics";
/** Recent finished acquisitions considered; the newest is cited. */
const CRASH_ACQUISITION_LIMIT = 20;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readProject(row: Record<string, unknown>): AtpProjectRecord | null {
  if (typeof row.id !== "string") return null;
  const amount = row.estimated_cost_amount;
  return {
    id: row.id,
    name: typeof row.name === "string" ? row.name : row.id,
    summary: text(row.summary),
    estimated_cost_amount: typeof amount === "string" || typeof amount === "number" ? amount : null,
    estimated_cost_currency: text(row.estimated_cost_currency),
    estimated_cost_basis_year: typeof row.estimated_cost_basis_year === "number" ? row.estimated_cost_basis_year : null,
    estimated_cost_recorded_at: text(row.estimated_cost_recorded_at),
    estimated_cost_source_document_id: text(row.estimated_cost_source_document_id),
  };
}

async function loadProject(client: EvidenceQueryClient, workspaceId: string, projectId: string): Promise<AtpEvidenceRecords["project"]> {
  const result = await client
    .from("projects")
    .select(ATP_EVIDENCE_PROJECT_SELECT)
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (result.error) {
    return { status: "unreadable", reason: "The linked project could not be read while this package was assembled. That is a failed read, not an absence of project facts." };
  }
  const project = result.data && typeof result.data === "object" ? readProject(result.data as Record<string, unknown>) : null;
  return project ? { status: "ready", project } : { status: "absent" };
}

async function loadLatestRun(client: EvidenceQueryClient, workspaceId: string, projectId: string): Promise<AtpEvidenceRecords["run"]> {
  const result = await client
    .from("runs")
    .select(ATP_EVIDENCE_RUN_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (result.error || !Array.isArray(result.data)) {
    return { status: "unreadable", reason: "The project's corridor analysis runs could not be read. That is a failed read, not an absence of screening scores." };
  }
  const row = result.data[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.id !== "string") return { status: "absent" };
  const run: AtpPacketRun = {
    id: row.id,
    title: text(row.title),
    created_at: text(row.created_at),
    metrics: row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics) ? (row.metrics as Record<string, unknown>) : null,
  };
  return { status: "ready", run };
}

async function loadCrash(
  client: EvidenceQueryClient & SafetyCrashEvidenceSupabaseLike,
  workspaceId: string,
  projectId: string
): Promise<AtpEvidenceRecords["crash"]> {
  const result = await client
    .from("safety_crash_ingests")
    .select(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(CRASH_ACQUISITION_LIMIT);
  if (result.error || !Array.isArray(result.data)) {
    return { status: "unreadable", reason: "The project's crash acquisitions could not be read. That is a failed read, not an absence of crashes." };
  }
  const ingests = (result.data as Array<Record<string, unknown>>).flatMap((row) => {
    const ingest = readSafetyCrashEvidenceIngest(row);
    return ingest ? [ingest] : [];
  });
  const latest = latestReadyIngestByProject(ingests).get(projectId);
  if (!latest) return { status: "absent" };
  // A failed count read comes back as null counts, which the appendix prints as unavailable.
  const evidence = (await loadSafetyCrashEvidence(client, workspaceId, [latest])).get(latest.id);
  if (!evidence) return { status: "unreadable", reason: "The crash acquisition's counts could not be read." };
  return { status: "ready", evidence, retrievedAt: latest.createdAt || null };
}

/** Load the records for the selected appendices. */
export async function loadAtpEvidenceRecords(
  supabase: unknown,
  input: { workspaceId: string; projectId: string | null; selected: ReadonlySet<string>; generatedAt: string; timeZone: string }
): Promise<AtpEvidenceRecords> {
  const client = supabase as EvidenceQueryClient & SafetyCrashEvidenceSupabaseLike;
  const { workspaceId, projectId, selected, generatedAt, timeZone } = input;
  if (!projectId) {
    return {
      projectId: null,
      project: { status: "no_project" },
      run: { status: "no_project" },
      crash: { status: "no_project" },
      bca: { status: "no_project" },
      engagement: { status: "no_project" },
      generatedAt,
      timeZone,
    };
  }
  const needsProject = ["scoring_packet", "cost_estimate", "engagement", "equity"].some((key) => selected.has(key));
  const needsRun = selected.has("scoring_packet") || selected.has("equity");
  const skipped = { status: "absent" } as const;
  const [project, run, crash, bca, engagement] = await Promise.all([
    needsProject ? loadProject(client, workspaceId, projectId) : Promise.resolve(skipped),
    needsRun ? loadLatestRun(client, workspaceId, projectId) : Promise.resolve(skipped),
    selected.has("crash_summary") ? loadCrash(client, workspaceId, projectId) : Promise.resolve(skipped),
    selected.has("bca") ? loadProjectBcaRead(client, projectId) : Promise.resolve(skipped),
    selected.has("engagement") ? loadProjectEngagementRead(client, projectId) : Promise.resolve(skipped),
  ]);
  // The project name words the engagement appendix's claims, so a failed read
  // of it makes that appendix unreadable rather than quietly reworded.
  const engagementRead: AtpEvidenceRecords["engagement"] =
    selected.has("engagement") && project.status === "unreadable"
      ? { status: "unreadable", reason: "The linked project could not be read, so its engagement summary was not built." }
      : engagement;
  return { projectId, project, run, crash, bca, engagement: engagementRead, generatedAt, timeZone };
}
