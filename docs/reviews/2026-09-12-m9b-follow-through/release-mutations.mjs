import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const review=fileURLToPath(new URL('.',import.meta.url)),app=resolve(review,'../../../openplan');
const path=join(app,'src/test/migrations/release-ordering.test.ts'),source=readFileSync(path,'utf8'),scratch=mkdtempSync(join(tmpdir(),'openplan-v0551-release-mutations-')),results=[];
const releaseRow='tag: "0.55.1",\n    lastMigration: "20261012000002_assistant_api_turns.sql",\n    migrationsAtRelease: 318';
writeFileSync(join(scratch,'release.original'),source);
try{
 for(const [name,before,after,expected] of [
  ['harmless-comment','Once a release ships,','After a release ships,',null],
  ['wrong-migration-count',releaseRow,releaseRow.replace('migrationsAtRelease: 318','migrationsAtRelease: 319'),'no migration has been inserted at or below a shipped high-water mark'],
  ['missing-migration',releaseRow,releaseRow.replace('20261012000002_assistant_api_turns.sql','20261012000002_missing_api_turns.sql'),"every release's recorded last migration exists on disk"],
 ]){
  if(source.split(before).length!==2)throw Error('Invalid anchor');writeFileSync(path,source.replace(before,after));
  const output=join(scratch,name+'.json');const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/migrations/release-ordering.test.ts','--reporter=json',`--outputFile=${output}`],{cwd:app,encoding:'utf8',timeout:60000});
  const report=JSON.parse(readFileSync(output));const failures=report.testResults.flatMap(f=>f.assertionResults.filter(t=>t.status==='failed').map(t=>({name:t.fullName,message:t.failureMessages.join('\n').slice(0,1200)})));
  const matched=expected===null?run.status===0&&report.numPassedTests===6:run.status!==0&&failures.some(t=>t.name.includes(expected)&&t.message.includes('AssertionError'));
  results.push({name,matched,passed:report.numPassedTests,failures});writeFileSync(join(review,'release-mutations.json'),JSON.stringify(results,null,2)+'\n');if(!matched)process.exitCode=1;
 }
}finally{writeFileSync(path,source);if(readFileSync(path,'utf8')!==source)throw Error('Restoration failed');}
console.log(JSON.stringify(results.map(({name,matched,passed})=>({name,matched,passed}))));
