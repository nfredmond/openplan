import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {loadCloseLoopEntries} from '/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan/src/lib/engagement/close-loop.ts';
const root='/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12';
const require=createRequire('/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan/package.json');
const {createClient}=require('@supabase/supabase-js');
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:29821');
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const account=JSON.parse(readFileSync(`${root}/api-settings-account.json`));
assert.equal((await client.auth.signInWithPassword({email:account.email,password:account.password})).error,null);
const prior=JSON.parse(readFileSync(`${root}/m9b-snapshot-large-1440-browser.json`));
try{
 const result=await loadCloseLoopEntries(client,prior.campaignId);assert.equal(result.error,null);
 const sha256=createHash('sha256').update(JSON.stringify({entries:result.rows})).digest('hex');assert.equal(sha256,prior.originalHash);
 writeFileSync(`${root}/m9b-response-write-custody.json`,JSON.stringify({campaignId:prior.campaignId,entryCount:result.rows.length,afterRollbackSha256:sha256,priorBrowserSha256:prior.originalHash,matched:true},null,2));console.log('After rollback, all 1005 responses match the original browser hash');
}finally{await client.auth.signOut({scope:'local'})}
