// Exercise the actual custody engine, SDK and routes against an owned database.
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(process.cwd()+'/package.json');
const {createClient}=require('@supabase/supabase-js');
const {NextRequest}=require('next/server');
const esbuild=require('esbuild');
const out=process.env.OPENPLAN_HELD_OUT;
const stage=(value)=>fs.appendFileSync(out+'/stages.jsonl',JSON.stringify({stage:value})+'\n');
stage('start');
const config=JSON.parse(fs.readFileSync(out+'/context-private.json'));
for(const [name,entry] of [['engine','src/lib/aerial/artifact-custody-server.ts'],['retry','src/app/api/aerial/processing-callback/custody/route.ts'],['callback','src/app/api/aerial/processing-callback/route.ts']]){
 stage('build-'+name);
 esbuild.buildSync({entryPoints:[entry],outfile:out+'/'+name+'.cjs',bundle:true,platform:'node',packages:'external',format:'cjs'});
}
const {runAerialCustodyPass}=require(out+'/engine.cjs');
const networkFetch=fetch;
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},global:{fetch:async(...args)=>{
 stage('database-fetch-'+(args[1]?.method??'GET'));const result=await networkFetch(...args);stage('database-response-'+result.status);return result;
}}});
const objects=new Map();
const storage={storage:{from:()=>({
 upload:async(path,bytes)=>{stage('synthetic-upload');if(!objects.has(path))objects.set(path,Buffer.from(bytes));return {error:null};},
 download:(path)=>({asStream:async()=>{stage('synthetic-read');return {data:objects.has(path)?new Blob([objects.get(path)]).stream():null,error:null};}}),
})}};
const candidates=(count)=>['orthomosaic','point_cloud'].slice(0,count).map(kind=>({kind,ordinal:0,downloadUrl:'https://example.invalid/proof.tif',expiresAt:'2099-01-01T00:00:00Z',sizeBytes:3,contentType:'image/tiff'}));
const results=[];
const timely=async(work)=>{
 let timer;
 try{return await Promise.race([work(),new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error('Native held constraint returns promptly through PostgREST')),4000);
 })]);}finally{clearTimeout(timer);}
};
for(const [name,count] of [['complete',1],['missing',2]]){
 stage('pass-'+name);
 const result=await timely(()=>runAerialCustodyPass({supabase:client,storageClientFactory:()=>storage,job:{processingJobId:config.jobs[name].id,workspaceId:config.workspace,missionId:config.mission},candidates:candidates(count),fetchImpl:async()=>{stage('synthetic-source');return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/tiff'}});}}));
 if(name==='complete'){
  if(result.unreadableReason!==null||result.posture.state!=='complete'||result.records[0]?.storage_path!=='proof/original-'+name+'.tif')throw Error('Native conflict recovery retains complete original custody');
 }else{
  if(!result.unreadableReason?.includes('1 expected')||result.posture.state==='complete')throw Error('Native bulk rollback preserves missing roster as outstanding');
 }
 results.push({case:name,state:result.posture.state,held:result.posture.heldCount,retryable:Boolean(result.unreadableReason)});
}
const retry=require(out+'/retry.cjs').POST;
for(const name of ['retry','human']){
 stage('route-'+name);
 const result=await retry(new NextRequest('http://127.0.0.1/custody',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN},body:JSON.stringify({processingJobId:config.jobs[name].id})}));
 const body=await result.json();if(result.status!==200||body.retriedCount!==0||body.custodyState!=='complete')throw Error('Native held retry completes without source transfer');
 results.push({case:name,status:result.status,retriedCount:body.retriedCount});
}
const callback=require(out+'/callback.cjs').POST;
stage('callback');
const result=await callback(new NextRequest('http://127.0.0.1/callback',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN},body:JSON.stringify(config.callback)}));
if(result.status!==200)throw Error('Native callback repairs pending custody readiness');
results.push({case:'callback',status:result.status});
const member=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.OPENPLAN_HELD_MEMBER_TOKEN,{auth:{persistSession:false}});
const visible=await member.from('aerial_artifact_custody').select('id').eq('processing_job_id',config.jobs.retry.id);
if(visible.error||visible.data?.length!==2)throw Error('Native HTTP member actually sees original held rows');
const refused=await member.from('aerial_artifact_custody').update({attempt_count:999}).eq('processing_job_id',config.jobs.retry.id).select('id');
if(refused.error||refused.data?.length!==0)throw Error('Native HTTP visible member rows remain unwritable');
results.push({case:'member-http',visible:visible.data.length,written:refused.data.length});
const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.OPENPLAN_HELD_ANON_TOKEN,{auth:{persistSession:false}});
const anonymous=await anon.from('aerial_artifact_custody').update({attempt_count:999}).eq('processing_job_id',config.jobs.retry.id).select('id');
if(anonymous.error?.code!=='42501')throw Error('Native HTTP anonymous role receives no custody write');
results.push({case:'anonymous-http',code:anonymous.error.code});
fs.writeFileSync(out+'/application.json',JSON.stringify(results,null,2)+'\n');
