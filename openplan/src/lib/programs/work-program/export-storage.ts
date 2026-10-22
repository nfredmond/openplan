import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkWorkspaceStorageRoomForFiles } from "@/lib/workspaces/storage-quota";

const WORK_PROGRAM_EXPORT_BUCKET = "kb-documents";

/** What the planner sees on a failed export that a retry can finish. */
export const WORK_PROGRAM_EXPORT_RETRY_DETAIL =
  "Review file could not be completed. Retry preparation; the saved revision and completed render remain retained.";

/** The workspace storage limit refused the file; its message is written for the planner. */
class WorkProgramExportStorageRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkProgramExportStorageRefused";
  }
}

/**
 * Store one rendered work program export in the workspace's Documents folder.
 *
 * Checks the workspace storage limit first. A retry whose earlier attempt
 * already stored this exact file adds no bytes and is not refused for it. A
 * restart after the storage commit proves the retained bytes by hash rather
 * than overwriting them.
 */
export async function storeWorkProgramExport(
  service: Pick<SupabaseClient, "rpc" | "storage">,
  input: { workspaceId: string; objectPath: string; bytes: Buffer; checksum: string; contentType: string }
): Promise<void> {
  const room = await checkWorkspaceStorageRoomForFiles(service, input.workspaceId, WORK_PROGRAM_EXPORT_BUCKET, [
    { path: input.objectPath, bytes: input.bytes.length },
  ]);
  if (room.status === "full" || room.status === "unreadable") throw new WorkProgramExportStorageRefused(room.message);
  const bucket = service.storage.from(WORK_PROGRAM_EXPORT_BUCKET);
  const uploaded = await bucket.upload(input.objectPath, input.bytes, { contentType: input.contentType, upsert: false });
  if (!uploaded.error) return;
  const existing = await bucket.download(input.objectPath);
  if (
    existing.error ||
    !existing.data ||
    createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex") !== input.checksum
  ) {
    throw new Error("Artifact storage unavailable");
  }
}

/** The failure text saved on the export job. */
export function workProgramExportFailureDetail(error: unknown): string {
  return error instanceof WorkProgramExportStorageRefused ? error.message : WORK_PROGRAM_EXPORT_RETRY_DETAIL;
}
