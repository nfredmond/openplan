import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const review=fileURLToPath(new URL('.',import.meta.url)), app=resolve(review,'../../../openplan');
const lib='src/lib/engagement/close-loop.ts', ui='src/components/engagement/close-loop-builder.tsx', route='src/app/api/engagement/campaigns/[campaignId]/closeloop/route.ts', page='src/app/(app)/engagement/[campaignId]/page.tsx';
const originals=new Map([lib,ui,route,page].map(p=>[p,readFileSync(join(app,p),'utf8')]));
const scratch=mkdtempSync(join(tmpdir(),'openplan-m9b-read-mutations-')), results=[];
for(const [p,s] of originals)writeFileSync(join(scratch,p.replaceAll('/','_')),s,{mode:0o600});
const cases=[
 ['harmless-comment',lib,'Staff responses for the builder','Saved staff responses for the builder',null],
 ['lost-error',lib,'error: error ?? null','error: null','preserves the error independently'],
 ['partial-error-rows',lib,'rows: error ? [] : (data ?? [])','rows: (data ?? [])','preserves the error independently'],
 ['wrong-campaign-query',lib,'.eq("campaign_id", campaignId)','.eq("campaign_id", "another-campaign")','reads all entries scoped by campaign'],
 ['missing-projection',lib,'.select(CLOSE_LOOP_ENTRY_COLUMNS)','.select("id, theme_title")','reads all entries scoped by campaign'],
 ['route-ignores-error',route,'if (failure) {','if (false && failure) {','GET refuses a failed read'],
 ['page-hides-error',page,'initialReadError={Boolean(closeLoopEntries.error)}','initialReadError={false}','shows a retry instead of an empty staff-response builder'],
 ['initial-ui-error-lost',ui,'useState(initialReadError)','useState(false)','withholds empty counts and writes'],
 ['invented-empty-state',ui,'!readError && <p className="text-sm text-muted-foreground">No entries yet.','<p className="text-sm text-muted-foreground">No entries yet.','withholds empty counts and writes'],
 ['writes-during-error',ui,'disabled={readError || readLoading}','disabled={false}','withholds empty counts and writes'],
 ['foreign-retry',ui,'rows.some(row => row.campaign_id !== campaignId)','false','after foreign campaign'],
 ['duplicate-retry',ui,'new Set(rows.map(row => row.id)).size !== rows.length','false','after duplicate identity'],
 ['failed-retry-discards-answers',ui,'} catch {\n      setReadError(true);','} catch {\n      setEntries([]); setReadError(true);','keeps known responses'],
 ['malformed-retry',ui,'closeLoopEntrySchema.array().parse(payload.entries)','payload.entries as CloseLoopEntryRow[]','after malformed entry'],
];
const selected=process.argv.slice(2);
if(selected.some(name=>!cases.some(c=>c[0]===name)))throw Error("Unknown selected mutation");
const active=selected.length?cases.filter(c=>selected.includes(c[0])):cases;
const resultFile=selected.length?"mutations-selected.json":"mutations.json";
const tests=['src/test/close-loop.test.ts','src/test/close-loop-route.test.ts','src/test/close-loop-builder.test.tsx','src/test/engagement-campaign-detail-page.test.tsx'];
try {
 for(const [name,p,before,after,expected] of active){
  const original=originals.get(p);if(!original.includes(before))throw Error(`Missing anchor ${name}`);
  writeFileSync(join(scratch,'state.json'),JSON.stringify({phase:'mutating',name,path:join(app,p),backup:join(scratch,p.replaceAll('/','_'))}));
  writeFileSync(join(app,p),original.replace(before,after));
  const output=join(scratch,`${name}.json`);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...tests,'--reporter=json',`--outputFile=${output}`],{cwd:app,encoding:'utf8',timeout:60000});
  writeFileSync(join(app,p),original);
  const report=JSON.parse(readFileSync(output,'utf8'));
  const failures=report.testResults.flatMap(f=>f.assertionResults.filter(t=>t.status==='failed').map(t=>({name:t.fullName,message:t.failureMessages.join('\n').slice(0,1200)})));
  if(report.numTotalTests!==93 || report.numPendingTests!==0)throw Error(`Wrong test census ${name}: ${report.numTotalTests}`);
  const outcome=run.status===0?'survived':'killed';
  const matched=expected===null?outcome==='survived':outcome==='killed'&&failures.some(t=>t.name.includes(expected)&&/AssertionError|expect\(|Unable to find/.test(t.message));
  results.push({name,outcome,matched,expected,failures});writeFileSync(join(review,resultFile),JSON.stringify(results,null,2)+'\n');
  process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);if(!matched)process.exitCode=1;
 }
}finally{
 for(const [p,s] of originals)writeFileSync(join(app,p),s);
 const hashes=Object.fromEntries([...originals].map(([p,s])=>{const actual=readFileSync(join(app,p));if(!actual.equals(Buffer.from(s)))throw Error('Restore mismatch');return [p,createHash('sha256').update(actual).digest('hex')]}));
 writeFileSync(join(scratch,'state.json'),JSON.stringify({phase:'restored',hashes}));process.stdout.write(`Restored; recovery ${scratch}\n`);
}
