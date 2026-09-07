import { publicReviewStillCurrent } from "./survey-responses";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { parseReviewSnapshot, verifyCampaignReviewZip } from "./review-export";

/** The caller supplies its authenticated client; RLS rechecks membership and internal/public scope at download time. */
export async function downloadEngagementReview(client:SupabaseClient,jobId:string,format:string,expected:{campaignId?:string;reportId?:string;artifact?:{path:string;checksum:string}}={}) {
 const denied=()=>NextResponse.json({error:'Review file unavailable or access revoked'},{status:404,headers:{'Cache-Control':'private, no-store'}});
 const job=await client.from('engagement_report_jobs').select('id,workspace_id,campaign_id,report_id,scope,status,artifacts_json,snapshot_sha256').eq('id',jobId).maybeSingle();
 if(job.error||!job.data||job.data.status!=='complete'||(expected.campaignId&&job.data.campaign_id!==expected.campaignId)||(expected.reportId&&job.data.report_id!==expected.reportId))return denied();
 const row=job.data;
 let artifact=(row.artifacts_json as Array<{format:string;path:string;checksum:string;contentType:string;byteLength:number}>).find(file=>file.format===format);
 if(expected.artifact && format==='pdf') artifact={format:'pdf',path:expected.artifact.path,checksum:expected.artifact.checksum,contentType:'application/pdf',byteLength:0};
 if(!artifact||!['pdf','xlsx','zip'].includes(format)||artifact.path!==`${row.workspace_id}/${row.report_id}/${row.id}/${artifact.checksum}.${format}`)return denied();
 const service=createServiceRoleClient();
 const retained=await service.from('engagement_report_jobs').select('snapshot_text').eq('id',row.id).eq('campaign_id',row.campaign_id).maybeSingle();
 if(retained.error||!retained.data)return denied();
 // Public-format files are withdrawn if a contained public copy was redacted or withheld after capture.
 if(row.scope==='public') {
  const snapshot=parseReviewSnapshot(retained.data.snapshot_text,row.snapshot_sha256);
  if(!await publicReviewStillCurrent(service,snapshot))return denied();
 }
 const downloaded=await service.storage.from('report-artifacts').download(artifact.path);
 if(downloaded.error||!downloaded.data)return denied();
 const bytes=Buffer.from(await downloaded.data.arrayBuffer());
 try {
  if(createHash('sha256').update(bytes).digest('hex')!==artifact.checksum)throw new Error('Saved file checksum mismatch');
  if(format==='zip')await verifyCampaignReviewZip(bytes,row.snapshot_sha256);
 } catch {
  const failed=await service.from('engagement_report_jobs').update({status:'failed',phase:'Saved file needs repair',failure_detail:'A saved file failed its checksum check. Retry the retained snapshot.'}).eq('id',row.id).eq('status','complete').select('id').maybeSingle();
  return NextResponse.json({error:failed.error||!failed.data?'Saved file failed verification; retry could not be enabled. Try this download again.':'Saved file failed verification. Retry preparation from the retained snapshot.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
 }
 return new NextResponse(bytes,{headers:{'Content-Type':artifact.contentType,'Content-Disposition':`attachment; filename="engagement-${row.id}.${format}"`,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Content-SHA256':artifact.checksum}});
}
