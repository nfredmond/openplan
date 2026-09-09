/** Synthetic worker execution probe. Node message bridge is not browser acceptance. */
import {build} from "esbuild";
import {Worker} from "node:worker_threads";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {randomUUID,createHash} from "node:crypto";
import assert from "node:assert/strict";
import {deliveryFixture} from "../../src/test/fixtures/contract-delivery";
import {forecastDelivery} from "../../src/lib/invoicing/contracts/delivery";
import type {ForecastPreviewReply} from "../../src/lib/invoicing/contracts/forecast-preview";
async function main(){
 const scratch=await mkdtemp(join(tmpdir(),"m11-preview-probe-")),bundle=join(scratch,"browser-worker.mjs");
 await build({entryPoints:[resolve("src/lib/invoicing/contracts/forecast-preview.worker.ts")],bundle:true,platform:"browser",format:"esm",outfile:bundle,tsconfig:resolve("tsconfig.json")});
 const bridge=join(scratch,"node-message-bridge.mjs");await writeFile(bridge,`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:reply=>parentPort.postMessage(reply)};await import(${JSON.stringify(pathToFileURL(bundle).href)});parentPort.on('message',data=>self.onmessage({data}));`);
 const f=deliveryFixture(),staff=Array.from({length:20},()=>randomUUID()),tasks=Array.from({length:40},()=>randomUUID());
 const calendar={name:"Synthetic seven-day capacity, not an employment rule",weekdays:[0,1,2,3,4,5,6],exceptions:[]};
 f.options={asOf:"2026-09-08",horizonEnd:"2027-03-06",coverageComplete:true};
 f.state.staff=staff.map(id=>({...f.state.staff[0],id}));
 f.state.baselines[0].content.tasks=tasks.map(id=>({...f.state.baselines[0].content.tasks[0],id,title:`Synthetic task ${id}`,staff:staff.map(staffId=>({staffId,hours:"1.00",cost:"1.00"}))}));
 f.schedule.nodes=tasks.map(taskId=>({...f.schedule.nodes[0],id:randomUUID(),taskId,calendar,notBefore:f.options.asOf,reserveThrough:f.options.horizonEnd,staff:staff.map(staffId=>({staffId,hoursPerDay:"0.01"}))}));
 f.delivery.assignments=tasks.flatMap(taskId=>staff.map(staffId=>({taskId,staffId})));
 f.delivery.workUpdates=tasks.flatMap(task_id=>staff.map(staff_id=>({...f.delivery.workUpdates[0],id:randomUUID(),task_id,staff_id,content:{...f.delivery.workUpdates[0].content,taskId:task_id,staffId:staff_id,hours:"1.00"},remaining_cost:"1.00",remaining_gross_billing:"1.00"})));
 f.delivery.capacityVersions=staff.map(staff_id=>({...f.delivery.capacityVersions[0],id:randomUUID(),staff_id,content:{...f.delivery.capacityVersions[0].content,staffId:staff_id,calendar,startsOn:f.options.asOf,endsOn:f.options.horizonEnd}}));
 const input={state:f.state,delivery:f.delivery,options:f.options},worker=new Worker(pathToFileURL(bridge));let heartbeats=0;const started=performance.now(),ticker=setInterval(()=>heartbeats++,10);
 let reply:ForecastPreviewReply;
 try{reply=await new Promise<ForecastPreviewReply>((done,fail)=>{worker.once('message',done);worker.once('error',fail);worker.postMessage(input);});}finally{clearInterval(ticker);await worker.terminate();}
 const elapsedMs=Math.round(performance.now()-started);assert(reply!.result,reply!.error);assert(heartbeats>0,"The main thread did not service its heartbeat");
 const direct=forecastDelivery(f.state,f.delivery,f.options);assert.deepEqual(reply!.result,direct);assert.equal(direct.nodes.length,40);assert.equal(direct.remainingCost,"800.00");assert.equal(direct.finish,"2026-12-16");
 const receipt={synthetic:true,execution:"Bundled browser-worker source through Node message bridge; not browser acceptance",tasks:40,staff:20,horizonDays:180,reservations:direct.reservations.length,elapsedMs,mainThreadHeartbeats:heartbeats,exactDirectResultMatch:true,resultSha256:createHash('sha256').update(JSON.stringify(direct)).digest('hex'),blindCategories:["Browser worker bootstrap and CSP","DOM rendering and main-thread structured cloning at maximum size","Agency calendar validity","Human acceptance"]};
 await writeFile(resolve("../docs/reviews/2026-09-08-m11-delivery/preview-worker-measurement.json"),JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify(receipt));
}
void main();
