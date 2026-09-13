/** Real disposable PostgREST and native worker, with an interrupted acknowledgement. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const review=dirname(fileURLToPath(import.meta.url)),app=resolve(review,'../../../openplan');
const {createClient}=createRequire(join(app,'package.json'))('@supabase/supabase-js');
const env=parseEnv(await readFile(join(app,'.env.local'),'utf8'));
const account=JSON.parse(await readFile('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json','utf8'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:29821');
const container='supabase_db_openplan-restore-target-2026091050';
const sql=query=>execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
assert.equal(sql("SELECT count(*) FROM engagement_response_broadcast_messages WHERE state IN ('queued','attempting');"),'0','Other messages are active; do not consume them');
assert.equal(sql("SELECT count(*) FROM engagement_response_broadcasts WHERE state='queued';"),'0','Other publications await preparation');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);
const staff=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const login=await staff.auth.signInWithPassword({email:account.email,password:account.password});assert.equal(login.error,null);assert.equal(login.data.user.id,'4a21e42f-27a7-474d-9a7a-5912c70af359');
const campaignId=randomUUID(),subscriptionId=randomUUID(),requestId=randomUUID();
const recipient=`synthetic-worker-${subscriptionId}@example.invalid`;
// Synthetic integration fixtures use real REST producers; this is not a public signup journey.
assert.equal((await service.from('engagement_campaigns').insert({id:campaignId,workspace_id:'f02e465a-40bd-4304-b4af-d45daff29d3d',title:'SYNTHETIC PostgREST worker recovery',status:'active',share_token:randomUUID()})).error,null);
assert.equal((await service.from('engagement_subscriptions').insert({id:subscriptionId,campaign_id:campaignId,email:recipient,confirmed:true,confirm_token:randomUUID(),unsubscribe_token:randomUUID()})).error,null);
const written=await staff.rpc('write_engagement_response',{p_campaign:campaignId,p_request:requestId,p_operation:'create',p_response:null,p_expected_updated_at:null,p_reason:null,p_changes:{theme_title:'SYNTHETIC worker restart',we_did:'SYNTHETIC retained outcome',status:'published'}});assert.equal(written.error,null);assert.equal(written.data.becamePublished,true);
const directory=await mkdtemp('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/worker-postgrest-');
const finishes=[],claims=[];let interrupt=true;
const server=createServer(async(req,res)=>{
 try{
  assert.ok(['/rest/v1/rpc/prepare_engagement_response_broadcast','/rest/v1/rpc/claim_engagement_response_email','/rest/v1/rpc/finish_engagement_response_email'].includes(req.url));
  let body='';for await(const chunk of req)body+=chunk;
  const result=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+req.url,{method:'POST',headers:{apikey:req.headers.apikey,authorization:req.headers.authorization,'content-type':'application/json'},body});
  const text=await result.text();
  if(req.url.endsWith('/claim_engagement_response_email'))claims.push(JSON.parse(text));
  if(req.url.endsWith('/finish_engagement_response_email')){
   finishes.push({args:JSON.parse(body),status:result.status,result:JSON.parse(text)});
   if(interrupt){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({message:'SYNTHETIC lost acknowledgement'}));return;}
  }
  res.writeHead(result.status,{'content-type':'application/json'});res.end(text);
 }catch{res.writeHead(500);res.end('SYNTHETIC proxy failure');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
async function until(test,message){const end=Date.now()+15000;while(Date.now()<end){if(await test())return;await delay(50);}throw Error(message);}
async function files(dir){const result=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())result.push(...await files(path));else result.push(path);}return result;}
function start(){
 const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/workers/engagement-email.ts'],{cwd:app,env:{...process.env,...env,RESEND_API_KEY:'',NEXT_PUBLIC_SUPABASE_URL:origin,OPENPLAN_ENGAGEMENT_EMAIL_WORK_DIR:directory},stdio:['ignore','pipe','pipe']});
 const worker={child,output:''};child.stdout.on('data',v=>worker.output+=v);child.stderr.on('data',v=>worker.output+=v);return worker;
}
async function stop(worker){if(worker&&worker.child.exitCode===null&&worker.child.signalCode===null){worker.child.kill('SIGTERM');await until(()=>worker.child.exitCode!==null||worker.child.signalCode!==null,'Owned worker did not stop');}if(worker)assert.equal(worker.child.exitCode,0);}
let first,resumed;
try{
 first=start();await until(()=>finishes.length===1,'Worker did not record its outcome');await stop(first);
 assert.equal(finishes[0].status,200);assert.equal(finishes[0].result,true);assert.equal(finishes[0].args.p_state,'skipped');
 assert.equal((await files(directory)).filter(p=>p.endsWith('.pending.json')).length,1);
 interrupt=false;resumed=start();await until(()=>finishes.length===2,'Restart did not replay its retained acknowledgement');
 await until(async()=> (await files(directory)).some(p=>p.endsWith('.recorded.json')),'Acknowledged outcome did not leave pending state');await stop(resumed);
 assert.deepEqual(finishes[0].args,finishes[1].args);assert.equal(finishes[1].status,200);assert.equal(finishes[1].result,true);
 assert.equal(claims.filter(c=>c?.state==='attempting').length,1);
 const output=first.output+resumed.output;await writeFile(join(directory,'worker.log'),output,{mode:0o600});
 assert.equal(output.split('email transport not configured').length-1,1,'Restart repeated the transport call');assert.ok(!output.includes(recipient),'Recipient disclosed in worker log');
 assert.equal(sql(`SELECT count(*) FROM engagement_email_outbox WHERE campaign_id='${campaignId}' AND status='skipped' AND transport='none';`),'1');
 assert.equal(sql(`SELECT count(*) FROM engagement_response_broadcast_messages WHERE campaign_id='${campaignId}' AND state='skipped';`),'1');
 assert.equal(sql(`SELECT count(*) FROM engagement_response_history WHERE campaign_id='${campaignId}';`),'1');
 const report={container,campaignId,requestId,source:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),nativeWorkerSha256:createHash('sha256').update(await readFile(join(app,'scripts/workers/engagement-email.ts'))).digest('hex'),realPostgrest:true,interruptedAfterDatabaseCommit:true,identicalAcknowledgements:2,attemptingClaims:1,transportCalls:1,externalProviderConfigured:false,durableOutcome:'skipped',limitations:'Confirmed subscriber is a synthetic REST fixture. No actual mail provider, public confirmation flow, or inbox delivery was exercised.'};
 await writeFile(process.env.OPENPLAN_WORKER_PROBE_REPORT || join(review,'worker-postgrest-results.json'),JSON.stringify(report,null,2)+'\n');console.log('Live PostgREST worker restart preserved one skipped outcome and replayed only its acknowledgement');
}finally{await stop(first);await stop(resumed);await new Promise(resolve=>server.close(resolve));await staff.auth.signOut();}
