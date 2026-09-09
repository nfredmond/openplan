import type {ForecastResult,ForecastWarning} from "./delivery-schema";

/** Resolve shared warning membership against its own retained forecast, never a later schedule. */
export function forecastWarningNodes(result:ForecastResult,warning:ForecastWarning){
 if(result.formatVersion>=3&&warning.nodeMask!==undefined){
  const mask=BigInt(`0x${warning.nodeMask}`);
  return result.nodes.filter((_,index)=>(mask&(BigInt(1)<<BigInt(index)))!==BigInt(0));
 }
 return result.nodes.filter(node=>node.id===warning.nodeId);
}
