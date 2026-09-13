const fs=require('node:fs'),crypto=require('node:crypto');
const original=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.hostname==='api.resend.com'){
  if(url.pathname!=='/emails'||init?.method!=='POST')throw new Error('Unexpected synthetic email request');
  const body=JSON.parse(init.body);
  if(typeof body.to!=='string'||!body.to.endsWith('@example.invalid'))throw new Error('Synthetic transport refuses non-test recipient');
  fs.appendFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/m9b-outbox-email-stub.jsonl',JSON.stringify({synthetic:true,bodyHash:crypto.createHash('sha256').update(init.body).digest('hex'),time:new Date().toISOString()})+'\n');
  return new Response(JSON.stringify({id:'synthetic-no-delivery'}),{status:200,headers:{'content-type':'application/json'}});
 }
 return original(input,init);
};
