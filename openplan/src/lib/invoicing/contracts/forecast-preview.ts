import type {ContractState} from "./schema";
import type {DeliveryState,ForecastResult} from "./delivery-schema";
export type ForecastPreviewInput={state:ContractState;delivery:DeliveryState;options:{asOf:string;horizonEnd:string;coverageComplete:boolean}};
export type ForecastPreviewReply={result:ForecastResult;error?:never}|{error:string;result?:never};
/** A disposable browser worker keeps preview calculation outside the page thread. */
export function startForecastPreview(input:ForecastPreviewInput){
 const worker=new Worker(new URL("./forecast-preview.worker.ts",import.meta.url),{type:"module"});
 let rejectPending:(reason:Error)=>void=()=>{};
 const result=new Promise<ForecastResult>((resolve,reject)=>{
  rejectPending=reject;
  worker.onmessage=(event:MessageEvent<ForecastPreviewReply>)=>{worker.terminate();if(event.data.error!==undefined)reject(new Error(event.data.error));else resolve(event.data.result);};
  worker.onerror=()=>{worker.terminate();reject(new Error("Forecast preview could not be calculated. Retry the preview or retain a reviewed forecast for background calculation."));};
  worker.onmessageerror=()=>{worker.terminate();reject(new Error("Forecast preview could not be read. Retry the preview."));};
  try{worker.postMessage(input);}catch(error){worker.terminate();reject(error);}
 });
 return {result,cancel(){worker.terminate();rejectPending(new Error("Forecast preview cancelled."));}};
}
