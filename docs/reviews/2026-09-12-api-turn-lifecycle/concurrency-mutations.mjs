import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const review=fileURLToPath(new URL('.',import.meta.url));
const app=resolve(review,'../../../openplan');
const workdir=process.env.OPENPLAN_SUPABASE_WORKDIR;
const scratch=process.env.OPENPLAN_API_CONCURRENCY_SCRATCH;
if(!workdir||!isAbsolute(workdir)||!scratch||!isAbsolute(scratch)) throw new Error('Name the disposable stack and private scratch directory.');
const project=readFileSync(join(workdir,'supabase/config.toml'),'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if(!project?.startsWith('openplan-restore-target-')) throw new Error('This dated mutation campaign requires a named disposable restore target.');
const container=`supabase_db_${project}`;
mkdirSync(scratch,{recursive:true,mode:0o700});
const query=statement=>execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const source=readFileSync(join(app,'supabase/migrations/20261012000002_assistant_api_turns.sql'),'utf8');
function definition(name){
  const start=source.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`));
  const end=source.indexOf('\nEND $$;',start);
  if(start<0||end<0) throw new Error(`Missing definition ${name}`);
  return source.slice(start,end+'\nEND $$;'.length).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
}
const definitions=['lock_assistant_api_turn','claim_assistant_api_turn'].map(definition);
const expected=Object.fromEntries(definitions.map(sql=>[sql.match(/FUNCTION public\.(\w+)/)[1],createHash('sha256').update(sql.split('AS $$')[1].split('$$;')[0]).digest('hex')]));
function checkedBodies(){
  const actual=Object.fromEntries(query("SELECT proname,encode(extensions.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('lock_assistant_api_turn','claim_assistant_api_turn') ORDER BY proname;").split('\n').map(line=>line.split('|')));
  if(Object.entries(expected).some(([name,hash])=>actual[name]!==hash)) throw new Error('Database function differs from source. Inspect the prior mutation and restore file before proceeding.');
  return actual;
}
checkedBodies();
if(query("SELECT count(*) FROM public.assistant_provider_turns WHERE provider='api_connection' AND state IN ('queued','running');")!=='0') throw new Error('API queue is not empty; do not consume another session\'s jobs.');
const restoreFile=join(scratch,'original-functions.sql');
writeFileSync(restoreFile,definitions.join('\n'),{mode:0o600});
const stateFile=join(scratch,'state.json');
const replace=(sql,before,after)=>{if(sql.split(before).length!==2)throw new Error('Mutation anchor must occur exactly once.');return sql.replace(before,after);};
const cases=[
  ['harmless-comment','-- Harmless control\nSELECT 1;',null],
  ['connection-lock',replace(definitions[0],"WHERE id=identity.api_connection_id AND workspace_id=identity.workspace_id FOR UPDATE;","WHERE id=identity.api_connection_id AND workspace_id=identity.workspace_id;"),'saved API status locks its connection'],
  ['scope-lock',replace(definitions[0],'PERFORM public.assert_assistant_provider_scope(identity.user_id,identity.workspace_id,identity.project_id);','PERFORM 1;'),'saved API claim waits for an in-flight membership',"to be 'null'"],
  ['reservation-lock',replace(definitions[1],"PERFORM pg_advisory_xact_lock(hashtextextended('assistant_api_dispatch:'||job.workspace_id::text,0));",'PERFORM 1;'),'saved API budget serializes different connections'],
];
const results=[];
try{
  for(const [name,sql,expectedFailure,expectedMessage='Competing execution never waited on a database lock'] of cases){
    query(definitions.join('\n'));checkedBodies();
    writeFileSync(stateFile,JSON.stringify({phase:'mutating',name,container,restoreFile})+'\n',{mode:0o600});
    query(sql);
    const output=join(scratch,`${name}.json`);
    const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/assistant-provider-concurrency.test.ts','-t','saved API','--reporter=json',`--outputFile=${output}`],{
      cwd:app,env:{...process.env,OPENPLAN_RLS_LIVE_TEST:'1'},encoding:'utf8',timeout:120_000,
    });
    const report=JSON.parse(readFileSync(output,'utf8'));
    const failures=report.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='failed').map(test=>({name:test.fullName,message:test.failureMessages.join('\n')})));
    if(report.numTotalTests!==18||(run.status!==0&&failures.length===0))throw new Error(`Invalid test execution: ${name}`);
    const outcome=run.status===0?'survived':'killed';
    const matched=expectedFailure===null?outcome==='survived':outcome==='killed'&&failures.some(test=>test.name.includes(expectedFailure)&&test.message.includes(expectedMessage));
    results.push({name,outcome,expectedFailure,expectedMessage,matched,failures});
    writeFileSync(join(review,'concurrency-mutations.json'),JSON.stringify(results,null,2)+'\n');
    process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);
    if(!matched)process.exitCode=1;
  }
}finally{
  query(readFileSync(restoreFile,'utf8'));
  const hashes=checkedBodies();
  writeFileSync(stateFile,JSON.stringify({phase:'restored',container,restoreFile,hashes})+'\n',{mode:0o600});
  process.stdout.write('Original function bodies restored and checked.\n');
}
