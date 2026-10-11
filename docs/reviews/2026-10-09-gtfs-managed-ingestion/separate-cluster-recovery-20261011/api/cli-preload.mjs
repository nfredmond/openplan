// Bound the installed CLI to native fixture RPCs and the exact loader service.
import { readFileSync, appendFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import child from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
export const paths = ['scan_gtfs_ingest_candidates', 'claim_gtfs_ingest', 'read_gtfs_ingest_attempt', 'complete_gtfs_ingest'].map(name => '/rest/v1/rpc/' + name);
export function requireValue(value, reason) { if (!value) throw new Error(reason); }
export function mapped(input, init, config) {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const bridge = new URL(config.bridge);
  requireValue(url.origin === 'http://127.74.9.10:29941' && paths.includes(url.pathname) && !url.search && !url.hash && !url.username && !url.password, 'expanded-cli-request-scope');
  requireValue(bridge.hostname === '127.0.0.1' && bridge.protocol === 'http:' && !bridge.username && !bridge.password && !bridge.search && !bridge.hash && bridge.pathname === '/', 'expanded-cli-bridge-scope');
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  requireValue(method === 'POST', 'expanded-cli-method');
  const target = new URL(url.pathname, bridge);
  return [input instanceof Request ? new Request(target, input) : target, init];
}
export function loaderAllowed(file, args, config, digest) {
  requireValue(file === config.loader && Array.isArray(args) && args.length === 2 && args[0] === config.loaderService && args[1] === '--ping', 'expanded-cli-child-scope');
  requireValue(digest === config.loaderSha256, 'expanded-cli-child-bytes');
}
export function lockAllowed(file, args, options, config, digest, catDigest, canonical, privateFile) {
  requireValue(file === '/usr/bin/flock' && Array.isArray(args) && args.length === 5 && args[0] === '--exclusive' && args[1] === '--nonblock' && args[2] === '--no-fork' && args[4] === '/usr/bin/cat', 'expanded-cli-lock-command');
  requireValue(args[3] === canonical && canonical.startsWith(config.workerRoot + '/') && canonical.endsWith('/run.lock') && privateFile, 'expanded-cli-lock-path');
  requireValue(digest === config.flockSha256 && catDigest === config.catSha256, 'expanded-cli-lock-bytes');
  requireValue(JSON.stringify(options?.stdio) === JSON.stringify(['pipe','pipe','pipe']) && JSON.stringify(options?.env) === JSON.stringify({ PATH: '/usr/bin:/bin' }), 'expanded-cli-lock-options');
}
if (process.env.OPENPLAN_EXPANDED_CLI_PROOF_CONFIG) {
  const config = JSON.parse(readFileSync(process.env.OPENPLAN_EXPANDED_CLI_PROOF_CONFIG, 'utf8'));
  const log = row => appendFileSync(config.observations, JSON.stringify(row) + '\n', { mode: 0o600 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    try { const args = mapped(input, init, config); return await originalFetch(...args); }
    catch (error) { log({ transportError: error instanceof Error ? error.message : 'Unknown' }); throw error; }
  };
  const spawn = child.spawn;
  child.spawn = function (file, args, options) {
    try {
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (file === '/usr/bin/flock') {
        const canonical = realpathSync(args[3]), meta = statSync(canonical);
        lockAllowed(file,args,options,config,digest,createHash('sha256').update(readFileSync('/usr/bin/cat')).digest('hex'),canonical,meta.isFile() && meta.uid === process.getuid() && !(meta.mode & 0o077));
        log({ lockHolderOnly: true });
      } else { loaderAllowed(file,args,config,digest); log({ loaderOnly: true }); }
    } catch (error) { log({ computationRefused: true, kind: 'spawn' }); throw error; }
    return spawn.call(this,file,args,options);
  };
  for (const key of ['exec','execFile','execSync','execFileSync','spawnSync','fork']) child[key] = () => { log({ computationRefused: true, kind: key }); throw new Error('expanded-cli-computation-refused'); };
  for (const mod of [http, https]) for (const key of ['request','get']) mod[key] = () => { log({ directNetworkRefused: true }); throw new Error('expanded-cli-direct-network-refused'); };
  syncBuiltinESMExports();
}
