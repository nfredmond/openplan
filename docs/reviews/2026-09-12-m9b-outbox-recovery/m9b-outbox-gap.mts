import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const modulePath=resolve('src/lib/notifications/engagement.ts');
const { enqueueEmail }=await import(pathToFileURL(modulePath).href);
let transportCalls=0, insertCalls=0;
const originalFetch=globalThis.fetch;
const originalKey=process.env.RESEND_API_KEY;
try {
  process.env.RESEND_API_KEY='SYNTHETIC-LOCAL-PROBE-NOT-A-KEY';
  globalThis.fetch=async (input) => {
    assert.equal(String(input),'https://api.resend.com/emails');
    transportCalls++;
    return new Response('{}',{status:200});
  };
  const client={from:(table:string)=>{
    assert.equal(table,'engagement_email_outbox');
    return {insert:()=>{insertCalls++;return {select:(columns:string)=>{
      assert.equal(columns,'id');
      return {single:async()=>({data:null,error:{message:'SYNTHETIC outbox insert refused',code:'42501'}})};
    }}}};
  }};
  const outcome=await enqueueEmail(client as never,{campaignId:null,to:'synthetic@example.invalid',subject:'SYNTHETIC local probe',text:'SYNTHETIC local probe'});
  assert.equal(insertCalls,1);
  assert.equal(transportCalls,1,'GAP: transport attempted despite failed outbox');
  assert.equal(outcome.outboxId,null);
  assert.equal(outcome.status,'sent');
  const receipt={scope:'Real helper with local database and transport doubles; no email or network request sent',source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),moduleSha256:createHash('sha256').update(readFileSync(modulePath)).digest('hex'),insertCalls,transportCalls,outcome};
  writeFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/m9b-outbox-gap.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} finally {
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;
}
