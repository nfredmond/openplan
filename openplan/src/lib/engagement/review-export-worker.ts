import { randomUUID,createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { parseReviewSnapshot,renderCampaignReviewFiles,verifyCampaignReviewZip,type EngagementReviewFile } from './review-export';
import { ENGAGEMENT_PHOTO_BUCKET,isEngagementPhotoPathForCampaign } from './photo';

/** One leased campaign job per poll, sharing the existing Documents export worker process. */
export async function processNextEngagementReport(root:string):Promise<boolean> {
 const service=createServiceRoleClient();
 const token=randomUUID();const claimed=await service.rpc('claim_engagement_report',{p_token:token});
 if(claimed.error)throw new Error('Campaign export queue unavailable');
 const job=claimed.data as {id:string;workspace_id:string;campaign_id:string;report_id:string;snapshot_text:string;snapshot_sha256:string}|null;
 if(!job)return false;
 const heartbeat=setInterval(()=>{void service.from('engagement_report_jobs').update({lease_until:new Date(Date.now()+600_000).toISOString()}).eq('id',job.id).eq('lease_token',token).eq('status','running').select('id').maybeSingle().then(({error,data})=>{if(error||!data)console.error('Campaign export lease renewal failed or lease lost.');});},30_000);
 try {
  const snapshot=parseReviewSnapshot(job.snapshot_text,job.snapshot_sha256);
  const folder=join(root,'engagement',job.id);await mkdir(folder,{recursive:true,mode:0o700});
  let files:EngagementReviewFile[]|null=null;
  try {
   const saved=JSON.parse(await readFile(join(folder,'files.json'),'utf8')) as {snapshotSha256:string;files:Array<Omit<EngagementReviewFile,'bytes'>>};
   if(saved.snapshotSha256===job.snapshot_sha256&&saved.files.length===3&&new Set(saved.files.map(file=>file.format)).size===3) {
    const loaded:EngagementReviewFile[]=[];
    for(const file of saved.files) {
     if(!['pdf','xlsx','zip'].includes(file.format))throw new Error('Unknown cached format');
     const bytes=await readFile(join(folder,`review.${file.format}`));
     if(createHash('sha256').update(bytes).digest('hex')!==file.checksum)throw new Error('Incomplete cache');
     if(file.format==='zip')await verifyCampaignReviewZip(bytes,job.snapshot_sha256);
     loaded.push({...file,bytes});
    }
    files=loaded;
   }
  } catch { /* An interrupted or corrupt render is rebuilt from the exact retained snapshot. */ }
  if(!files) {
   const photos=new Map<string,Buffer>();
   for(const item of snapshot.items)if(typeof item.photo_path==='string'&&item.photo_path) {
    if(!isEngagementPhotoPathForCampaign(item.photo_path,job.campaign_id))throw new Error('Photograph outside campaign');
    const read=await service.storage.from(ENGAGEMENT_PHOTO_BUCKET).download(item.photo_path);
    if(read.error||!read.data)throw new Error('A retained photograph could not be included');
    photos.set(`photos/${item.id}.${item.photo_path.split('.').pop()}`,Buffer.from(await read.data.arrayBuffer()));
   }
   for(const answer of snapshot.answers) {
    const value=answer.answer_json as {files?:Array<{path:string}>}|null;
    for(const [index,file] of (value?.files??[]).entries()) {
     if(!isEngagementPhotoPathForCampaign(file.path,job.campaign_id))throw new Error('Survey attachment outside campaign');
     const read=await service.storage.from(ENGAGEMENT_PHOTO_BUCKET).download(file.path);
     if(read.error||!read.data)throw new Error('A retained survey attachment could not be included');
     photos.set(`attachments/${answer.id}-${index+1}.${file.path.split('.').pop()}`,Buffer.from(await read.data.arrayBuffer()));
    }
   }
   files=await renderCampaignReviewFiles(job.snapshot_text,job.snapshot_sha256,photos);
   for(const file of files) {
    await writeFile(join(folder,`review.${file.format}.partial`),file.bytes,{mode:0o600});
    await rename(join(folder,`review.${file.format}.partial`),join(folder,`review.${file.format}`));
   }
   await writeFile(join(folder,'files.json.partial'),JSON.stringify({snapshotSha256:job.snapshot_sha256,files:files.map(({bytes,...file})=>({...file,byteLength:bytes.length}))}),{mode:0o600});
   await rename(join(folder,'files.json.partial'),join(folder,'files.json'));
  }
  const stillOwned=await service.from('engagement_report_jobs').update({phase:'Saving review files'}).eq('id',job.id).eq('lease_token',token).eq('status','running').select('id').maybeSingle();
  if(stillOwned.error||!stillOwned.data)return true;
  const artifacts=[];
  for(const file of files) {
   const path=`${job.workspace_id}/${job.report_id}/${job.id}/${file.checksum}.${file.format}`;
   const uploaded=await service.storage.from('report-artifacts').upload(path,file.bytes,{contentType:file.contentType,upsert:false});
   if(uploaded.error) {
    const previous=await service.storage.from('report-artifacts').download(path);
    if(previous.error||!previous.data||createHash('sha256').update(Buffer.from(await previous.data.arrayBuffer())).digest('hex')!==file.checksum)throw new Error('File storage unavailable');
   }
   artifacts.push({format:file.format,path,checksum:file.checksum,contentType:file.contentType,byteLength:file.bytes.length});
  }
  const finished=await service.rpc('finish_engagement_report',{p_job:job.id,p_token:token,p_artifacts:artifacts});
  if(finished.error)throw new Error('Export cancelled, access revoked or custody could not be committed');
  console.log(`Retained campaign review ${job.id}`);
 } catch(error) {
  const failure=await service.from('engagement_report_jobs').update({status:'failed',phase:'Needs retry',failure_detail:error instanceof Error?error.message:'Review files could not be prepared. Retry the retained snapshot.'}).eq('id',job.id).eq('lease_token',token).eq('status','running').select('id').maybeSingle();
  if(failure.error||!failure.data)console.error('Failure status not saved: job was cancelled, reclaimed or unavailable.');
  console.error(`Campaign review ${job.id} needs retry.`);
 } finally {clearInterval(heartbeat);}
 return true;
}
