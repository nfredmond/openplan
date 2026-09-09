/** Synthetic calculation and serialization probe; does not prove browser delivery. */
import {build} from "esbuild";
import {Worker} from "node:worker_threads";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {homedir} from "node:os";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {deliveryFixture} from "../../src/test/fixtures/contract-delivery";
import {nextDate} from "../../src/lib/invoicing/contracts/delivery";
const scratch=join(homedir(),".local/state/openplan/m11-resumed-acceptance-2026-09-08");
function input(tasks:number,people:number,days:number){
 const f=deliveryFixture(),uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
 const staff=Array.from({length:people},(_,i)=>uuid(i+1));
 const taskIds=Array.from({length:tasks},(_,i)=>uuid(i+1001));
 const calendar={name:"Synthetic daily availability, no employment rule",weekdays:[0,1,2,3,4,5,6],exceptions:[]};
 f.options={asOf:"2026-09-08",horizonEnd:nextDate("2026-09-08",days-1),coverageComplete:true};
 f.state.staff=staff.map(id=>({...f.state.staff[0],id}));
 f.state.baselines[0].content.tasks=taskIds.map(id=>({...f.state.baselines[0].content.tasks[0],id,title:`Synthetic task ${id}`,staff:staff.map(staffId=>({staffId,hours:"1.00",cost:"1.00"}))}));
 f.schedule.nodes=taskIds.map(taskId=>({...f.schedule.nodes[0],id:taskId,taskId,title:`Synthetic work ${taskId}`,calendar,notBefore:f.options.asOf,reserveThrough:f.options.horizonEnd,staff:staff.map(staffId=>({staffId,hoursPerDay:"0.01"}))}));
 f.delivery.assignments=taskIds.flatMap(taskId=>staff.map(staffId=>({taskId,staffId})));
 f.delivery.workUpdates=taskIds.flatMap(task_id=>staff.map(staff_id=>({...f.delivery.workUpdates[0],task_id,staff_id,content:{...f.delivery.workUpdates[0].content,taskId:task_id,staffId:staff_id,hours:"1.00"},remaining_cost:"1.00",remaining_gross_billing:"1.00"})));
 f.delivery.capacityVersions=staff.map(staff_id=>({...f.delivery.capacityVersions[0],staff_id,content:{...f.delivery.capacityVersions[0].content,staffId:staff_id,calendar,startsOn:f.options.asOf,endsOn:f.options.horizonEnd}}));
 return {state:f.state,delivery:f.delivery,options:f.options};
}
async function measure(source:string,tasks:number,staff:number,days:number){
 const output=join(scratch,`forecast-${source}-${tasks}.mjs`);
 const contents=source==="before"?execFileSync("git",["show","672db930:openplan/src/lib/invoicing/contracts/delivery.ts"],{encoding:"utf8"}):await readFile(resolve("src/lib/invoicing/contracts/delivery.ts"),"utf8");
 await build({stdin:{contents,resolveDir:resolve("src/lib/invoicing/contracts"),sourcefile:"delivery.ts",loader:"ts"},bundle:true,platform:"node",format:"esm",outfile:output,tsconfig:resolve("tsconfig.json")});
 const bridge=join(scratch,`size-${source}-${tasks}.mjs`);
 await writeFile(bridge,`import {parentPort,workerData} from 'node:worker_threads';import {createHash} from 'node:crypto';import {forecastDelivery} from ${JSON.stringify(pathToFileURL(output).href)};const started=performance.now();const result=forecastDelivery(workerData.state,workerData.delivery,workerData.options);const elapsedMs=Math.round(performance.now()-started),memory=process.memoryUsage();let serializedBytes=null,resultSha256=null,serializationError=null;try{const json=JSON.stringify(result);serializedBytes=Buffer.byteLength(json);const totals=new Map();for(const r of result.reservations){const k=r.staffId+':'+r.date;const old=totals.get(k);const hours=BigInt(r.hours.replace('.',''));if(old)old.hours+=hours;else totals.set(k,{...r,hours});}const reservations=[...totals.values()].map(r=>({...r,hours:String(r.hours/100n)+'.'+String(r.hours%100n).padStart(2,'0')}));resultSha256=createHash('sha256').update(JSON.stringify({...result,formatVersion:2,reservations})).digest('hex');}catch(e){serializationError=e.message;}parentPort.postMessage({elapsedMs,heapUsed:memory.heapUsed,rss:memory.rss,reservations:result.reservations.length,finish:result.finish,remainingCost:result.remainingCost,warnings:result.warnings.length,serializedBytes,resultSha256,serializationError});`);
 const worker=new Worker(pathToFileURL(bridge),{workerData:input(tasks,staff,days),resourceLimits:{maxOldGenerationSizeMb:7168}});
 let heartbeats=0;const timer=setInterval(()=>heartbeats++,10);
 try{
  const result=await new Promise<Record<string,unknown>>((done,fail)=>{worker.once("message",done);worker.once("error",fail);worker.once("exit",code=>{if(code)fail(new Error(`Worker exit ${code}`));});});
  assert.equal(result.reservations,(source==="before"?tasks:1)*staff*days);assert.equal(result.remainingCost,`${tasks*staff}.00`);assert.equal(result.finish,"2026-12-16");
  return {source,tasks,staff,days,mainThreadHeartbeats:heartbeats,...result};
 }finally{clearInterval(timer);await worker.terminate();}
}
async function main(){
 await mkdir(scratch,{recursive:true});
 const receipts:Record<string,unknown>[]=[];
 for(const source of ["before","current"]){const receipt=await measure(source,40,20,180);receipts.push(receipt);console.log(JSON.stringify(receipt));}
 assert.equal(receipts[0].resultSha256,receipts[1].resultSha256,"Forecast compaction changed dates, money, warnings or daily reservation totals");
 if(process.argv.includes("--maximum")){const receipt=await measure("current",200,100,731);receipts.push(receipt);console.log(JSON.stringify(receipt));}
 await writeFile(resolve("../docs/reviews/2026-09-08-m11-delivery/resumed-forecast-compaction.json"),JSON.stringify({synthetic:true,receipts,blindCategories:["Browser rendering and structured cloning","Adverse maximum-size warning count","Agency calendar validity","Human acceptance"]},null,2)+"\n");
}
void main();
