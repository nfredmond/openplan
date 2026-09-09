import {forecastDelivery} from "./delivery";
import type {ForecastPreviewInput,ForecastPreviewReply} from "./forecast-preview";
self.onmessage=(event:MessageEvent<ForecastPreviewInput>)=>{
 let reply:ForecastPreviewReply;
 try{const {state,delivery,options}=event.data;reply={result:forecastDelivery(state,delivery,options)};}
 catch(error){reply={error:error instanceof Error?error.message:"Forecast preview unavailable."};}
 self.postMessage(reply);
};
