const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'translation-running-resolution-browser.cjs'),'utf8');
const start=source.indexOf('async function readSaved('),end=source.indexOf('\nconst results=[];',start);assert(start>=0&&end>start);
const body=source.slice(start,end);
async function exercise(code,values){
 const calls=[],statuses=[];
 const context={request:{get:async url=>{calls.push(url);const status=values[Math.min(calls.length-1,values.length-1)];return{status:()=>status}}}};
 const read=vm.runInNewContext(code+';readSaved',{setTimeout:callback=>callback(),Promise,Error});
 let result,error;try{result=await read(context,'/same-retained-request',statuses)}catch(e){error=e}
 return{calls,statuses,result,error};
}
async function probe(code){
 let run=await exercise(code,[503,200]);assert.equal(run.result?.status(),200,'temporary unavailable read');assert.deepEqual(run.calls,['/same-retained-request','/same-retained-request'],'same request only');assert.deepEqual(run.statuses.map(x=>x.status),[503,200],'all statuses retained');
 for(const status of [401,403,404]){run=await exercise(code,[status,200]);assert.equal(run.result?.status(),status,'permission failure preserved');assert.equal(run.calls.length,1,'permission failure not retried')}
 run=await exercise(code,[503]);assert.match(run.error?.message??'',/after five reads/,'bounded failure');assert.equal(run.calls.length,5,'five read bound');
}
(async()=>{
 const cases=[['baseline',body,null],['harmless',body+'\n// Harmless retry control.\n',null],['skip-unavailable-retry',body.replace('if(response.status()!==503)return response;','return response;'),'temporary unavailable read'],['retry-permission-refusal',body.replace('response.status()!==503','response.status()===200'),'permission failure preserved'],['omit-status-evidence',body.replace('statuses.push({url,status:response.status()});',''),'all statuses retained'],['exceed-five-read-bound',body.replace('attempt<5','attempt<6'),'five read bound']];
 const results=[];
 for(const [name,code,failure] of cases){assert(name==='baseline'||code!==body);let error;try{await probe(code)}catch(e){error=e}if(failure){assert(error,name+' unexpectedly survived');assert(error.message.includes(failure),name+': '+error.message)}else if(error)throw error;results.push({case:name,outcome:failure?'killed':'survived',observedFailure:error?.message??null})}
 fs.writeFileSync(path.join(__dirname,'running-read-retry-controls.json'),JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),results,limits:'Executes the browser runner read helper with controlled HTTP statuses. Does not prove the cause of a real 503 or alter application retry behavior.'},null,2)+'\n');console.log(results.map(x=>x.case+': '+x.outcome).join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1});
