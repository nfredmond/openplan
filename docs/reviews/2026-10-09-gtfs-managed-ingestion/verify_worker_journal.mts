import { readFile } from "node:fs/promises";
import { withGtfsAttemptJournal } from "../../../openplan/src/lib/gtfs/managed-worker-journal.ts";
const [directory, mode] = process.argv.slice(2);
const id = (n: number) => `d9000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const result = await withGtfsAttemptJournal({directory,target:"http://localhost:29821",installationId:id(1),versionId:id(2),maxCommandBytes:65536,signal:new AbortController().signal},
 async journal => {
  const delivered = await journal.deliver("route-0",{operation:"batch",arguments:{kind:"route",ordinal:0,rows:[{route_id:"R1"}]}},{
   send: async (commandId,payload) => {
    const saved=JSON.parse(await readFile(`${directory}/command-route-0/pending.json`,"utf8"));
    if(saved.commandId!==commandId || saved.resolved || JSON.stringify(saved.payload)!==JSON.stringify(payload))throw new Error("unsynced command dispatched");
    console.log(JSON.stringify({event:"dispatch",commandId,token:journal.identity.token}));
    if(mode==="crash")await new Promise(()=>{setInterval(()=>{},1000);});
    return {commandId,rows:1};
   },
   verify: (raw,commandId) => {
    const receipt=raw as {commandId?:unknown;rows?:unknown};
    if(receipt?.commandId!==commandId || receipt.rows!==1)throw new Error("wrong retained receipt");
    return receipt;
   }
  });
  return {...delivered,token:journal.identity.token};
 });
console.log(JSON.stringify({event:"finished",...result}));
