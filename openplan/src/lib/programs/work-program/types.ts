import type { WorkProgramDraft } from "./schema";
import type { WorkProgramSourceExtraction } from "./source-extraction";

export type WorkProgramExtractionVersion = {
  id: string; source_id: string; document_extraction_id: string;
  extraction_json: WorkProgramSourceExtraction; content_sha256: string;
  page_count: number; created_at: string;
};
export type WorkProgramSource = {
  versions?: WorkProgramExtractionVersion[];
  selectedVersionId?: string | null;
  id: string;
  document_id: string;
  document_checksum: string;
  source_role: "predecessor" | "amendment" | "comparison" | "authority" | "supplement";
  source_url: string | null;
  page_count: number;
  extraction_json: WorkProgramSourceExtraction;
  created_at: string;
  title: string;
};
export type WorkProgramRevision = {
  id: string;
  revision: number;
  amendment_baseline_id?: string | null;
  previous_revision_id: string | null;
  request_id: string;
  content_json: WorkProgramDraft;
  content_sha256: string;
  source_ids: string[] | null;
  created_by: string;
  created_at: string;
};
export type WorkProgramPreparation = {
  sources: WorkProgramSource[];
  latest: WorkProgramRevision | null;
  revisions: Omit<WorkProgramRevision, "content_json">[];
};

export type WorkProgramPageImage = { sourceId: string; page: number; dataUrl: string; checksum: string };
