import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
const base='/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority';
const read=async(name:string)=>JSON.parse(await readFile(join(base,name),'utf8'));
const {hashFrozenRecord}=await import(join(process.cwd(),'src/lib/land-use-plans/versioning.ts'));
const before=await read('implementation-report-before-status-change-native-private.json');
const native=await read('implementation-report-final-native-private.json');
const browser=await read('implementation-report-browser-summary.json');
const file='/home/nathaniel/.t3/userdata/browser-artifacts/browser-download-muyjcfkt-j-openplan-report-ad1a3d1e-925a-44da-a003-9b784689b29a-provenance.json';
const bytes=await readFile(file);const data=JSON.parse(bytes.toString());
if(native.readableReportCount!==1||native.implementationReports.length!==1||native.artifacts.length!==1)throw Error('Report creation count differs from one');
for(const field of ['report','versions','artifacts','implementationReports'])if(!isDeepStrictEqual(before[field],native[field]))throw Error('Saved '+field+' changes with current action update');
const registered=native.implementationReports[0];
const version=native.versions.find((v:{id:string})=>v.id===registered.adopted_version_id);
if(hashFrozenRecord(version.frozen_snapshot)!==version.content_hash)throw Error('Native adopted snapshot hash differs');
const saved=registered.action_status_snapshot[0];const current=native.actions[0];
if(saved.id!==current.id||saved.status!=='not_started'||current.status!=='in_progress'||saved.updated_at===current.updated_at)throw Error('Current action did not change independently');
const expectedSnapshot={planId:registered.plan_id,adoptedVersionId:registered.adopted_version_id,adoptedVersionContentHash:version.content_hash,reportingPeriodStart:registered.reporting_period_start,reportingPeriodEnd:registered.reporting_period_end,actions:registered.action_status_snapshot};
const verifies=(value:typeof data)=>value.report.id===native.report.id&&value.artifact.id===native.artifacts[0].id&&isDeepStrictEqual(value.artifact.metadata_json,native.artifacts[0].metadata_json)&&value.artifact.metadata_json.contentHash===registered.content_hash&&value.artifact.metadata_json.summary===registered.summary&&isDeepStrictEqual(value.artifact.metadata_json.snapshot,expectedSnapshot);
if(!verifies(data))throw Error('Downloaded report differs from native retained history');
const harmless=structuredClone(data);harmless.artifact.metadata_json=Object.fromEntries(Object.entries(harmless.artifact.metadata_json).reverse());if(!verifies(harmless))throw Error('Harmless key order changes comparison');
for(const field of ['status','responsible_party','updated_at']){const broken=structuredClone(data);broken.artifact.metadata_json.snapshot.actions[0][field]='ALTERED';if(verifies(broken))throw Error('Changed action '+field+' escapes comparison');}
for(const field of ['reportingPeriodStart','adoptedVersionContentHash']){const broken=structuredClone(data);broken.artifact.metadata_json.snapshot[field]='ALTERED';if(verifies(broken))throw Error('Changed '+field+' escapes comparison');}
const later=structuredClone(data);later.artifact.metadata_json.snapshot.actions[0].status=current.status;if(verifies(later))throw Error('Current status substitutes for saved status');
const displayVerifies=(text:string)=>[version.frozen_snapshot.plan.title,version.frozen_snapshot.plan.authorityLabel,version.frozen_snapshot.plan.geographyLabel,version.frozen_snapshot.planContext.place.label,registered.summary,registered.reporting_period_start+' through '+registered.reporting_period_end,'Status: not started',saved.responsible_party,saved.updated_at,version.content_hash].every(v=>text.includes(v))&&!text.includes('Status: in progress')&&!text.includes(current.updated_at);
for(const size of ['desktop','mobile']){const view=browser[size];if(view.width!==view.scrollWidth||!displayVerifies(view.text))throw Error('Rendered '+size+' differs from native retained history');if(displayVerifies(view.text.replace('Status: not started','Status: in progress')))throw Error('Changed displayed status escapes comparison');if(displayVerifies(view.text.replace(saved.updated_at,current.updated_at)))throw Error('Changed displayed update time escapes comparison');}
if(browser.formMobile.width!==390||browser.formMobile.scrollWidth!==390)throw Error('Form overflows at 390px');
const requests=browser.requests.requests;
if(requests.length!==2||requests[0].responseStatus!==201||requests[1].responseStatus!==200)throw Error('Expected one creation and one status request');
await writeFile(join(base,'implementation-report-download-verification.json'),JSON.stringify({observedAt:new Date().toISOString(),sourceCommit:'d3815893b2bbf6f2c2803e16b05cab7e81ab5f7f',file:file.split('/').at(-1),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),reportId:native.report.id,artifactId:data.artifact.id,implementationReportId:registered.id,implementationContentHash:registered.content_hash,adoptedContentHash:version.content_hash,reportCount:1,savedHistoryUnchanged:true,currentStatus:current.status,savedStatus:saved.status,nativeArtifactEqual:true,adoptedCanonicalHashVerified:true,legacyImplementationHashBoundary:'Matches native append-only register and complete snapshot. Historical insertion-order hash is not recomputed from jsonb.',harmlessObjectOrder:true,changedSnapshotFieldsRefused:5,currentStatusSubstitutionRefused:true,displayMatchesNative:true,changedDisplayStatusAndTimeRefused:true,form390NoOverflow:true,browserRequests:[201,200],blindCategory:'One synthetic report and later status update. No interrupted creation, atomic multi-row producer, cross-workspace browser case, historical native edition, date-picker keyboard interaction, print/PDF or practitioner acceptance.'},null,2)+'\n');
console.log('Download and both rendered widths match retained native history after a later status update; controls pass.');
