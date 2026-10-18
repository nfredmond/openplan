// Independent read-only candidate loader. Leaf UI and database transports are explicit stubs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const base=__dirname+'/candidate', deps=createRequire('/home/nathaniel/code/openplan/openplan/package.json'),ts=deps('typescript');
const mode=process.argv[2]||'baseline',mods=new Map(),bindings={};
function load(name){
 if(mods.has(name))return mods.get(name).exports;
 let source=fs.readFileSync(base+'/'+name,'utf8');bindings[name]=crypto.createHash('sha256').update(source).digest('hex');
 if(mode==='harmless'&&!name.endsWith('.json'))source='// Independent harmless control.\n'+source;
 if(name.endsWith('project-jurisdiction-editor.tsx')&&mode.startsWith('epoch:')){const field=mode.split(':')[1];source=source.replace('previous.'+field+' !== '+field,'false');}
 if(name.endsWith('project-jurisdiction-editor.tsx')&&mode==='restart')source=source.replace('setDraft(jurisdictionDraft(saved)); setDraftScope','setDraftScope');
 if(name.endsWith('project-jurisdiction-editor.tsx')&&mode==='inflight')source=source.replace('const scopeStillCurrent = () => currentScope.current.epoch === requestScope.epoch && currentScope.current.canWrite;','const scopeStillCurrent = () => true;');
 if(name.endsWith('project-jurisdiction-editor.tsx')&&mode==='error')source=source.replace('        if (!scopeStillCurrent()) { setError("The save response belongs to an earlier scope. Keep the original draft for comparison."); return; }','');
 if(name.endsWith('jurisdiction-readiness/payload.ts')&&mode==='actor')source=source.replace('state: internal.context.state,','recordedBy: internal.context.recordedBy, state: internal.context.state,');
 if(name.endsWith('jurisdiction-readiness/payload.ts')&&mode==='hash')source=source.replace('entries: internal.entries,','entries: internal.entries, generatedAt: new Date().toISOString(),');
 if(name.endsWith('projects/project-jurisdiction.ts')&&mode==='parser')source=source.replace('recordedBy: z.string().uuid(),','recordedBy: z.string().uuid().optional(),');
 if(name.endsWith('projects/project-jurisdiction.ts')&&mode==='null')source=source.replace('if (row.jurisdiction_context === null) return null;','if (row.jurisdiction_context === null) return {version:1,state:"unresolved",entries:[],recordedBy:"33333333-3333-4333-8333-333333333333",recordedAt:"2026-10-15T00:00:00.000Z"};');
 if(name.endsWith('jurisdiction-readiness/payload.ts')&&mode==='sovereign')source=source.replace('const resolved = declaration.identity === "server_resolved" && administrative;','const resolved = true;');
 if(name.endsWith('project-evidence-bundles/generated-records.ts')&&mode==='adapter')source=source.replace('"user_id", "userId", "recorded_by", "recordedBy",','"user_id", "userId",');
 if(name.endsWith('jurisdiction-readiness/route.ts')&&mode==='auth')source=source.replace('if (!user) return NextResponse.json','if (false) return NextResponse.json');
 if(name.endsWith('jurisdiction-readiness/route.ts')&&mode==='api')source=source.replace('(download ? buildProjectJurisdictionReadinessExportPayload : buildProjectJurisdictionReadinessPayload)','(download ? buildProjectJurisdictionReadinessPayload : buildProjectJurisdictionReadinessPayload)');
 if(name.endsWith('jurisdiction-readiness/payload.ts')&&mode==='hashbytes')source=source.replace('entries: internal.entries,\n  };\n  return { ...payload, payloadSha256: createHash("sha256").update(canonicalizeActionPayload(payload))','entries: internal.entries,\n  };\n  return { ...payload, payloadSha256: createHash("sha256").update("wrong bytes")');
 if(name.endsWith('lib/reports/html.ts')&&mode==='report')source=source.replace('payload.schema === "openplan.project-jurisdiction-readiness-export.v3") {','payload.schema === "openplan.project-jurisdiction-readiness-export.v3") { return "";');
 if(name.endsWith('projects/project-geopackage.ts')&&mode==='gpkg')source=source.replace('readiness?.payloadSha256 ?? null);','"broken-hash");');
 const mod={exports:{}};mods.set(name,mod);
 if(name.endsWith('.json')){mod.exports=JSON.parse(source);return mod.exports;}
 const req=id=>{
  if(id==='server-only')return {};
  if(id==='next/navigation')return {useRouter:()=>({refresh:()=>{refreshes++;}})};
  if(id==='@/components/models/study-area-picker')return {StudyAreaPicker:props=>deps('react').createElement('button',{onClick:()=>props.onPlaceResolved({kind:'county',geoid:'06045',label:'Source search'})},'Pick source')};
  if(id==='@/components/ui/button')return {Button:props=>deps('react').createElement('button',props,props.children)};
  if(id==='@/components/ui/input')return {Input:props=>deps('react').createElement('input',props)};
  if(id==='@/lib/project-evidence-bundles/engagement-export-privacy')return {loadPublishableProjectEngagementGeometry:async()=>({data:[],error:null})};
  if(id==='@/lib/supabase/server')return {createClient:async()=>apiClient};
  if(id==='@/lib/observability/audit')return {createApiAuditLogger:()=>({info(){},error(){}})};
  if(!id.startsWith('@/')&&!id.startsWith('.'))return deps(id);
  const root=id.startsWith('@/')?'openplan/src/'+id.slice(2):path.posix.join(path.posix.dirname(name),id);
  const found=['','.ts','.tsx','.json','/index.ts'].map(s=>root+s).find(n=>fs.existsSync(base+'/'+n)&&fs.statSync(base+'/'+n).isFile());
  if(!found)throw Error('Missing '+id+' from '+name);
  return load(found);
 };
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','exports','module','__dirname','__filename',compiled)(req,mod.exports,mod,path.dirname(base+'/'+name),base+'/'+name);
 return mod.exports;
}
let refreshes=0,apiClient;
const checked=[];function check(label,fn){fn();checked.push(label);}
async function editor(){
 const {JSDOM}=deps('jsdom'),dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
 for(const k of ['window','document','HTMLElement','HTMLFieldSetElement','MutationObserver','Node'])global[k]=dom.window[k];
 Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=deps('react'),{render,fireEvent,screen,cleanup,act}=deps('@testing-library/react');
 const Editor=load('openplan/src/components/projects/project-jurisdiction-editor.tsx').ProjectJurisdictionEditor;
 const props={projectId:'review-project',userId:'actor-A',workspaceId:'workspace-A',revision:'revision-A',context:null,canWrite:true};
 const element=p=>React.createElement(Editor,p),click=name=>fireEvent.click(screen.getByRole('button',{name}));
 function start(){const view=render(element(props));click('Edit jurisdiction context');click('Pick source');return view;}
 for(const [field,value] of [['userId','actor-B'],['workspaceId','workspace-B'],['projectId','review-project-B'],['revision','revision-B'],['canWrite',false],['canWrite',undefined]]){
  let calls=[];global.fetch=async(...args)=>{calls.push(args);return new Response('{}');};refreshes=0;
  const view=start();view.rerender(element({...props,[field]:value}));view.rerender(element(props));
  click('Save jurisdiction context');await act(async()=>{});
  check('scope round trip refuses '+field+'='+value,()=>{assert.equal(calls.length,0,'original intent must not submit after committed scope round trip');assert.equal(refreshes,0);assert.ok(screen.getByText(/county 06045/));});
  click('Compare saved context and restart');assert.equal(Boolean(screen.queryByText(/county 06045/)),false,'restart clears original draft');
  click('Pick source');click('Save jurisdiction context');await act(async()=>{});
  check('explicit restart '+field+'='+value,()=>{assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/projects/review-project');assert.equal(calls[0][1].headers['x-openplan-expected-user'],'actor-A');assert.equal(refreshes,1);});cleanup();
 }
 let resolveResponse;global.fetch=()=>new Promise(r=>resolveResponse=r);refreshes=0;let view=start();click('Save jurisdiction context');view.rerender(element({...props,userId:'actor-B'}));view.rerender(element(props));await act(async()=>resolveResponse(new Response('{}')));
 check('inflight response after account round trip',()=>{assert.equal(refreshes,0);assert.ok(screen.getByText(/save response belongs to an earlier scope/));assert.ok(screen.getByText(/county 06045/));});cleanup();
 let resolveBody;global.fetch=async()=>({ok:false,json:()=>new Promise(r=>resolveBody=r)});view=start();click('Save jurisdiction context');await act(async()=>{});view.rerender(element({...props,workspaceId:'workspace-B'}));await act(async()=>resolveBody({error:'ERROR-PRIOR-SCOPE'}));
 check('deferred error parsing scope',()=>{assert.equal(Boolean(screen.queryByText('ERROR-PRIOR-SCOPE')),false,'prior-scope error must remain hidden');assert.ok(screen.getByText(/save response belongs to an earlier scope/));});cleanup();
 dom.window.close();
}
async function artifacts(){
 const {buildProjectGeoPackage}=load('openplan/src/lib/projects/project-geopackage.ts'),{buildProjectJurisdictionReadinessPayload:internal,buildProjectJurisdictionReadinessExportPayload:external}=load('openplan/src/lib/jurisdiction-readiness/payload.ts');
 const {jurisdictionReadinessRegistrySha256}=load('openplan/src/lib/jurisdiction-readiness/custody.ts'),{canonicalizeActionPayload:canonical}=load('openplan/src/lib/runtime/action-metadata.ts');
 const {loadProjectEvidenceGeneratedFiles}=load('openplan/src/lib/project-evidence-bundles/generated-records.ts');
 const {buildJurisdictionReadinessEvidenceFile}=load('openplan/src/lib/jurisdiction-readiness/evidence-bundle.ts');
 const actor='33333333-3333-4333-8333-333333333333';
 const descriptors=[{label:'Sovereign <context>',kind:'nation',reference:'nation:source',countryCode:'US',subdivisionCode:'CA',scope:'sovereign',identity:'staff_declared'},{label:'Cross-border context',kind:'regional-body',reference:'region:source',countryCode:null,subdivisionCode:null,scope:'overlap',identity:'staff_declared'},{label:'International context',kind:'province',reference:'source:province',countryCode:'CA',subdivisionCode:'BC',scope:'administrative',identity:'staff_declared'},{label:'Resolved administrative',kind:'tigerweb:county',reference:'tigerweb:county:06045',countryCode:'US',subdivisionCode:'CA',scope:'administrative',identity:'server_resolved'}];
 const context={version:1,state:'declared',recordedBy:actor,recordedAt:'2026-10-15T00:00:00.000Z',entries:descriptors};
 const project={id:'review-project',workspace_id:'review-workspace',name:'Review',summary:null,status:'active',plan_type:'corridor_plan',delivery_phase:'planning',latitude:null,longitude:null,created_at:context.recordedAt,updated_at:'2026-10-15T01:00:00.000Z',place_source:'uploaded',place_label:'Original uploaded geometry',place_geometry_geojson:{type:'Polygon',coordinates:[[[-124.12345,40],[-123.12345,40],[-123.12345,41],[-124.12345,40]]]},jurisdiction_context:context,metadata_json:{recordedBy:actor,recorded_by:actor,citation:'Retain source attribution'}};
 const registry=jurisdictionReadinessRegistrySha256(),before=JSON.stringify(project),payload=external(project,registry);
 check('minimized external actor with internal custody',()=>{assert.equal(internal(project,registry).context.recordedBy,actor);assert.ok(!JSON.stringify(payload).includes(actor),'external actor identifier must be omitted');assert.deepEqual(payload.context.entries,descriptors);});
 check('strict storage parse before external conversion',()=>{const bad=structuredClone(project);delete bad.jurisdiction_context.recordedBy;assert.throws(()=>external(bad,registry),/invalid/,'missing actor must not pass export parser');assert.throws(()=>external({...project,jurisdiction_context:{...context,unexpected:'ignored?'}},registry),/invalid/);});
 check('external canonical material hashed after minimization',()=>{const {payloadSha256,...material}=payload;assert.equal(payloadSha256,crypto.createHash('sha256').update(canonical(material)).digest('hex'));assert.notEqual(payloadSha256,internal(project,registry).payloadSha256);assert.notEqual(external({...project,updated_at:'another-revision'},registry).payloadSha256,payloadSha256);assert.notEqual(external(project,'b'.repeat(64)).payloadSha256,payloadSha256);});
 check('null unresolved invalid missing remain distinct',()=>{assert.equal(external({...project,jurisdiction_context:null},registry).contextSource,'legacy_study_place');assert.deepEqual(external({...project,jurisdiction_context:{...context,state:'unresolved',entries:[]}},registry).entries,[]);assert.throws(()=>external({...project,jurisdiction_context:{}},registry),/invalid/);const missing={...project};delete missing.jurisdiction_context;assert.throws(()=>external(missing,registry),/not read/);});
 check('sovereign overlap and global support not inherited',()=>{for(const i of [0,1,2])assert.ok(payload.entries[i].assessment.reports.every(r=>r.status==='unassessed'));assert.equal(payload.entries[0].administrativeGuidance,null);assert.equal(payload.entries[1].administrativeGuidance,null);assert.ok(payload.entries[2].administrativeGuidance);assert.match(payload.entries[3].assessmentScope,/state-level/);});
 const Database=deps('better-sqlite3'),one=buildProjectGeoPackage({project,corridors:[],generatedAt:new Date('2028-01-01')}),legacy=buildProjectGeoPackage({project:{...project,jurisdiction_context:null},corridors:[]});
 const columns=[];const client={from(table){const q={select(c){columns.push([table,c]);return q;},eq(){return q;},in(){return q;},order(){return q;},range(){return q;},async maybeSingle(){return {data:project,error:null};},then(r){return Promise.resolve(r({data:[],error:null}));}};return q;}};
 const RealDate=global.Date;let bundle,later;
 try{global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2031-02-03T04:05:06.000Z']));}static now(){return new RealDate('2031-02-03T04:05:06.000Z').getTime();}};bundle=await loadProjectEvidenceGeneratedFiles(client,project,new Date());later=external(project,registry);}finally{global.Date=RealDate;}
 check('canonical hash and material stable across clocks',()=>assert.deepEqual(later,payload,'generation clock must not enter canonical material'));
 check('complete generated adapter minimizes identifiers',()=>{assert.ok(!JSON.stringify(bundle.projectRecord).includes(actor));assert.deepEqual(bundle.projectRecord.metadata_json,{citation:'Retain source attribution'});assert.deepEqual(bundle.projectRecord.jurisdiction_context,payload.context);assert.ok(columns.some(([table,c])=>table==='projects'&&c==='*'));});
 check('bundle and separate JSON parity',()=>{assert.deepEqual(JSON.parse(bundle.files.find(f=>f.path==='project/jurisdiction-readiness.json').bytes),payload);assert.deepEqual(JSON.parse(buildJurisdictionReadinessEvidenceFile(project,registry).bytes),payload);});
 const legacyDb=new Database(legacy.bytes,{readonly:true});
 for(const [label,bytes] of [['standalone',one.bytes],['bundle',bundle.files.find(f=>f.path==='project/project.gpkg').bytes]]){const db=new Database(bytes,{readonly:true});try{check(label+' GeoPackage canonical parity and source geometry',()=>{const row=db.prepare('SELECT * FROM project_jurisdiction_context').get();assert.equal(row.payload_sha256,payload.payloadSha256,'GeoPackage must retain canonical readiness hash');assert.equal(row.readiness_payload_json,canonical(payload));assert.equal(row.registry_sha256,registry);assert.equal(row.registry_version,payload.registryVersion);assert.equal(row.readiness_schema,payload.schema);assert.deepEqual(JSON.parse(row.jurisdiction_context_json),payload.context);assert.ok(!bytes.includes(Buffer.from(actor)));assert.deepEqual(db.prepare('SELECT * FROM project_area').get(),legacyDb.prepare('SELECT * FROM project_area').get());});}finally{db.close();}}legacyDb.close();
 const {buildReportHtml}=load('openplan/src/lib/reports/html.ts'),{buildProjectStageGateSnapshot,buildProjectStageGateSummary}=load('openplan/src/lib/stage-gates/summary.ts');
 const reportData={deliverables:[],risks:[],issues:[],decisions:[],meetings:[],engagement:null,scenarioSetLinks:[],projectFundingSnapshot:null,modelingEvidence:[],projectRecordsSnapshot:Object.fromEntries(['deliverables','risks','issues','decisions','meetings'].map(k=>[k,{count:0,latestTitle:null,latestAt:null}])),stageGateSnapshot:buildProjectStageGateSnapshot(buildProjectStageGateSummary([],{templateId:'ca_stage_gates_v0_1'})),report:{id:'report',title:'Review',summary:null,report_type:'board_packet',created_at:project.created_at},workspace:{id:project.workspace_id,name:'Workspace'},project,runs:[],sections:[{id:'section',section_key:'project_overview',title:'Overview',enabled:true,sort_order:0,config_json:{}}],jurisdictionReadiness:payload};
 const html=buildReportHtml(reportData);
 check('report external hash attribution and escaped source labels',()=>{assert.ok(html.includes(payload.payloadSha256),'report must render canonical hash');assert.ok(html.includes(payload.schema));assert.ok(html.includes(payload.registrySha256));assert.ok(html.includes(context.recordedAt));assert.ok(!html.includes(actor));assert.ok(html.includes('Sovereign &lt;context&gt;'));});
 check('original input object unchanged',()=>assert.equal(JSON.stringify(project),before));
 const {GET}=load('openplan/src/app/api/projects/[projectId]/jurisdiction-readiness/route.ts');
 function authClient(user,data,error=null){return {auth:{getUser:async()=>({data:{user}})},from(){const q={select(c){assert.equal(c,'id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code');return q;},eq(){return q;},async maybeSingle(){return {data,error};}};return q;}};}
 apiClient=authClient(null,project);assert.equal((await GET(new Request('http://localhost/read?download=1'),{params:Promise.resolve({projectId:project.id})})).status,401);checked.push('download requires authenticated caller');
 apiClient=authClient({id:'reader'},project);const normal=await GET(new Request('http://localhost/read'),{params:Promise.resolve({projectId:project.id})}),download=await GET(new Request('http://localhost/read?download=1'),{params:Promise.resolve({projectId:project.id})});
 check('API ordinary custody and external download contracts',()=>{assert.equal(download.headers.get('Cache-Control'),'private, no-store');assert.match(download.headers.get('content-disposition'),/attachment/);});assert.equal((await normal.json()).context.recordedBy,actor);assert.deepEqual(await download.json(),payload);
 apiClient=authClient({id:'reader'},null);assert.equal((await GET(new Request('http://localhost/read?download=1'),{params:Promise.resolve({projectId:project.id})})).status,404);checked.push('invisible project refuses download');
 apiClient=authClient({id:'reader'},{...project,jurisdiction_context:{}});assert.equal((await GET(new Request('http://localhost/read?download=1'),{params:Promise.resolve({projectId:project.id})})).status,500);checked.push('invalid project refuses download');
}
(async()=>{try{if(['baseline','harmless','restart','inflight','error'].includes(mode)||mode.startsWith('epoch:'))await editor();if(!['restart','inflight','error'].includes(mode)&&!mode.startsWith('epoch:'))await artifacts();console.log(JSON.stringify({mode,result:'SURVIVED',checked,bindings},null,2));}catch(e){console.error(JSON.stringify({mode,result:e.name,diagnostic:e.message,checked},null,2));process.exitCode=1;}})();
