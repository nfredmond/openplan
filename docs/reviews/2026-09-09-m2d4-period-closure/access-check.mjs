import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(process.cwd() + '/package.json');
const { createServerClient } = require('@supabase/ssr');
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).port !== '58821') throw Error('Expected named disposable M2d.3 stack');
const base = 'http://127.0.0.1:3261';
const fixtures = await Promise.all(['/tmp/m2d4-settlement-browser-fixture.json','/tmp/m2d3-shared-browser-fixture.json'].map(async p => JSON.parse(await readFile(p,'utf8'))));
async function session(fixture) {
 const cookies = new Map();
 const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(c=>cookies.set(c.name,c.value))}});
 const login = await auth.auth.signInWithPassword({email:fixture.email,password:fixture.password});
 if(login.error) throw login.error;
 return {Cookie:[...cookies].map(([key,value])=>key+'='+value).join('; ')};
}
const [owner,foreign] = await Promise.all(fixtures.map(session));


const { createClient } = require('@supabase/supabase-js');
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const email = `m2d4-member-${crypto.randomUUID()}@synthetic.example.test`;
const created = await service.auth.admin.createUser({email,password:fixtures[0].password,email_confirm:true});if(created.error)throw Error('Synthetic member creation failed');
const membership = await service.from('workspace_members').insert({workspace_id:fixtures[0].workspaceId,user_id:created.data.user.id,role:'member'});if(membership.error)throw Error('Synthetic membership creation failed');
const member=await session({email,password:fixtures[0].password});
const results=[];
const path='/api/programs/'+fixtures[0].programId+'/work-program/closeout?reportId='+fixtures[0].reportId;
for(const [actor,headers,status] of [['owner',owner,200],['anonymous',{},401],['foreign workspace owner',foreign,404],['workspace member',member,403]]){
 const response=await fetch(base+path,{headers});if(response.status!==status)throw Error(actor+' expected '+status+' got '+response.status);
 results.push({actor,method:'GET',status});
 if(actor!=='owner'){const write=await fetch(base+path,{headers:{...headers,'Content-Type':'application/json'},method:'POST',body:'{}'});if(write.status!==status)throw Error(actor+' write expected '+status+' got '+write.status);results.push({actor,method:'POST',status:write.status})}
}
const response=await fetch(base+path,{headers:owner});if(response.headers.get('cache-control')!=='private, no-store')throw Error('Private caching missing');const data=await response.json();
const exported=JSON.parse(await readFile('/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09/original-approval-1440.json','utf8'));
const current=data.records.find(r=>r.id===exported.id);
if(JSON.stringify(current)!==JSON.stringify(exported))throw Error('Original approval changed');
const actuals=await service.from('work_program_actual_versions').select('id,entry_id').eq('program_id',fixtures[0].programId);if(actuals.error)throw Error('Actual history unavailable');if(actuals.data.length!==3 || new Set(actuals.data.map(a=>a.entry_id)).size!==3)throw Error('Carryover created or changed physical costs');
const closureExport=JSON.parse(await readFile('/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09/original-period-decision-1440.json','utf8'));
if(JSON.stringify(data.closures.find(r=>r.id===closureExport.id))!==JSON.stringify(closureExport))throw Error('Original period closure changed');
await writeFile('/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09/access-results.json',JSON.stringify({results,originalApprovalUnchanged:true,originalPeriodClosureUnchanged:true,physicalActualRows:3,physicalEntries:3,privateCaching:true,baselineHash:current.content.source.report.snapshot.baseline.content_sha256,blindCategory:'Synthetic browser identities; actual agency authority and usefulness unproved.'},null,2)+'\n');
console.log('Owner access succeeds; anonymous, member and foreign workspace reads/writes denied; original approval and three physical entries preserved.');
