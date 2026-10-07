const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const appRequire=createRequire(path.resolve('openplan/package.json'));
const ts=appRequire('typescript');
const {StorageClient}=appRequire('@supabase/storage-js');
const source=fs.readFileSync('openplan/src/lib/models/artifact-source.ts','utf8');
function load(text){ const out=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const mod={exports:{}};new Function('require','module','exports',out)(name=>name==='@/lib/supabase/server'?{}:require(name),mod,mod.exports);return mod.exports;}
const scope={bucket:'run-artifacts',objectPathPrefix:'model-runs/11111111-1111-4111-8111-111111111111/'};
const probes=[['safe',scope.objectPathPrefix+'safe.json',true],['literal traversal',scope.objectPathPrefix+'../../../kb-documents/foreign/file.pdf',false],['encoded traversal',scope.objectPathPrefix+'%2e%2e/%2e%2e/%2e%2e/kb-documents/foreign/file.pdf',false]];
function check(api){return probes.map(([name,objectPath,expected])=>({name,expected,actual:api.storageRefAllowed({bucket:scope.bucket,objectPath},scope)}));}
(async()=>{
 const baseline=check(load(source));const noOp=check(load('// harmless review control\n'+source));
 const candidate=source.replace('!ref.objectPath.includes("..")','!ref.objectPath.includes("..") && !ref.objectPath.includes("%")');
 const corrected=check(load(candidate));
 const result={baseline,noOp,isolatedCandidate:corrected};
 const captured=[];
 const storage=new StorageClient('https://synthetic.invalid/storage/v1',{Authorization:'Bearer synthetic-not-a-secret'},async(input,init)=>{const request=new Request(input,init);captured.push({method:request.method,path:new URL(request.url).pathname});return new Response(JSON.stringify({signedURL:'/object/sign/kb-documents/foreign/file.pdf?token=synthetic'}),{status:200,headers:{'content-type':'application/json'}});});
 await storage.from(scope.bucket).createSignedUrl(probes[2][1],60,{download:true});
 result.sdkRequests=captured;
 if(JSON.stringify(baseline)!==JSON.stringify(noOp))throw Error('No-op changed outcome');
 if(corrected.some(x=>x.expected!==x.actual))throw Error('Candidate control failed');
 if(!baseline.some(x=>x.name==='encoded traversal'&&x.actual!==x.expected))throw Error('Defect not reproduced');
 if(captured[0]?.path!=='/storage/v1/object/sign/kb-documents/foreign/file.pdf')throw Error('Unexpected SDK normalization');
 console.log(JSON.stringify(result,null,2));
})();
