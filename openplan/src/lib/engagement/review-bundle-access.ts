import { loadProjectReportArtifact } from './project-report-coverage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadEngagementReview } from './review-export-download';

/** Recheck retained report copies when a containing project ZIP is downloaded. */
export async function engagementBundleFilesAvailable(caller:SupabaseClient,manifest:unknown,project:{id:string;workspace_id:string}):Promise<boolean> {
 if(!manifest||typeof manifest!=='object'||!('entries' in manifest)||!Array.isArray(manifest.entries))return false;
 for(const entry of manifest.entries) {
  if(entry?.inclusion?.status!=='included'||entry?.originalRecord?.sourceId!=='report_artifacts')continue;
  const artifact=await loadProjectReportArtifact(caller,project,entry.originalRecord.recordId);
  if(artifact.error||!artifact.data)return false;
  const row=artifact.data,metadata=row.metadata_json;
  if(typeof metadata?.engagementReviewJobId!=='string')continue;
  if(typeof row.storage_path!=='string'||typeof metadata.sha256!=='string'||entry.checksumSha256!==metadata.sha256)return false;
  const response=await downloadEngagementReview(caller,metadata.engagementReviewJobId,'pdf',{reportId:row.report_id,artifact:{path:row.storage_path,checksum:metadata.sha256}});
  if(!response.ok)return false;
 }
 return true;
}
