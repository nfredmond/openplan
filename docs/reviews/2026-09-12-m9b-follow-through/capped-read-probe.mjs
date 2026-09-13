// Historical reproducer of the capped-read defect; run from openplan/ with node --import tsx.
import {loadCloseLoopEntries,loadPublishedCloseLoopEntries} from '../../../openplan/src/lib/engagement/close-loop.ts';
import {writeFileSync} from 'node:fs';
const rows=Array.from({length:5},(_,i)=>({id:`synthetic-${i}`,campaign_id:'synthetic-campaign',status:'published'}));
const results=[];
for(const loader of [loadCloseLoopEntries,loadPublishedCloseLoopEntries])for(const cap of [5,2]){
 const calls=[];
 const query={select(...args){calls.push(['select',...args]);return this},eq(...args){calls.push(['eq',...args]);return this},order(...args){calls.push(['order',...args]);return this},then(resolve){resolve({data:rows.slice(0,cap),error:null})}};
 const result=await loader({from(table){calls.push(['from',table]);return query}},'synthetic-campaign');
 results.push({loader:loader.name,syntheticServerCap:cap,available:rows.length,returned:result.rows.length,error:result.error,calls});
 if(result.rows.length!==cap||result.error!==null)throw Error('Unexpected probe outcome');
}
writeFileSync(new URL('capped-read-probe.json', import.meta.url),JSON.stringify({scope:'Real loaders with a synthetic capped-query adapter; not live database evidence',results},null,2)+'\n');
process.stdout.write(JSON.stringify(results.map(({calls,...result})=>result),null,2)+'\n');
