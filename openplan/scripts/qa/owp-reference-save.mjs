import {readFileSync,writeFileSync} from 'node:fs';
import {createServerClient} from '@supabase/ssr';
import {randomUUID} from 'node:crypto';
const programId=process.env.OWP_REFERENCE_PROGRAM,path=process.env.OWP_REFERENCE_OUTPUT,origin=process.env.OWP_EXERCISE_ORIGIN;
if(!programId||!path||!['http://127.0.0.1:3217','http://127.0.0.1:3218'].includes(origin)||new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port!=='56321')throw new Error('Explicit isolated exercise identity required');
const cookies=new Map();
const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>cookies.set(name,value))}});
const auth=await client.auth.signInWithPassword({email:'owp-preparation@openplan.test',password:process.env.OWP_EXERCISE_PASSWORD});
if(auth.error)throw new Error('Exercise sign-in failed');
const headers={'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
const url=`${origin}/api/programs/${programId}/work-program`;
const current=await fetch(url,{headers});if(!current.ok)throw new Error(`Preparation read failed ${current.status}`);
const loaded=await current.json();const expected=Number(process.env.OWP_REFERENCE_EXPECTED_REVISION??'0'); if((loaded.latest?.revision??0)!==expected)throw new Error('Expected exercise revision differs; refuses stale save');
if(process.env.OWP_REFERENCE_REFRESH_SOURCES==='1'){
 const results=[];
 for(const source of loaded.sources){
  const response=await fetch(`${url}/sources`,{method:'POST',headers,body:JSON.stringify({documentId:source.document_id,role:source.source_role,sourceUrl:source.source_url,extraction:'review',requestId:randomUUID()})});
  const result=await response.json();if(!response.ok)throw new Error(`Source refresh failed ${response.status}`);results.push(result);
 }
 writeFileSync(path+'.source-refresh.json',JSON.stringify(results,null,2),{mode:0o600});console.log(JSON.stringify({sourceVersions:results}));process.exit(0);
}
const draft=JSON.parse(readFileSync(path,'utf8')).draft;
const payload={expectedRevision:expected,requestId:randomUUID(),draft};
writeFileSync(path+'.save-request.json',JSON.stringify(payload),{mode:0o600});
const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)});const body=await response.json();if(!response.ok)throw new Error(JSON.stringify({status:response.status,...body}));
writeFileSync(path+'.saved.json',JSON.stringify(body,null,2),{mode:0o600});
const retry=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)}),again=await retry.json();if(!retry.ok||again.revision.id!==body.revision.id)throw new Error('Exact save retry did not return same revision');
const changed=await fetch(url,{method:'POST',headers,body:JSON.stringify({...payload,draft:{...draft,introduction:draft.introduction+' Changed retry must fail.'}})});if(changed.status!==409)throw new Error(`Changed request identity returned ${changed.status}`);
const results=[];for(const format of ['html','pdf','xlsx']){const queued=await fetch(`${url}/export?revision=${body.revision.revision}&format=${format}`,{method:'POST',headers});results.push({format,status:queued.status,body:await queued.json()});}
writeFileSync(path+'.delivery.json',JSON.stringify({revision:body.revision.id,revisionHash:body.revision.content_sha256,exactRetry:retry.status,changedRetry:changed.status,exports:results},null,2));
console.log(JSON.stringify({revision:body.revision.id,revisionNumber:body.revision.revision,exactRetry:retry.status,changedRetry:changed.status,exports:results.map(r=>({format:r.format,status:r.status}))}));
