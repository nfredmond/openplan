import { createRequire } from 'node:module';
const app=process.cwd();const require=createRequire(app+'/package.json');const {createClient}=require('@supabase/supabase-js');
const {failGtfsFeedVersion}=await import(app+'/src/lib/gtfs/persist.ts');
const writes:unknown[]=[];
const service=createClient(process.env.OPENPLAN_PROOF_HTTP_URL!,process.env.OPENPLAN_PROOF_HTTP_TOKEN!,{db:{schema:process.env.OPENPLAN_PROOF_HTTP_SCHEMA},auth:{persistSession:false},global:{fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{const u=new URL(String(input));u.pathname=u.pathname.replace(/^\/rest\/v1/,'');const r=await fetch(u,init);if(init?.method==='PATCH')writes.push({status:r.status,response:await r.clone().json()});return r;}}});
const result=await failGtfsFeedVersion({service,versionId:process.env.OPENPLAN_PROOF_VERSION!,code:'partial_write',detail:'Late failure after abandonment fence'});
console.log(JSON.stringify({result,writes},null,2));
