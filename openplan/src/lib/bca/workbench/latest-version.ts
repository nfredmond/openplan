import { bcaDocumentSchema, type BcaDocument } from "./schema";

/** Same row the report and the SS4A appendix print: newest created_at, then id. */
export const BCA_LATEST_VERSION_PROJECTION = "id, project_id, created_at, document_json";

/**
 * The project's latest saved analysis, read once when the workbench opens.
 * A failed read and an unreadable document stay distinct from "none saved".
 */
export type BcaLatestVersionRead =
  | { status: "none" }
  | { status: "found"; id: string; createdAt: string; document: BcaDocument }
  | { status: "unreadable"; createdAt: string | null }
  | { status: "failed" };

type Result = { data: unknown; error: unknown };
type LatestQuery = PromiseLike<Result> & {
  select: (columns: string) => LatestQuery;
  eq: (column: string, value: string) => LatestQuery;
  order: (column: string, options: { ascending: boolean }) => LatestQuery;
  limit: (count: number) => LatestQuery;
};
export type BcaLatestVersionClient = { from: (table: string) => LatestQuery };

export async function loadLatestBcaVersion(client: BcaLatestVersionClient, projectId: string): Promise<BcaLatestVersionRead> {
  const read = await client
    .from("project_bca_versions")
    .select(BCA_LATEST_VERSION_PROJECTION)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (read.error || !Array.isArray(read.data)) return { status: "failed" };
  const row = read.data[0] as Record<string, unknown> | undefined;
  if (!row) return { status: "none" };
  const createdAt = typeof row.created_at === "string" ? row.created_at : null;
  const document = bcaDocumentSchema.safeParse(row.document_json);
  if (typeof row.id !== "string" || !createdAt || row.project_id !== projectId
    || !document.success || document.data.projectId !== projectId)
    return { status: "unreadable", createdAt };
  return { status: "found", id: row.id, createdAt, document: document.data };
}

/** "Nov 13, 2026, 7:12 PM" in the reader's time zone. Render on the client only. */
export function formatBcaSavedAt(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "an unrecorded time";
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
