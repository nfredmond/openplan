import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const review=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(review,'../../..'),app=join(root,'openplan');
const workdir=process.env.OPENPLAN_SUPABASE_WORKDIR;
if(!workdir||!isAbsolute(workdir))throw new Error('Name the disposable stack.');
const project=readFileSync(join(workdir,'supabase/config.toml'),'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if(!project?.startsWith('openplan-restore-target-'))throw new Error('Use an explicitly named disposable restore target.');
const relative='openplan/src/lib/assistant/provider-api-worker.ts',path=join(root,relative);
const source=readFileSync(path,'utf8');
if(source!==execFileSync('git',['show',`HEAD:${relative}`],{cwd:root,encoding:'utf8'}))throw new Error('Checkpoint worker source before running live mutations.');
const scratch=mkdtempSync(join(tmpdir(),'openplan-api-worker-live-mutations-'));
const backup=join(scratch,'worker.original');writeFileSync(backup,source,{mode:0o600});
const state=join(scratch,'state.json'),results=[];
const changes=[
  ['harmless-comment','One cycle holds the existing OS lock','Each cycle holds the existing OS lock',null,null,null],
  ['missing-running-journal','await journalWriter(args.directory, { version: 1, target, phase: "running", job });','/* Lost durable dispatch marker */',
    'dispatches through the real SDK','dispatches through the real SDK','Running journal must exist before model dispatch'],
  ['missing-completed-journal','await journalWriter(args.directory, { version: 1, target, phase: "completed", job, delivery });','/* Lost saved completion */',
    'response loss after database commit','response loss after database commit','Completed result must survive response loss'],
  ['forgotten-running-recovery','if (pending?.phase === "delivered") pending = null;','if (pending) pending = null;',
    'killed generating process','killed generating process','AssertionError'],
  ['missed-cancellation','if (watching && !runningSignal.aborted) timer = setTimeout','if (false) timer = setTimeout',
    'generation after cancel','generation after cancel','Worker did not observe cancellation within twelve seconds'],
  ['wrong-deployment','pending && pending.target !== target','false',
    'changed deployment destination','changed deployment destination','AssertionError'],
  ['automatic-business-action','const generated = await invoke();',
    'const generated = await invoke(); const unapproved = await service.from("project_submittals").insert({ project_id: job.project_id, title: "SYNTHETIC forbidden automatic proposal", created_by: job.user_id }); providerRpcError(unapproved.error);',
    'dispatches through the real SDK','dispatches through the real SDK','Generation must not execute its proposed business record'],
];
try{
  for(const [name,before,after,filter,expectedFailure,expectedMessage] of changes){
    if(source.split(before).length!==2)throw new Error(`Invalid mutation anchor: ${name}`);
    writeFileSync(state,JSON.stringify({phase:'mutating',name,path,backup,workdir})+'\n');
    writeFileSync(path,source.replace(before,after));
    const output=join(scratch,`${name}.json`);
    const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/provider-api-worker-live.test.ts',...(filter?['-t',filter]:[]),'--reporter=json',`--outputFile=${output}`],{
      cwd:app,env:{...process.env,OPENPLAN_RLS_LIVE_TEST:'1'},encoding:'utf8',timeout:120_000,
    });
    const report=JSON.parse(readFileSync(output,'utf8'));
    const failures=report.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='failed').map(test=>({name:test.fullName,message:test.failureMessages.join('\n').slice(0,2000)})));
    if(report.numTotalTests!==11||(run.status!==0&&failures.length===0))throw new Error(`Invalid test execution: ${name}`);
    const outcome=run.status===0?'survived':'killed';
    const matched=expectedFailure===null?outcome==='survived'&&report.numPassedTests===11:outcome==='killed'&&failures.some(test=>test.name.includes(expectedFailure)&&test.message.includes(expectedMessage));
    results.push({name,outcome,matched,expectedFailure,expectedMessage,passed:report.numPassedTests,skipped:report.numPendingTests,failures});
    writeFileSync(join(review,'live-mutations.json'),JSON.stringify(results,null,2)+'\n');
    process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);
    if(!matched)process.exitCode=1;
  }
}finally{
  writeFileSync(path,source);
  const sha256=createHash('sha256').update(readFileSync(path)).digest('hex');
  if(sha256!==createHash('sha256').update(source).digest('hex'))throw new Error('Source restoration failed');
  writeFileSync(state,JSON.stringify({phase:'restored',path,backup,workdir,sha256})+'\n');
  process.stdout.write(`Restored worker source; recovery state: ${state}\n`);
}
