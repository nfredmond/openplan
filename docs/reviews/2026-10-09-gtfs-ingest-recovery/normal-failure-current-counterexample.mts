import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const app = process.cwd();
const require = createRequire(app + '/package.json');
const { createClient } = require('@supabase/supabase-js');
const { parseGtfsFeed } = await import(app + '/src/lib/gtfs/parse.ts');
const { beginGtfsFeedVersion, markGtfsFeedVersionStage, writeParsedFeedVersion, promoteGtfsFeedVersion, failGtfsFeedVersion } = await import(app + '/src/lib/gtfs/persist.ts');
const requests: {method:string,path:string,bodyBytes:number,status:number,elapsedMs:number}[] = [];
const client = createClient(process.env.OPENPLAN_PROOF_HTTP_URL!, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, {
 db:{schema:process.env.OPENPLAN_PROOF_HTTP_SCHEMA},auth:{persistSession:false,autoRefreshToken:false},
 global:{fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
  const target=new URL(String(input)); target.pathname=target.pathname.replace(/^\/rest\/v1/,'');
  const start=performance.now(); const response=await fetch(target,init);
  requests.push({method:init?.method??'GET',path:target.pathname,bodyBytes:typeof init?.body==='string'?Buffer.byteLength(init.body):0,status:response.status,elapsedMs:performance.now()-start});
  return response;
 }}
});
const bytes=readFileSync(process.argv[2]); const checksum=createHash('sha256').update(bytes).digest('hex');
const start=performance.now(); const parsed=await parseGtfsFeed(bytes); const parseMs=performance.now()-start;
if(!parsed.ok)throw new Error(JSON.stringify(parsed));
const begin=await beginGtfsFeedVersion({service:client,workspaceId:process.env.OPENPLAN_PROOF_WORKSPACE!,sourceKind:'upload',provisionalName:'Local parser persistence measurement'});
if(!begin.ok)throw new Error(JSON.stringify(begin));
if(!await markGtfsFeedVersionStage(client,begin.versionId,'parsing'))throw new Error('Stage refused');
const writing=performance.now();
const result=await writeParsedFeedVersion({service:client,workspaceId:process.env.OPENPLAN_PROOF_WORKSPACE!,versionId:begin.versionId,feed:parsed.feed,checksumSha256:checksum,byteSize:bytes.length});
const persistenceMs=performance.now()-writing;
const promotion=result.ok?await promoteGtfsFeedVersion({service:client,feedId:begin.feedId,versionId:begin.versionId}):null;
const version=await client.from('gtfs_feed_versions').select('status,is_current,route_service_level_rows,stop_service_level_rows,tract_service_rows,tract_service_computed_at').eq('id',begin.versionId).single();
const lateFailure=await failGtfsFeedVersion({service:client,versionId:begin.versionId,feedId:begin.feedId,code:'partial_write',detail:'Synthetic late failure after successful promotion'});
const after=await client.from('gtfs_feed_versions').select('status,is_current,route_service_level_rows,stop_service_level_rows').eq('id',begin.versionId).single();
const routeCount=await client.from('gtfs_route_service_levels').select('id',{count:'exact',head:true}).eq('feed_version_id',begin.versionId);
const stopCount=await client.from('gtfs_stop_service_levels').select('id',{count:'exact',head:true}).eq('feed_version_id',begin.versionId);
console.log(JSON.stringify({lateFailure,after,actualRouteRows:routeCount.count,actualStopRows:stopCount.count,inputSha256:checksum,archiveBytes:bytes.length,parseMs,persistenceMs,processMaxRssKiB:process.resourceUsage().maxRSS,begin,result,promotion,version,requests},null,2));
