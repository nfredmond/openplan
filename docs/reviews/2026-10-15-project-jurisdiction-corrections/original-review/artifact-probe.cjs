const fs=require('fs'), path=require('path'), cp=require('child_process'), {createRequire}=require('module');
const deps=createRequire('/home/nathaniel/code/openplan/openplan/package.json');
const ts=deps('typescript'); const head='53485a708512de34443e63ee38132a4f5991f36e'; const modules=new Map();
function source(name){return cp.execFileSync('git',['show',head+':'+name],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function load(name){
 if(modules.has(name))return modules.get(name).exports;
 const mod={exports:{}};modules.set(name,mod);
 const src=source(name);
 if(name.endsWith('.json')) {mod.exports=JSON.parse(src);return mod.exports;}
 const req=id=>{
  if(!id.startsWith('@/')&&!id.startsWith('.'))return deps(id);
  const base=id.startsWith('@/')?'openplan/src/'+id.slice(2):path.posix.join(path.posix.dirname(name),id);
  for(const suffix of ['', '.ts','.tsx','.json']) {
   const p=base+suffix;
   if(cp.spawnSync('git',['cat-file','-e',head+':'+p],{stdio:'ignore'}).status===0)return load(p);
  }
  throw Error('Missing source '+id+' from '+name);
 };
 const compiled=ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','exports','module','__dirname','__filename',compiled)(req,mod.exports,mod,path.dirname(name),name);
 return mod.exports;
}
const {buildProjectGeoPackage}=load('openplan/src/lib/projects/project-geopackage.ts');
const {buildProjectJurisdictionReadinessPayload}=load('openplan/src/lib/jurisdiction-readiness/payload.ts');
const context={version:1,state:'declared',recordedBy:'22222222-2222-4222-8222-222222222222',recordedAt:'2026-10-15T00:00:00.000Z',entries:[{label:'Review context',countryCode:'CA',subdivisionCode:'BC',kind:'province',reference:'agency:review',scope:'administrative',identity:'staff_declared'}]};
const project={id:'P',workspace_id:'W',name:'Review',summary:null,status:'active',plan_type:'corridor_plan',delivery_phase:'scoping',latitude:null,longitude:null,created_at:context.recordedAt,updated_at:context.recordedAt,place_source:'uploaded',place_label:'Original geometry',place_geometry_geojson:{type:'Polygon',coordinates:[[[-124.12345,40],[-123.12345,40],[-123.12345,41],[-124.12345,40]]]},jurisdiction_context:context};
const Database=deps('better-sqlite3');
const before=JSON.stringify(project); const first=buildProjectJurisdictionReadinessPayload(project,'a'.repeat(64));
const RealDate=global.Date; global.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2030-01-01T00:00:00.000Z']));} static now(){return new RealDate('2030-01-01').getTime();}};
const later=buildProjectJurisdictionReadinessPayload(project,'a'.repeat(64));global.Date=RealDate;
const built=buildProjectGeoPackage({project,corridors:[]});const legacy=buildProjectGeoPackage({project:{...project,jurisdiction_context:null},corridors:[]});
const db=new Database(built.bytes,{readonly:true}),old=new Database(legacy.bytes,{readonly:true});
const row=db.prepare('SELECT * FROM project_jurisdiction_context').get();
console.log(JSON.stringify({head,loadedGitModules:modules.size,hashStableAcrossTime:JSON.stringify(first)===JSON.stringify(later),payloadHash:first.payloadSha256,gpkgManifestColumns:db.prepare('PRAGMA table_info(project_jurisdiction_context)').all().map(x=>x.name),gpkgManifest:row,gpkgContainsPayloadHash:built.bytes.includes(Buffer.from(first.payloadSha256)),geometryUnchanged:db.prepare('SELECT geom FROM project_area').get().geom.equals(old.prepare('SELECT geom FROM project_area').get().geom),sourceObjectUnchanged:JSON.stringify(project)===before},null,2));db.close();old.close();
const recordSource=source('openplan/src/lib/project-evidence-bundles/generated-records.ts');
const fragment=recordSource.slice(recordSource.indexOf('const PERSONAL_IDENTIFIER_KEYS'),recordSource.indexOf('async function evidenceRows'));
const compiled=ts.transpileModule(fragment,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const scrub=new Function(compiled+'; return withoutPersonalIdentifiers;')();
console.log(JSON.stringify({sanitizedProjectContext:scrub({created_by:context.recordedBy,jurisdiction_context:context})},null,2));
