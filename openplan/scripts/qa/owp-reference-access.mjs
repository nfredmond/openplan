/** Local synthetic HTTP role checks against the retained engineering exercise, with no external messages. */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const origin=process.env.OWP_EXERCISE_ORIGIN,program=process.env.OWP_REFERENCE_PROGRAM,input=process.env.OWP_REFERENCE_OUTPUT;
if(origin!=='http://127.0.0.1:3218'||new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port!=='56321'||!program||!input)throw new Error('Isolated exercise identity required');
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const record=await service.from('programs').select('workspace_id,title').eq('id',program).single();
if(record.error||!record.data.title.includes('engineering exercise'))throw new Error('Not the reference exercise');
const saved=JSON.parse(readFileSync(input+'.saved.json','utf8')).revision;
const documents=await service.from('kb_documents').select('id,checksum,work_program_export_format').eq('workspace_id',record.data.workspace_id).eq('work_program_revision_id',saved.id);
if(documents.error||documents.data.length!==3)throw new Error('Retained artifacts unavailable');
const source=await service.from('program_work_program_sources').select('document_id').eq('program_id',program).limit(1).single();
const users=[],results=[];
async function session(email,password){const jar=new Map();const auth=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:rows=>rows.forEach(({name,value})=>jar.set(name,value))}});const signed=await auth.auth.signInWithPassword({email,password});if(signed.error)throw new Error('Synthetic sign-in failed');return {'Content-Type':'application/json',Cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; ')};}
async function check(role,headers,readStatus,writeStatus){
 const paths=[`/api/programs/${program}/work-program`,`/api/knowledge-base/documents/${source.data.document_id}/ocr`,...documents.data.map(doc=>`/api/programs/${program}/work-program/export?revision=${saved.revision}&format=${doc.work_program_export_format}`)];
 for(const path of paths){const response=await fetch(origin+path,{headers});results.push({role,operation:path,status:response.status});if(response.status!==readStatus)throw new Error(`${role} read returned ${response.status}`);}
 for(const doc of documents.data){const response=await fetch(`${origin}/api/knowledge-base/documents/${doc.id}/download?delivery=authenticated`,{headers});const bytes=Buffer.from(await response.arrayBuffer());const checksum=createHash('sha256').update(bytes).digest('hex');results.push({role,operation:'download '+doc.work_program_export_format,status:response.status,checksum:response.ok?checksum:null});if(response.status!==readStatus||(response.ok&&checksum!==doc.checksum))throw new Error(`${role} artifact access/identity failed`);}
 const response=await fetch(`${origin}/api/programs/${program}/work-program`,{method:'POST',headers,body:JSON.stringify({expectedRevision:saved.revision-1,requestId:randomUUID(),draft:saved.content_json})});results.push({role,operation:'stale save',status:response.status});if(response.status!==writeStatus)throw new Error(`${role} write returned ${response.status}`);
}
try {
 const owner=await session('owp-preparation@openplan.test',process.env.OWP_EXERCISE_PASSWORD);await check('owner',owner,200,409);
 for(const role of ['member','viewer','outsider']){
  const email=`owp-${role}-${randomUUID()}@example.test`,password=randomUUID()+'!aA';
  const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw new Error('Synthetic account creation failed');const id=created.data.user.id;users.push(id);
  if(role!=='outsider'){const linked=await service.from('workspace_members').insert({workspace_id:record.data.workspace_id,user_id:id,role});if(linked.error)throw new Error('Synthetic role setup failed');}
  const headers=await session(email,password);await check(role,headers,role==='outsider'?404:200,role==='outsider'?404:role==='viewer'?403:409);
  if(role==='member'){const revoked=await service.from('workspace_members').delete().eq('workspace_id',record.data.workspace_id).eq('user_id',id);if(revoked.error)throw new Error('Synthetic revoke failed');await check('revoked member',headers,404,404);}
 }
} finally {
 for(const id of users){await service.from('workspace_members').delete().eq('workspace_id',record.data.workspace_id).eq('user_id',id);await service.auth.admin.deleteUser(id);}
 writeFileSync(input+'.access.json',JSON.stringify(results,null,2),{mode:0o600});
}
console.log(JSON.stringify({checks:results.length,roles:[...new Set(results.map(row=>row.role))],passed:true}));
