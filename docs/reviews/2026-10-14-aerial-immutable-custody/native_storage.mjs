import {createRequire} from 'node:module';
import fs from 'node:fs';import crypto from 'node:crypto';
const req=createRequire(process.cwd()+'/package.json');
const {StorageClient}=req('@supabase/storage-js');const esbuild=req('esbuild');
const out=process.env.OPENPLAN_PROOF_OUT;
esbuild.buildSync({entryPoints:['src/lib/aerial/artifact-custody-server.ts'],outfile:out+'/custody.cjs',bundle:true,platform:'node',format:'cjs'});
const {runAerialCustodyPass}=req(out+'/custody.cjs');
const config=JSON.parse(fs.readFileSync(out+'/job-private.json'));
const storage=new StorageClient(process.env.OPENPLAN_PROOF_STORAGE_URL,{Authorization:'Bearer '+process.env.OPENPLAN_PROOF_STORAGE_TOKEN,apikey:process.env.OPENPLAN_PROOF_STORAGE_TOKEN});
const bucket='aerial-artifacts';const known=await storage.getBucket(bucket);
if(known.error){const r=await storage.createBucket(bucket,{public:false});if(r.error)throw Error('Private native bucket creation failed');}
const check=await storage.getBucket(bucket);if(check.error||check.data.public!==false)throw Error('Native bucket must be private');
let interrupted=true;const rows=[];const uploads=[];
const client = {
  storage: {
    from: (name) => {
      const api = storage.from(name);
      return {
        download: (...args) => api.download(...args),
        upload: async (...args) => {
          uploads.push({path: args[0], upsert: args[2]?.upsert});
          return api.upload(...args);
        },
      };
    },
  },
  from: (table) => ({
    upsert: async (value) => {
      if (interrupted) return {error: {message: 'Synthetic row acknowledgement unavailable'}};
      for (const next of value) {
        const prior = rows.findIndex(row => row.kind === next.kind && row.ordinal === next.ordinal);
        if (prior >= 0) rows[prior] = next; else rows.push(next);
      }
      return {error: null};
    },
    select: () => ({eq: async () => ({data: rows, error: null})}),
    update: () => ({eq: () => ({select: async () => ({data: [{id: config.processingJobId}], error: null})})}),
  }),
};
const original=Buffer.from([1,2,3]);const replacement=Buffer.from([9,8,7]);
const candidate={kind:'orthomosaic',ordinal:0,downloadUrl:'https://example.invalid/original.tif',expiresAt:'2099-01-01T00:00:00Z',sizeBytes:3,contentType:'image/tiff'};
const storageClientFactory = (fetchImpl) => {
  const scoped = new StorageClient(process.env.OPENPLAN_PROOF_STORAGE_URL, {
    Authorization: 'Bearer ' + process.env.OPENPLAN_PROOF_STORAGE_TOKEN,
    apikey: process.env.OPENPLAN_PROOF_STORAGE_TOKEN,
  }, fetchImpl);
  return {storage: {from: (name) => {
    const api = scoped.from(name);
    return {
      download: (...args) => api.download(...args),
      upload: async (...args) => {
        uploads.push({path: args[0], upsert: args[2]?.upsert});
        return api.upload(...args);
      },
    };
  }}};
};
const call = (bytes) => runAerialCustodyPass({
  supabase: client, storageClientFactory, job: config, candidates: [candidate],
  fetchImpl: async () => new Response(bytes, {headers: {'content-type': 'image/tiff'}}),
});
const first=await call(original);if(!first.unreadableReason?.includes('could not be recorded'))throw Error('Native first row acknowledgement is interrupted');
const key=uploads[0].path;
async function actual(){const value=await storage.from(bucket).download(key);if(value.error)throw Error('Native original object read failed');return Buffer.from(await value.data.arrayBuffer());}
const before=await actual();if(!before.equals(original))throw Error('Native first object preserves original bytes');
interrupted=false;const replay=await call(replacement);const after=await actual();
if(!after.equals(original))throw Error('Native retry replaces original stored bytes');
if(replay.records.some(r=>r.state==='held'))throw Error('Native different retry bytes become held');
const recovered = await call(original);
if(!recovered.records.some(r=>r.state==='held' && r.checksum_sha256===crypto.createHash('sha256').update(original).digest('hex')))throw Error('Native matching original bytes restore custody');
fs.writeFileSync(out+'/native-original-private.bin',before);fs.writeFileSync(out+'/native-after-private.bin',after);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={uploads:uploads.length,originalBytes:before.length,originalSha256:digest(before),afterSha256:digest(after),rowInterruption:'synthetic',matchingOriginalRecovered:true,storage:'actual isolated Storage and installed SDK',scope:'not live RLS, current-main database restore, browser, artifact provenance or full recovery'};
fs.writeFileSync(out+'/native.json',JSON.stringify(report,null,2)+'\n');console.log(report);
