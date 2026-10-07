import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const directory='/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority';
const {hashFrozenRecord}=await import(join(process.cwd(),'src/lib/land-use-plans/versioning.ts'));
const read=async(name:string)=>JSON.parse(await readFile(join(directory,name),'utf8'));
const native=await read('frozen-browser-before-private.json');
const adopted=await read('public-context-adopted-native-private.json');
const browser=await read('public-context-after-private.json');
const result=[];
for(const [kind,name,row] of [
 ['review','browser-download-muyf40qk-c-openplan-review-v1.json',native.versions.find((v:{version_number:number})=>v.version_number===1)],
 ['adopted','browser-download-muyf6ubn-d-openplan-adopted-v1.json',adopted],
] as const){
 const bytes=await readFile('/home/nathaniel/.t3/userdata/browser-artifacts/'+name);
 const packet=JSON.parse(bytes.toString());
 const matches=(p:typeof packet)=>p.version.id===row.id && p.version.contentHash===row.content_hash
   && isDeepStrictEqual(p.content,row.frozen_snapshot) && hashFrozenRecord(p.content)===row.content_hash;
 if(!matches(packet)||!isDeepStrictEqual(packet,browser[kind].packet)||browser[kind].publicStatus!==200)throw Error('Download/native/anonymous read mismatch');
 const harmless={...packet,content:Object.fromEntries(Object.entries(packet.content).reverse())};
 if(!matches(harmless))throw Error('Object key order incorrectly affects verification');
 const fault=structuredClone(packet);fault.content.plan.title+=' CHANGED';
 if(matches(fault))throw Error('Changed frozen title escaped verification');
 result.push({kind,file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),versionId:row.id,contentHash:row.content_hash,nativeContentEqual:true,canonicalHashVerified:true,anonymousResponseEqual:true,harmlessKeyOrder:true,changedTitleRefused:true});
}
await writeFile(join(directory,'public-context-download-verification.json'),JSON.stringify({observedAt:new Date().toISOString(),downloads:result,blindCategory:'Recorded downloads and read-only native snapshots. No new producer, adoption, publication or permission write.'},null,2)+'\n');
console.log('Two downloaded files match native frozen content and anonymous responses; canonical hashes and controls pass.');
