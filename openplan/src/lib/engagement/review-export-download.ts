import { publicReviewStillCurrent } from "./survey-responses";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { parseReviewSnapshot } from "./review-export";

/** The caller supplies its authenticated client; RLS rechecks membership and internal/public scope at download time. */
export async function downloadEngagementReview(client:SupabaseClient,jobId:string,format:string,expected:{campaignId?:string;reportId?:string}={}) {
 const denied=()=>NextResponse.json({error:'Review file unavailable or access revoked'},{status:404,headers:{'Cache-Control':'private, no-store'}});
 const job=await client.from('engagement_report_jobs').select('*').eq('id',jobId).maybeSingle();
 if(job.error||!job.data||job.data.status!=='complete'||(expected.campaignId&&job.data.campaign_id!==expected.campaignId)||(expected.reportId&&job.data.report_id!==expected.reportId))return denied();
 const row=job.data;
 const artifact=(row.artifacts_json as Array<{format:string;path:string;checksum:string;contentType:string;byteLength:number}>).find(file=>file.format===format);
 if(!artifact||!['pdf','xlsx','zip'].includes(format)||artifact.path!==`${row.workspace_id}/${row.report_id}/${row.id}/${artifact.checksum}.${format}`)return denied();
 const service=createServiceRoleClient();
 // Public-format files are withdrawn if a contained public copy was redacted or withheld after capture.
 if(row.scope==='public') {
  const snapshot=parseReviewSnapshot(row.snapshot_text,row.snapshot_sha256);
  if(!await publicReviewStillCurrent(service,snapshot))return denied();
 }
 const downloaded=await service.storage.from('report-artifacts').download(artifact.path);
 if(downloaded.error||!downloaded.data)return denied();
 const bytes=Buffer.from(await downloaded.data.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==artifact.checksum)return NextResponse.json({error:'Saved file checksum mismatch. Retry preparation from the retained snapshot.'},{status:503});
 return new NextResponse(bytes,{headers:{'Content-Type':artifact.contentType,'Content-Disposition':`attachment; filename="engagement-${row.id}.${format}"`,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Content-SHA256':artifact.checksum}});
}
