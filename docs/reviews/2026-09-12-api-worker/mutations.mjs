import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const review=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(review,'../../..'),app=join(root,'openplan');
const paths={worker:join(app,'src/lib/assistant/provider-api-worker.ts'),lock:join(root,'workers/planner_agent_connector/connector-worker.mjs')};
const sources=Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,readFileSync(path,'utf8')]));
const scratch=mkdtempSync(join(tmpdir(),'openplan-api-worker-mutations-'));
const hash=value=>createHash('sha256').update(value).digest('hex');
for(const [name,source] of Object.entries(sources))writeFileSync(join(scratch,`${name}.original`),source,{mode:0o600});
const changes=[
  ['harmless-comment','worker','One cycle holds the existing OS lock','Each cycle holds the existing OS lock',null],
  ['missing-lock','worker','const lock = await acquireConnectorLock(args.directory);','const lock = { signal: new AbortController().signal, release: async () => {} };','holds its OS lock'],
  ['lost-lock-signal','worker','AbortSignal.any([args.signal, lock.signal])','args.signal','own flock process is lost'],
  ['lost-caller-signal','worker','AbortSignal.any([args.signal, lock.signal])','lock.signal','empty queue or interrupted caller'],
  ['forked-lock-holder','lock','"--nonblock", "--no-fork",','"--nonblock",','own flock process is lost'],
  ['wait-on-already-signalled-exit','lock','child.exitCode === null && child.signalCode === null','child.exitCode === null','own flock process is lost'],
  ['journal-target','worker','pending && pending.target !== target','false','different deployment or corrupt journal'],
  ...['url.username','url.password','url.search','url.hash'].map(field=>[`target-${field}`,'worker',field,'false','canonicalizes the deployment destination']),
  ['target-protocol','worker','!["http:", "https:"].includes(url.protocol)','false','canonicalizes the deployment destination'],
  ['claim-state','worker','turn.state !== "running"','false','non-running retained attempt'],
  ['claim-attempt','worker','!turn.attempt_id','false','claimed job missing attempt_id'],
  ['claim-lease','worker',' || !turn.lease_expires_at ||\n    !Number.isFinite(Date.parse(turn.lease_expires_at))','','claimed job missing lease_expires_at'],
  ['lost-running-journal','worker','await journalWriter(args.directory, { version: 1, target, phase: "running", job });','/* Lost running journal */','journals before its single invocation'],
  ['lost-completed-journal','worker','await journalWriter(args.directory, { version: 1, target, phase: "completed", job, delivery });','/* Lost completed journal */','retries only saved delivery'],
  ['forgotten-pending','worker','if (pending?.phase === "delivered") pending = null;','if (pending) pending = null;','restart of a running journal'],
  ['claim-error','worker','providerRpcError(response.error);\n      if (response.data === null)','if (response.data === null)','failed claim even if an unexpected row'],
  ['credential-projection','worker','"revision_id,connection_id,workspace_id,credential_ciphertext"','"revision_id,connection_id,credential_ciphertext"','journals before its single invocation'],
  ...[['workspace_id','workspace_id'],['connection_id','api_connection_id'],['revision_id','api_revision_id']].flatMap(([column,field])=>[
    [`credential-filter-${column}`,'worker',`.eq("${column}", job.${field})`,'','journals before its single invocation'],
    [`credential-identity-${column}`,'worker',`credential.${column} !== job.${field}`,'false',`credential row with foreign ${column}`],
  ]),
  ['credential-persisted','worker','const credential = credentialSchema.parse(response.data);','const credential = credentialSchema.parse(response.data); Object.assign(job, { credentialCiphertext: credential.credential_ciphertext });','keeps saved encrypted credentials out'],
  ['status-id','worker','value.id !== job.id','false','mismatched current status id'],
  ['status-attempt','worker','value.attemptId !== job.attempt_id','false','mismatched current status attemptId'],
  ['status-running','worker','current.state !== "running"','false','retires cancelled without retrieving credentials'],
  ['lease-changed','worker','Date.parse(current.leaseExpiresAt) !== Date.parse(job.lease_expires_at)','false','changed future lease before dispatch'],
  ['lease-expired','worker','Date.parse(current.leaseExpiresAt) <= Date.now()','false','expired claimed lease before dispatch'],
  ['lost-cancellation-poll','worker','if (watching && !runningSignal.aborted) timer = setTimeout','if (false) timer = setTimeout','aborts an in-flight generation'],
  ['late-response','worker','const generated = await invoke();\n        runningSignal.throwIfAborted();','const generated = await invoke();','response that resolves after cancellation'],
  ['unsanitized-generation-code','worker','error instanceof ProviderApiGenerationError && /^api_[a-z_]{1,100}$/.test(error.code)','error instanceof ProviderApiGenerationError','redacts lookup failures'],
  ['forgotten-terminal-status','worker','if (current.state === "access_lost" || current.state === "cancelled" || current.state === "interrupted") return retire(job, current.state);','/* Forgot terminal status */','retires cancelled without retrieving credentials'],
  ['lost-access-during-finish','worker','if (latest.state === "access_lost" || latest.state === "cancelled" || latest.state === "interrupted") return retire(job, latest.state);','/* Forgot access loss */','minimal access loss that wins the final completion race'],
  ['finished-identity','worker','return fields.every(field => saved[field] === job[field]);','return true;','returned user_id is foreign'],
  ['finished-cancellation','worker','if (saved.state === "cancelled" || saved.state === "interrupted") return retire(job, saved.state);','/* Forgot cancellation */','minimal access loss that wins the final completion race'],
  ['finished-state','worker','saved.state !== (failure === null ? "succeeded" : "failed")','false','changed completion state'],
  ['finished-failure-code','worker','saved.failure_code !== failure','false','changed completion failure_code'],
  ['finished-result','worker','!isDeepStrictEqual(saved.result, result)','false','changed completion result'],
  ['finished-receipt','worker','!isDeepStrictEqual(saved.provider_receipt, receipt)','false','changed completion provider_receipt'],
];
const state=join(scratch,'state.json'),results=[];
try{
  for(const [name,file,before,after,expectedFailure] of changes){
    for(const [key,source] of Object.entries(sources))writeFileSync(paths[key],source);
    const source=sources[file];
    if(source.split(before).length!==2||before===after)throw new Error(`Invalid mutation anchor: ${name}`);
    writeFileSync(state,JSON.stringify({phase:'mutating',name,paths,scratch})+'\n');
    writeFileSync(paths[file],source.replace(before,after));
    const output=join(scratch,`${name}.json`);
    const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/provider-api-worker.test.ts','--reporter=json',`--outputFile=${output}`],{cwd:app,encoding:'utf8',timeout:35_000});
    const report=JSON.parse(readFileSync(output,'utf8'));
    const failures=report.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='failed').map(test=>({name:test.fullName,message:test.failureMessages.join('\n').slice(0,1800)})));
    if(report.numTotalTests!==38||(run.status!==0&&failures.length===0))throw new Error(`Invalid test execution: ${name}`);
    const outcome=run.status===0?'survived':'killed';
    const expectedCode = name === 'lost-access-during-finish' ? 'Error: provider_access_denied' : name === 'finished-cancellation' ? 'Error: api_worker_delivery_mismatch' : null;
    const expectedAssertion = test => /AssertionError|__VITEST_REJECTS__/.test(test.message) || (expectedCode !== null && test.message.startsWith(expectedCode));
    const matched=expectedFailure===null?outcome==='survived':outcome==='killed'&&failures.some(test=>test.name.includes(expectedFailure)&&expectedAssertion(test));
    results.push({name,outcome,expectedFailure,matched,failures});
    writeFileSync(join(review,'mutations.json'),JSON.stringify(results,null,2)+'\n');
    process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);
    if(!matched)process.exitCode=1;
  }
}finally{
  for(const [key,source] of Object.entries(sources))writeFileSync(paths[key],source);
  const hashes=Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,hash(readFileSync(path,'utf8'))]));
  if(Object.entries(sources).some(([name,source])=>hashes[name]!==hash(source)))throw new Error('Source restoration failed');
  writeFileSync(state,JSON.stringify({phase:'restored',paths,scratch,hashes})+'\n');
  process.stdout.write(`Restored sources; recovery state: ${state}\n`);
}
