import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
const base='/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority';
const {hashFrozenRecord}=await import(join(process.cwd(),'src/lib/land-use-plans/versioning.ts'));
const native=JSON.parse(await readFile(join(base,'report-map-native-private.json'),'utf8'));
const file='/home/nathaniel/.t3/userdata/browser-artifacts/browser-download-muyismau-i-openplan-report-e0aab60e-a9ff-4d51-a98e-4f01e99ceb45-provenance.json';
const bytes=await readFile(file);const data=JSON.parse(bytes.toString());const metadata=data.artifact.metadata_json;
const version=native.versions.find((v:{version_number:number})=>v.version_number===2);
const verifies=(value:typeof data)=>value.report.id===native.report.id&&value.report.land_use_plan_id===version.plan_id&&value.artifact.id===native.artifacts[0].id&&isDeepStrictEqual(value.artifact.metadata_json,native.artifacts[0].metadata_json)&&hashFrozenRecord(value.artifact.metadata_json.frozenSnapshot)===version.content_hash;
if(!verifies(data))throw Error('Report download disagrees with native version and artifact');
const harmless={...data,artifact:{...data.artifact,metadata_json:Object.fromEntries(Object.entries(metadata).reverse())}};if(!verifies(harmless))throw Error('Harmless object order affects verification');
const broken=structuredClone(data);broken.artifact.metadata_json.frozenSnapshot.planContext.place.label+=' ALTERED';if(verifies(broken))throw Error('Changed retained area escapes verification');
const changedDecision=structuredClone(data);changedDecision.artifact.metadata_json.adoptionManifest.decision.body+=' ALTERED';if(verifies(changedDecision))throw Error('Changed decision escapes comparison');
const changedRelationship=structuredClone(data);changedRelationship.artifact.metadata_json.frozenSnapshot.relationships.push({related_plan_label:'ALTERED'});if(verifies(changedRelationship))throw Error('Changed relationships escape comparison');
const browser=JSON.parse(await readFile(join(base,'report-map-browser-summary.json'),'utf8'));
const response=browser.api.results.find((r:{name:string})=>r.name==='retained-empty');
const designation=metadata.frozenSnapshot.designations[0];
const mapVerifies=(r:typeof response)=>r.status===200&&r.cacheControl==='private, no-store'&&r.body.reportId===native.report.id&&r.body.versionId===version.id&&r.body.contentHash===version.content_hash&&r.body.designationLabel===designation.designation_set_label&&r.body.matchedCount===native.gisVersion.feature_count&&r.body.returnedCount===0&&r.body.features.length===0&&!r.body.tooDenseToDraw;
if(!mapVerifies(response))throw Error('Map response differs from native retained edition');
for(const field of ['reportId','versionId','contentHash','designationLabel','matchedCount']) {const broken=structuredClone(response);broken.body[field]=field==='matchedCount'?1:'ALTERED';if(mapVerifies(broken))throw Error('Changed map '+field+' escapes comparison');}
const displayVerifies=(text:string)=>text.includes(designation.designation_set_label)&&text.includes(designation.map_note)&&text.includes(native.gisVersion.feature_hash)&&text.includes('no public Mapbox token');
for(const size of ['desktop','mobile']){const view=browser[size];if(view.width!==view.scrollWidth||!displayVerifies(view.text))throw Error('Map disclosure differs from retained source at '+size);if(displayVerifies(view.text.replace(native.gisVersion.feature_hash,'ALTERED')))throw Error('Wrong displayed GIS hash escapes comparison');}
for(const [name,status] of [['anonymous',401],['unknown-designation',404],['invalid-bbox',400]])if(browser.api.results.find((r:{name:string})=>r.name===name)?.status!==status)throw Error('Unexpected '+name+' result');
await writeFile(join(base,'report-map-download-verification.json'),JSON.stringify({observedAt:new Date().toISOString(),sourceCommit:'416def7b9b5ec67eadcbeab895ee8056bded5f5c',file:file.split('/').at(-1),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),reportId:native.report.id,artifactId:data.artifact.id,contentHash:version.content_hash,nativeArtifactEqual:true,canonicalHashVerified:true,harmlessObjectOrder:true,changedAreaRefused:true,changedDecisionRefused:true,changedRelationshipRefused:true,mapMatchesNative:true,changedMapFieldsRefused:5,displayMatchesNative:true,changedDisplayRefused:true,anonymous401:true,unknownDesignation404:true,invalidBbox400:true,blindCategory:'Synthetic empty map and provider-unavailable display. No actual WebGL, nonempty geography, native foreign-workspace case, historical edition, print/PDF or practitioner acceptance.'},null,2)+'\n');console.log('Report download, map response and visible source match native records; harmless and targeted fault controls pass.');
