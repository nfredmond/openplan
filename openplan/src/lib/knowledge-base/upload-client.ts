import { sendFileThroughStorage } from "@/lib/files/staged-upload-client";
import type { KbDocKind } from "@/lib/knowledge-base/types";

/**
 * Upload one file to the Knowledge Base from the browser, through Storage
 * rather than as a request body (`/api/knowledge-base/documents/upload/*`).
 *
 * Answers with the same JSON the body route answers (`document`, `stored`,
 * `warning`, `deduped`, `job`, `notice`, or `error`), so every uploader reads
 * the result as it did before.
 */
export function uploadKnowledgeBaseFile(
  file: File,
  options: {
    workspaceId: string;
    projectId?: string | null;
    docKind?: KbDocKind;
    title?: string;
    /** What the body route would have read from the Content-Type header. */
    contentType: string;
  }
): Promise<Response> {
  return sendFileThroughStorage({
    startUrl: "/api/knowledge-base/documents/upload/start",
    completeUrl: "/api/knowledge-base/documents/upload/complete",
    fields: {
      workspaceId: options.workspaceId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.docKind ? { docKind: options.docKind } : {}),
      ...(options.title ? { title: options.title } : {}),
    },
    file,
    contentType: options.contentType,
  });
}
