import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProjectCampaignsForEvidence } from './campaign-projects';

/** Resolve direct and shared campaign report targets without bypassing caller permissions. */
export async function projectReportCoverage(client: unknown, project: {id:string;workspace_id:string}) {
 const coverage=await loadProjectCampaignsForEvidence(client,project);
 if(coverage.error)return {filter:null,campaignIds:[],error:coverage.error};
 const campaignIds=(coverage.data??[]).map(row=>String(row.id));
 const filter=`project_id.eq.${project.id}${campaignIds.length?`,engagement_campaign_id.in.(${campaignIds.join(',')})`:''}`;
 return {filter,campaignIds,error:null};
}

export const PROJECT_REPORT_ARTIFACT_SELECT='id, report_id, artifact_kind, storage_path, generated_at, metadata_json, reports!inner(workspace_id, project_id, engagement_campaign_id, title)';

/** Use the same coverage at freeze and download time, including coverage revoked since freeze. */
export async function loadProjectReportArtifact(client:SupabaseClient,project:{id:string;workspace_id:string},artifactId:string) {
 const coverage=await projectReportCoverage(client,project);
 if(!coverage.filter)return {data:null,error:coverage.error};
 return client.from('report_artifacts').select(PROJECT_REPORT_ARTIFACT_SELECT)
  .eq('id',artifactId).eq('reports.workspace_id',project.workspace_id)
  .or(coverage.filter,{referencedTable:'reports'}).maybeSingle();
}
