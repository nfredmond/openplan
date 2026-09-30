const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const app='/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13/openplan';
const JSZip=require(app+'/node_modules/jszip'),XLSX=require(app+'/node_modules/xlsx');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const file=process.argv[2],run=JSON.parse(fs.readFileSync(file)),checks=[];
(async()=>{if(!process.env.ALLOW_PARTIAL)assert(run.completed);for(const job of run.jobs){const files=run.downloads.filter(x=>x.label===job.label),zip=await JSZip.loadAsync(fs.readFileSync(files.find(x=>x.format==='zip').path));const raw=await zip.file('snapshot.json').async('string'),snapshot=JSON.parse(raw),manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(sha(raw),job.snapshot_sha256);assert.equal(manifest.snapshotSha256,job.snapshot_sha256);for(const f of manifest.files){const bytes=await zip.file(f.name).async('nodebuffer');assert.equal(sha(bytes),f.checksum);assert.equal(bytes.length,f.byteLength);}
const book=XLSX.readFile(files.find(x=>x.format==='xlsx').path),rows=name=>XLSX.utils.sheet_to_json(book.Sheets[name]||{}, {defval:''});
for(const name of book.SheetNames)for(const [key,value]of Object.entries(book.Sheets[name]))if(!key.startsWith('!')){assert.notEqual(value.t,'e',`${name}/${key} error cell`);if(name!=='Summary')assert(!value.f,`${name}/${key} unexpected formula`);}
const pdf=files.find(x=>x.format==='pdf').path,pdfText=cp.execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});fs.writeFileSync(pdf+'.txt',pdfText);let eventCount=0,memberCount=0;
if(job.scope==='internal'){
 assert.equal(snapshot.items.length,0,'date-filtered participation must be empty');assert(snapshot.decisionLinks.length>0);const original=snapshot.decisionLinks.find(x=>x.id===run.original.id);assert(original);assert.equal(original.context_text,run.original.context_text);
 const actions=rows('Synthesis actions'),members=rows('Synthesis sources'),long=rows('Long text');
 const value=(row,field,id,type)=>{const pieces=long.filter(x=>x['Record ID']===id&&x.Field===field&&x['Record type']===type);return pieces.length?pieces.sort((a,b)=>a.Part-b.Part).map(x=>x.Text).join(''):row[field];};
 for(const action of snapshot.decisionLinks){const context=JSON.parse(action.context_text);if(context.schema!==2)continue;const captured=context.synthesisHistory.histories.flatMap(h=>h.entries);eventCount+=captured.length;
 for(const [index,event]of captured.entries()){assert.equal(sha(event.eventText),event.eventSha256);const record=actions.find(x=>x.decision_action_id===action.id&&x.event_sha256===event.eventSha256);assert(record,'event register must include each captured event');const restored=value(record,'exact_event_text',`${action.id}/${actions.indexOf(record)+1}`,'Synthesis actions');
 // The exporter uses an index across all flattened rows, including preceding decisions.
 assert.equal(restored,event.eventText);const e=JSON.parse(event.eventText),r=JSON.parse(e.context.contextText),review=JSON.parse(r.revision.contentText),group=review.groups.find(x=>x.id===e.intent.groupId);memberCount+=group.sourceIds.length;
 const registered=members.filter(x=>x.decision_action_id===action.id&&x.response_link_id===e.intent.requestId);assert.equal(registered.length,group.sourceIds.length);
 }
 }
 assert.equal(actions.length,eventCount);assert.equal(members.length,memberCount);assert(pdfText.includes(run.decisionTitle));assert(pdfText.includes('Retained synthesis source appendix'));assert(pdfText.includes('Response-link action 3: withdraw'));
}else{assert(!('decisionLinks'in snapshot));assert(!book.SheetNames.some(x=>x.startsWith('Synthesis')));assert(!pdfText.includes(run.decisionTitle));assert(!pdfText.includes('SYNTHETIC checked exact source wording for linkage'));for(const [name,entry]of Object.entries(zip.files)){assert(!name.includes('synthesis'));if(/\.(json|csv|html)$/.test(name)){const text=await entry.async('string');assert(!text.includes(run.decisionTitle));assert(!text.includes('SYNTHETIC checked exact source wording for linkage'));}}}
checks.push({label:job.label,manifestFiles:manifest.files.length,snapshotSha256:sha(raw),sheets:book.SheetNames,eventCount,memberCount,pdfTextBytes:pdfText.length});
}if(run.completed)for(const old of run.downloads.filter(x=>x.label==='original'))assert.equal(old.checksum,run.downloads.find(x=>x.label==='original-after-correction'&&x.format===old.format).checksum);fs.writeFileSync(file.replace('.json','-artifact-checks.json'),JSON.stringify({completed:true,checks},null,2));console.log(JSON.stringify(checks));})().catch(e=>{console.error(e.stack);process.exitCode=1});
