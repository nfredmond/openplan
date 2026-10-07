import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const directory='/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority';
const {hashFrozenRecord}=await import(join(process.cwd(),'src/lib/land-use-plans/versioning.ts'));
const read=async(name:string)=>JSON.parse(await readFile(join(directory,name),'utf8'));
const native=await read('public-content-native-private.json');

const browser=await read('public-content-browser-private.json');
const result=[];
for(const [kind,name,row] of [['review','browser-download-muyfyu1t-e-openplan-review-v1.json',native]] as const){
 const bytes=await readFile('/home/nathaniel/.t3/userdata/browser-artifacts/'+name);
 const packet=JSON.parse(bytes.toString());
 const matches=(p:typeof packet)=>p.version.id===row.id && p.version.contentHash===row.content_hash
   && isDeepStrictEqual(p.content,row.frozen_snapshot) && hashFrozenRecord(p.content)===row.content_hash;
 if(!matches(packet)||!isDeepStrictEqual(packet,browser.read.packet))throw Error('Download/native/anonymous read mismatch');
 const harmless={...packet,content:Object.fromEntries(Object.entries(packet.content).reverse())};
 if(!matches(harmless))throw Error('Object key order incorrectly affects verification');
 const fault=structuredClone(packet);fault.content.plan.title+=' CHANGED';
 if(matches(fault))throw Error('Changed frozen title escaped verification');
 result.push({kind,file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),versionId:row.id,contentHash:row.content_hash,nativeContentEqual:true,canonicalHashVerified:true,anonymousResponseEqual:true,harmlessKeyOrder:true,changedTitleRefused:true});
}
await writeFile(join(directory,'public-content-download-verification.json'),JSON.stringify({observedAt:new Date().toISOString(),downloads:result,blindCategory:'Recorded downloads and read-only native snapshots. No new producer, adoption, publication or permission write.'},null,2)+'\n');
console.log('Downloaded file match native frozen content and anonymous responses; canonical hashes and controls pass.');
