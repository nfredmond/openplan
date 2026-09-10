import {createRequire} from 'node:module';import fs from 'node:fs';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json'),{createServerClient}=require('@supabase/ssr'),{createClient}=require('@supabase/supabase-js');
const fixture=JSON.parse(fs.readFileSync('/tmp/m2d4-settlement-browser-fixture.json')),output='/tmp/m2d4-multi-carryover-successor.json',base=process.env.OPENPLAN_BROWSER_BASE||'http://127.0.0.1:3263';
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:58821');
if(fs.existsSync(output)){console.log('Retained synthetic successor reused');process.exit(0)}
const cookies=new Map(),client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(c=>cookies.set(c.name,c.value))}});
const login=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});if(login.error)throw login.error;
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
async function api(path,body,type='application/json'){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':type,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;}
const source=await api(`/api/programs/${fixture.successorId}/work-program`),draft=structuredClone(source.latest.content_json);
// Reuse the program created with HTTP 201 on the first preparation attempt.
const program={programId:'6b19b519-1d10-4fad-84ea-03192f5e3326'};
draft.elements=[0,1].map((i)=>({...structuredClone(draft.elements[0]),id:randomUUID(),code:'SPLIT-'+(i+1),title:['Finish synthetic analysis','Complete synthetic consultation'][i],budget:draft.elements[0].budget.map(b=>({...b,id:randomUUID()})),tasks:draft.elements[0].tasks.map(t=>({...t,id:randomUUID()}))}));
draft.preparation.funds=[0,1].map(i=>({...draft.preparation.funds[0],id:randomUUID(),name:['Synthetic analysis carryover','Synthetic consultation carryover'][i],amount:30}));
const saved=await api(`/api/programs/${program.programId}/work-program`,{expectedRevision:0,requestId:randomUUID(),draft});
const document=await api(`/api/knowledge-base/documents?workspaceId=${fixture.workspaceId}&title=Synthetic%20split%20carryover%20authority&filename=synthetic-split-authority.txt`,'SYNTHETIC ENGINEERING FIXTURE. No real agency approval. Split work and funding authority evidence for isolated browser verification.','text/plain');
for(const [kind,actor,sequence,extra] of [['submit',fixture.ownerId,0,{reviewerIds:[fixture.reviewerId]}],['approve',fixture.reviewerId,1,{}],['adoption',fixture.ownerId,2,{documentIds:[document.document.id]}]]){
const result=await service.rpc('record_work_program_event',{p_program_id:program.programId,p_actor_id:actor,p_command:{requestId:randomUUID(),expectedSequence:sequence,expectedRevision:1,revisionId:saved.revision.id,revisionHash:saved.revision.content_sha256,kind,note:'SYNTHETIC split carryover evidence only',visibility:'internal',reviewerIds:[],documentIds:[],authority:kind==='adoption'?'Synthetic board':'',scope:kind==='adoption'?'Synthetic successor work and funding':'',evidenceDate:kind==='adoption'?'2026-09-09':null,...extra}});if(result.error)throw result.error;
}
fs.writeFileSync(output,JSON.stringify({programId:program.programId,revisionId:saved.revision.id,hash:saved.revision.content_sha256,elements:draft.elements.map(e=>e.id),funds:draft.preparation.funds.map(f=>f.id)}),{mode:0o600});console.log('Synthetic multi-work, multi-fund successor saved and adopted through product producers.');
