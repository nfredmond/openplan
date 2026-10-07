import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
const base='/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority';
const read=async(name:string)=>JSON.parse(await readFile(join(base,name),'utf8'));
const native=await read('report-export-native-private.json');
const history=await read('implementation-report-export-before-native-private.json');
const browser=await read('report-export-browser-summary.json');
const after=await read('implementation-report-export-after-native-private.json');
const unchanged=(v:typeof after)=>isDeepStrictEqual(v,history);
if(!unchanged(after))throw Error('Native report history changed during read-only acceptance');
const changedHistory=structuredClone(after);changedHistory.report.status='ALTERED';if(unchanged(changedHistory))throw Error('Changed native history escaped comparison');
const {hashFrozenRecord}=await import(join(process.cwd(),'src/lib/land-use-plans/versioning.ts'));
if(hashFrozenRecord(native.version.frozen_snapshot)!==native.version.content_hash)throw Error('Native adopted hash mismatch');
const outputs=[];
for(const file of browser.downloads){
 const bytes=await readFile(file);const data=JSON.parse(bytes.toString());
 const artifact=native.artifacts.find((a:{id:string})=>a.id===data.artifact.id);
 const report=native.reports.find((r:{id:string})=>r.id===data.report.id);
 if(!artifact||!report||artifact.report_id!==report.id)throw Error('Unknown report or artifact');
 const verifies=(v:typeof data)=>v.report.id===report.id&&v.report.workspace_id===report.workspace_id&&v.report.land_use_plan_id===report.land_use_plan_id&&v.report.report_type===report.report_type&&v.artifact.id===artifact.id&&isDeepStrictEqual(v.artifact.metadata_json,artifact.metadata_json);
 if(!verifies(data))throw Error('Download differs from native retained artifact');
 const harmless=structuredClone(data);harmless.artifact.metadata_json=Object.fromEntries(Object.entries(harmless.artifact.metadata_json).reverse());if(!verifies(harmless))throw Error('Object key order changed result');
 const broken=structuredClone(data);broken.artifact.metadata_json.contentHash='0'.repeat(64);if(verifies(broken))throw Error('Changed content hash escaped comparison');
 if(report.report_type==='land_use_plan_implementation_report'){
  const register=history.implementationReports[0];const m=data.artifact.metadata_json;
  if(m.contentHash!==register.content_hash||!isDeepStrictEqual(m.snapshot.actions,register.action_status_snapshot)||m.snapshot.adoptedVersionContentHash!==native.version.content_hash)throw Error('Implementation source differs from native register');
  if(m.snapshot.actions[0].status!=='not_started'||history.actions[0].status!=='in_progress')throw Error('Later status distinction lost');
  broken.artifact.metadata_json.contentHash=m.contentHash;broken.artifact.metadata_json.snapshot.actions[0].status='in_progress';if(verifies(broken))throw Error('Later status escaped comparison');
 }else{
  const m=data.artifact.metadata_json;const decision=native.decisions.find((d:{adoption_manifest_hash:string})=>d.adoption_manifest_hash===m.adoptionManifestHash);
  if(!decision||!isDeepStrictEqual(decision.adoption_manifest,m.adoptionManifest)||hashFrozenRecord(m.frozenSnapshot)!==native.version.content_hash||m.contentHash!==native.version.content_hash)throw Error('Adopted source differs from retained plan and decision');
  broken.artifact.metadata_json.contentHash=m.contentHash;broken.artifact.metadata_json.adoptionManifest.decision.body='ALTERED';if(verifies(broken))throw Error('Altered adoption decision escaped comparison');
 }
 outputs.push({reportId:report.id,artifactId:artifact.id,file:file.split('/').at(-1),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),nativeMetadataEqual:true,harmlessKeyOrder:true,changedHashAndContentRefused:true});
}
if(outputs.length!==2||new Set(outputs.map(v=>v.reportId)).size!==2)throw Error('Expected both distinct report downloads');
for(const [name,v] of Object.entries(browser.views) as Array<[string,{width:number;scrollWidth:number;text:string}]>){if(v.width!==v.scrollWidth)throw Error(name+' overflows');if(!v.text.includes(native.version.frozen_snapshot.plan.title))throw Error(name+' lacks retained plan title');}
await writeFile(join(base,'report-export-download-verification.json'),JSON.stringify({sourceCommit:browser.sourceCommit,outputs,nativeAdoptedCanonicalHashVerified:true,nativeHistoryUnchanged:true,changedHistoryRefused:true,views:Object.keys(browser.views),blindCategory:'Existing synthetic records and authenticated downloads only. Broken-record and historical-state refusals use controlled mocks, not mutated native acceptance records. No print/PDF or practitioner acceptance.'},null,2)+'\n');
console.log('Both downloads equal retained native artifacts; harmless and altered-content controls behave as expected.');
