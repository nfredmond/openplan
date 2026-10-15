import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json');
const {StorageClient}=require('@supabase/storage-js');
const esbuild=require('esbuild');
const out=process.env.OPENPLAN_PROOF_OUT;
fs.mkdirSync(out,{recursive:true,mode:0o700});
esbuild.buildSync({entryPoints:['src/lib/aerial/artifact-custody-server.ts'],outfile:out+'/custody.cjs',bundle:true,platform:'node',format:'cjs'});
const {runAerialCustodyPass}=require(out+'/custody.cjs');
const rows=[];const job={workspaceId:'11111111-1111-4111-8111-111111111111',missionId:'22222222-2222-4222-8222-222222222222',processingJobId:'33333333-3333-4333-8333-333333333333'};
const db = {
  from: () => ({
    upsert: async (next) => { rows.splice(0, rows.length, ...next); return {error: null}; },
    select: () => ({eq: async () => ({data: rows, error: null})}),
    update: () => ({eq: () => ({select: async () => ({data: [{id: job.processingJobId}], error: null})})}),
  }),
  // workspace_storage_bytes (20261017000010): an empty workspace, so custody may store.
  rpc: async (name, args) => {
    assert.equal(name, 'workspace_storage_bytes', 'Fixture requires original storage RPC');
    assert.deepEqual(args, {p_workspace_id: job.workspaceId}, 'Fixture requires original workspace scope');
    return {data: 0, error: null};
  },
};
await assert.rejects(db.rpc('wrong_rpc', {p_workspace_id: job.workspaceId}), /Fixture requires original storage RPC/, 'Wrong RPC must fail the fixture');
await assert.rejects(db.rpc('workspace_storage_bytes', {p_workspace_id: 'another-workspace'}), /Fixture requires original workspace scope/, 'Wrong workspace must fail the fixture');
const candidate={kind:'orthomosaic',ordinal:0,downloadUrl:'https://example.invalid/source.tif',expiresAt:'2099-01-01T00:00:00Z'};
const cases=[];
for (const mode of ['upload-deadline','upload-cancellation','read-deadline','read-cancellation','read-size','thrown-acknowledgement'].filter(mode => !process.env.OPENPLAN_PROOF_MODE || process.env.OPENPLAN_PROOF_MODE===mode)) {
 rows.length=0;
 let closed=false;let bytesSent=0;let enteredResolve;const entered=new Promise(r=>{enteredResolve=r});
 let closeResolve;const connectionClosed=new Promise(r=>{closeResolve=r});let interval;
 const controller=new AbortController();let posts=0;let reads=0;
 const server=createServer((req,res)=>{
  if(req.method==='POST'){
   posts++;req.resume();
   if(mode.startsWith('upload-')){
    res.on('close',()=>{closed=true;closeResolve();});enteredResolve();return;
   }
   req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({Key:'test'}));});
  } else {
   reads++;
   res.on('close',()=>{closed=true;clearInterval(interval);closeResolve();});
   res.writeHead(200,{'content-type':'application/octet-stream'});
   if(mode==='thrown-acknowledgement'){res.end(Buffer.from([1,2,3]));return;}
   if(mode==='read-size'){
    bytesSent+=64*1024;res.write(Buffer.alloc(64*1024));interval=setInterval(()=>{bytesSent+=64*1024;res.write(Buffer.alloc(64*1024));},5);return;
   }
   res.write(Buffer.from([1]));enteredResolve();
  }
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port;
 const storageClientFactory=(fetchImpl)=>{
  const api=new StorageClient(url,{},fetchImpl);
  if(mode!=='thrown-acknowledgement')return {storage:api};
  return {storage:{from:(bucket)=>{
   const file=api.from(bucket);
   return {download:(...args)=>file.download(...args),upload:async(...args)=>{await file.upload(...args);throw Error('Synthetic lost acknowledgement');}};
  }}};
 };
 try {
  const started=performance.now();let canceledAt=null;
  const pending=runAerialCustodyPass({supabase:db,storageClientFactory,signal:controller.signal,job,candidates:[candidate],env:{OPENPLAN_AERIAL_CUSTODY_BUDGET_MS:mode.endsWith('deadline')?'500':'5000'},fetchImpl:async()=>new Response(Buffer.from([1,2,3]),{headers:{'content-type':'image/tiff'}})});
  if(mode.endsWith('cancellation')){await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('Owned HTTP request did not arrive')),2000).unref())]);canceledAt=performance.now();controller.abort();}
  const result=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('Native custody transport failed to stop')),7000).unref())]);
  if(mode.endsWith('cancellation'))assert.ok(performance.now()-canceledAt<1000,'Current cancellation stops transfer before its later deadline');
  if(mode.endsWith('deadline'))assert.ok(performance.now()-started<2000,'Pass deadline bounds actual Storage transfer');
  if(mode==='thrown-acknowledgement'){
   assert.equal(result.records[0]?.state,'held','Thrown acknowledgement reconciles actual native bytes');assert.equal(posts,1);assert.equal(reads,1);
  } else {
   assert.equal(result.records[0]?.state,'failed','Interrupted or excessive Storage cannot become held');
   await Promise.race([connectionClosed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Native HTTP response remained open')),2000).unref())]);
   assert.equal(closed,true,'Native Storage response closes after cancellation or refusal');
   if(mode==='read-size')assert.ok(bytesSent<=128*1024,'Excessive stream stops before continued network accumulation');
  }
  cases.push({mode,posts,reads,bytesSent,responseClosed:closed,state:result.records[0]?.state});
 }finally{clearInterval(interval);server.closeAllConnections();await new Promise(r=>server.close(r));}
}
fs.writeFileSync(out+'/transport.json',JSON.stringify({cases,scope:'Installed SDK and compiled engine against owned loopback HTTP fixtures; database writes and storage permissions simulated. Not hosted DNS/TLS, live RLS, browser or concurrent recovery.'},null,2)+'\n');
console.log(cases);
