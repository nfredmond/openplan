import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
const root=process.cwd(),directory='/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority';
const require=createRequire(join(root,'package.json'));
const {createServerClient}=require('@supabase/ssr'),{createClient}=require('@supabase/supabase-js');
const {requireContractVerificationStack}=await import(join(root,'src/test/helpers/contract-verification-stack.ts'));
const {hashFrozenRecord,serializeFrozenPlanContent}=await import(join(root,'src/lib/land-use-plans/versioning.ts'));
requireContractVerificationStack('supabase_db_openplan-restore-target-2026091050');
if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:29821')throw Error('Unexpected database target');
const origin='http://127.0.0.1:3494',expectedCommit='c29d064045b3';
const health=await(await fetch(origin+'/api/health')).json();if(health.deployment?.commit!==expectedCommit)throw Error('Unexpected application build');
const fixture=JSON.parse(await readFile('/home/nathaniel/.local/state/openplan/approval-resume-2026-09-27/t3-thematic-browser-producer-input.json','utf8'));
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function checked(result){if(result.error)throw Error('Native operation failed: '+result.error.code);return result.data;}
function session(){const jar=new Map();const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll(){return [...jar].map(([name,value])=>({name,value}));},setAll(values){for(const value of values)jar.set(value.name,value.value);}}});return {jar,client};}
const owner=session(),actor=checked(await owner.client.auth.signInWithPassword({email:fixture.email,password:fixture.password})).user.id;
const workspaceId=randomUUID(),marker='SYNTHETIC freeze API '+randomUUID();
const journal={applicationCommit:expectedCommit,actor,workspaceId,marker,startedAt:new Date().toISOString(),requests:[],state:'starting'};
const journalPath=join(directory,'freeze-native-http-private.json');
await writeFile(journalPath,JSON.stringify(journal),{mode:0o600,flag:'wx'});
async function retain(){await writeFile(journalPath,JSON.stringify(journal),{mode:0o600});}
checked(await service.from('workspaces').insert({id:workspaceId,name:marker,slug:workspaceId}));
checked(await service.from('workspace_members').insert({workspace_id:workspaceId,user_id:actor,role:'owner'}));
owner.jar.set('openplan_active_workspace',workspaceId);
async function call(path,method,body,expected,options={}){
 const text=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),using=options.session??owner;
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:[...using.jar].map(([k,v])=>k+'='+v).join('; '),
  'x-openplan-expected-user':options.actor??actor,'x-openplan-expected-workspace':workspaceId,...options.headers};
 if(options.anonymous)delete headers.Cookie;
 const row={path,method,bodySha256:text===undefined?null:createHash('sha256').update(text).digest('hex'),expected};journal.requests.push(row);await retain();
 const response=await fetch(origin+path,{method,headers,body:text});const result=await response.json();row.status=response.status;row.privateNoStore=response.headers.get('cache-control')==='private, no-store';await retain();
 if(response.status!==expected)throw Error('Unexpected HTTP '+response.status+' expected '+expected+' for '+path+' '+JSON.stringify(result));
 if(path.endsWith('/freeze') && !row.privateNoStore)throw Error('Freeze response is cacheable');
 return result;
}
const geometry={type:'Polygon',coordinates:[[[-121.5,38.5],[-121.4,38.5],[-121.4,38.6],[-121.5,38.5]]]};
const created=await call('/api/land-use-plans','POST',{title:marker,descriptorId:'local-unconfigured',planKindKey:'community',authorityLabel:'SYNTHETIC unresolved authority',geographyLabel:'SYNTHETIC study',geographyGeojson:geometry},201);
journal.planId=created.planId;journal.versionId=created.versionId;await retain();const base='/api/land-use-plans/'+created.planId,path=base+'/freeze';
await call(base+'/context','POST',{commandId:randomUUID(),versionId:created.versionId,expectedContextHash:null,descriptorId:'local-unconfigured',planKindKey:'community',place:{mode:'uploaded',geometry,label:'SYNTHETIC frozen study'},assessment:{authorities:[{id:randomUUID(),label:'SYNTHETIC unresolved body',role:'adopting',kind:'unassessed',jurisdiction:null,sourceUrls:[]}],applicability:{status:'unresolved',explanation:'Synthetic verification only. No legal applicability or agency approval.'}}},201);
let detail=await call(base,'GET',undefined,200);
for(const node of detail.nodes.filter(n=>n.node_kind==='section'))await call(base+'/content','POST',{operation:'update',nodeId:node.id,body:'SYNTHETIC saved section. No factual planning conclusions.'},200);
const policies=[];
for(let n=0;n<2;n++)policies.push((await call(base+'/content','POST',{operation:'create',nodeKind:'policy',title:'SYNTHETIC policy '+n,body:'SYNTHETIC policy text',sortOrder:10+n},201)).nodeId);
const layerId=randomUUID(),layerVersionId=randomUUID();journal.layerId=layerId;journal.layerVersionId=layerVersionId;await retain();
checked(await service.from('workspace_gis_layers').insert({id:layerId,workspace_id:workspaceId,name:'SYNTHETIC empty freeze map'}));
checked(await service.from('workspace_gis_layer_versions').insert({id:layerVersionId,layer_id:layerId,workspace_id:workspaceId,version_number:1,source_format:'geojson',source_filename:'SYNTHETIC.geojson',source_byte_size:0,srs_name:'WGS84',srs_basis:'geojson_rfc7946_default',declared_feature_count:0,source_feature_count:0}));
checked(await service.from('workspace_gis_layer_versions').update({ingest_status:'ready',finalized_at:new Date().toISOString()}).eq('id',layerVersionId));
await call(base+'/designations','POST',{layerId,layerVersionId,designationSetLabel:'SYNTHETIC empty map',legendMetadata:{purpose:'Synthetic custody exercise'},publicFieldKeys:[],legendField:null,policyNodeIds:policies.sort().reverse()},201);
await call(base+'/implementation','POST',{operation:'create',title:'SYNTHETIC implementation action',description:'Fixture only',responsibleParty:'SYNTHETIC staff',dueOn:'2026-10-08'},201);
await call(base+'/reviews','POST',{operation:'record_consultation',versionId:created.versionId,status:'not_applicable',confidentialNotes:'PRIVATE SYNTHETIC CONSULTATION MUST NOT ENTER PUBLIC CONTENT',containsSensitiveLocations:false},200);
detail=await call(base,'GET',undefined,200);
function makeCommand(data){return {state:'public_review',commandId:randomUUID(),versionId:data.activeVersion.id,expectedDraftRevision:data.activeVersion.draft_revision,expectedDescriptorHash:data.descriptorHash};}
const stale=makeCommand(detail);journal.staleCommand=JSON.stringify(stale);await retain();
await call(base+'/content','POST',{operation:'update',nodeId:policies[0],body:'SYNTHETIC changed policy after observed draft'},200);
await call(path,'POST',journal.staleCommand,409);
detail=await call(base,'GET',undefined,200);const command=makeCommand(detail),raw=' \n'+JSON.stringify(command)+'\n ';journal.originalCommand=raw;await retain();
for(const headers of [{'x-openplan-expected-user':randomUUID()},{'x-openplan-expected-workspace':randomUUID()},{Origin:'http://elsewhere.test'},{'x-openplan-assistant-execution-source':''},{'x-openplan-assistant-input-hash':''},{'x-openplan-assistant-approval-id':''}])await call(path,'POST',raw,403,{headers});
const direct=await owner.client.from('land_use_plan_versions').update({state:'public_review',content_hash:'a'.repeat(64),frozen_at:new Date().toISOString(),frozen_by:actor,frozen_snapshot:{planContext:(await call(base+'/context','GET',undefined,200)).contextState.context}}).eq('id',created.versionId);
if(direct.error?.code!=='42501')throw Error('Direct authenticated freeze not refused');journal.directFreezeRefused=true;await retain();
const first=await call(path,'POST',raw,201);journal.first=first;await retain();
const again=await call(path,'POST',raw,200);if(hashFrozenRecord({...again,replayed:false})!==hashFrozenRecord(first))throw Error('Replay changed receipt');
await call(path,'POST',raw+' ',409);
const saved=checked(await service.from('land_use_plan_freeze_commands').select('command_text,command_sha256,frozen_snapshot_text,content_hash,review_event_id').eq('plan_id',created.planId).eq('command_id',command.commandId).single());
const version=checked(await service.from('land_use_plan_versions').select('id,state,content_hash,frozen_snapshot,draft_revision').eq('id',created.versionId).single());
if(saved.command_text!==raw||saved.command_sha256!==createHash('sha256').update(raw).digest('hex')||saved.content_hash!==first.contentHash||version.content_hash!==first.contentHash||hashFrozenRecord(version.frozen_snapshot)!==first.contentHash||serializeFrozenPlanContent(version.frozen_snapshot)!==saved.frozen_snapshot_text)throw Error('Canonical command or snapshot custody mismatch');
if(version.frozen_snapshot.version.draftRevision!==command.expectedDraftRevision||version.frozen_snapshot.planContext?.place.label!=='SYNTHETIC frozen study')throw Error('Frozen revision/context mismatch');
if(JSON.stringify(version.frozen_snapshot).includes('PRIVATE SYNTHETIC'))throw Error('Private note leaked');
const links=version.frozen_snapshot.designations[0].land_use_plan_designation_policy_links.map(p=>p.policy_node_id);if(JSON.stringify(links)!==JSON.stringify([...policies].sort()))throw Error('Policy order mismatch');
const events=checked(await service.from('land_use_plan_review_events').select('id').eq('version_id',created.versionId).eq('event_kind','public_draft'));if(events.length!==1||events[0].id!==first.reviewEventId)throw Error('Duplicate or missing event');
const newer=await call(base+'/versions','POST',{baseVersionId:created.versionId},201);journal.newerVersionId=newer.versionId;await retain();
await call(path,'POST',raw,200);
const after=await call(base,'GET',undefined,200);if(after.activeVersion.id!==newer.versionId||after.activeVersion.state!=='working')throw Error('Old replay changed new working version');
const other=session(),email='synthetic-freeze-'+randomUUID()+'@example.test',password=randomBytes(24).toString('base64url');
const otherUser=checked(await service.auth.admin.createUser({email,password,email_confirm:true})).user;journal.otherActor=otherUser.id;await retain();
checked(await service.from('workspace_members').insert({workspace_id:workspaceId,user_id:otherUser.id,role:'owner'}));
checked(await other.client.auth.signInWithPassword({email,password}));other.jar.set('openplan_active_workspace',workspaceId);
await call(path,'POST',raw,409,{session:other,actor:otherUser.id});
try {checked(await service.from('workspace_members').update({role:'viewer'}).eq('workspace_id',workspaceId).eq('user_id',actor));await call(path,'POST',raw,403);}
finally {checked(await service.from('workspace_members').update({role:'owner'}).eq('workspace_id',workspaceId).eq('user_id',actor));checked(await service.from('workspace_members').update({role:'viewer'}).eq('workspace_id',workspaceId).eq('user_id',otherUser.id));}
await call(path,'POST',raw,403,{session:other,actor:otherUser.id});await call(path,'POST',raw,200);
const doc=await call('/api/knowledge-base/documents/paste','POST',{workspaceId,title:'SYNTHETIC freeze review document',text:'SYNTHETIC TEST ONLY. No public review, agency decision, consultation, legal determination or scientific validation occurred. This is local software verification.',docKind:'other'},201);
const release=await call(base+'/review-releases','POST',{operation:'release',versionId:created.versionId,versionContentHash:first.contentHash,reviewMethod:'external_process',reviewOpenOn:'2026-10-07',reviewCloseOn:'2026-10-08',engagementCampaignId:null,externalReviewDocumentId:doc.document.id},201);journal.releaseId=release.releaseId;journal.publicUrl=release.publicUrl;await retain();
const token=release.publicUrl.split('/').at(-1),packet=await call('/api/public/land-use-plan-reviews/'+token,'GET',undefined,200,{anonymous:true});
if(packet.version.contentHash!==first.contentHash||hashFrozenRecord(packet.content)!==first.contentHash||packet.descriptorCustody!=='frozen'||packet.content.planContext?.place.label!=='SYNTHETIC frozen study')throw Error('Public packet hash/context differs');
journal.state='verified';journal.finishedAt=new Date().toISOString();await retain();
console.log(JSON.stringify({applicationCommit:expectedCommit,workspaceId,planId:created.planId,versionId:created.versionId,newerVersionId:newer.versionId,requests:journal.requests,contentHash:first.contentHash,canonicalSnapshotMatchesDatabaseAndPublicPacket:true,exactCommandBytesRetained:true,sortedPolicyLinks:true,privateNotesExcluded:true,oldReplayPreservesNewerDraft:true,oneFreezeEvent:true,directTableFreezeRefused:true,revokedReplayRefused:true,fixturesPreserved:true,boundary:'Synthetic production HTTP and native database checks. Empty GIS fixture; no actual public process, agency approval, browser observation, accessibility, real simultaneous transactions or scientific acceptance.'}));
