import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const review=fileURLToPath(new URL('.',import.meta.url)),root=resolve(review,'../../..'),app=join(root,'openplan');
const path=join(app,'src/app/api/assistant/providers/turns/route.ts'),source=readFileSync(path,'utf8');
const scratch=mkdtempSync(join(tmpdir(),'openplan-api-request-route-mutations-')),results=[];
writeFileSync(join(scratch,'route.original'),source,{mode:0o600});
const changes=[
 ['harmless-comment','Saved API jobs are only queued here.','Saved API requests are only queued here.',null],
 ['wrong-create-rpc','service.rpc("create_assistant_api_turn",','service.rpc("create_assistant_provider_turn",','queues the exact saved revision'],
 ['wrong-revision-argument','p_revision_id: body.revisionId','p_revision_id: body.connectionId','queues the exact saved revision'],
 ['wrong-config-argument','p_configuration_hash: body.configurationHash','p_configuration_hash: "0".repeat(64)','queues the exact saved revision'],
 ['wrong-charge-argument','p_charge_ack: body.acceptApiCharges','p_charge_ack: false','queues the exact saved revision'],
 ['missing-charge-validation','authMode: z.enum(["connection_api_key", "connection_no_key"]), acceptApiCharges: z.literal(true)','authMode: z.enum(["connection_api_key", "connection_no_key"]), acceptApiCharges: z.boolean().optional()','refuses invalid or unacknowledged'],
 ['missing-owner-binding','original.user_id !== userId','false','refuses a valid stored row'],
 ['missing-connection-binding','original.api_connection_id !== body.connectionId','false','refuses a valid stored row'],
 ['missing-revision-binding','original.api_revision_id !== body.revisionId','false','refuses a valid stored row'],
 ['missing-config-binding','original.api_configuration_hash !== body.configurationHash','false','refuses a different valid frozen configuration'],
 ['missing-new-packet-check','saved.created && original.packet_canonical !== common.p_packet_canonical','false','requires the new packet only when created is true'],
 ['rewritten-retry-packet','saved.created && original.packet_canonical !== common.p_packet_canonical','original.packet_canonical !== common.p_packet_canonical','requires the new packet only when created is false'],
 ['inline-api-generation','saved.created && body.provider === "anthropic"','saved.created && (body.provider === "anthropic" || body.provider === "api_connection")','queues the exact saved revision'],
];
try{
 for(const [name,before,after,expected] of changes){
  if(source.split(before).length!==2)throw new Error(`Invalid anchor: ${name}`);
  writeFileSync(join(scratch,'state.json'),JSON.stringify({phase:'mutating',name,path})+'\n');
  writeFileSync(path,source.replace(before,after));
  const output=join(scratch,`${name}.json`);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/provider-api-request-route.test.ts','--reporter=json',`--outputFile=${output}`],{cwd:app,encoding:'utf8',timeout:60000});
  const report=JSON.parse(readFileSync(output,'utf8'));
  const failures=report.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='failed').map(test=>({name:test.fullName,message:test.failureMessages.join('\n').slice(0,1400)})));
  if(report.numTotalTests!==26 || report.numPendingTests!==0)throw new Error(`Invalid test execution: ${name}`);
  const outcome=run.status===0?'survived':'killed';
  const matched=expected===null?outcome==='survived'&&report.numPassedTests===26:outcome==='killed'&&failures.some(test=>test.name.includes(expected)&&/AssertionError|__VITEST_/.test(test.message));
  results.push({name,outcome,matched,expected,passed:report.numPassedTests,failures});
  writeFileSync(join(review,'mutations.json'),JSON.stringify(results,null,2)+'\n');
  process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);
  if(!matched)process.exitCode=1;
 }
}finally{
 writeFileSync(path,source);
 const sha256=createHash('sha256').update(readFileSync(path)).digest('hex');
 if(sha256!==createHash('sha256').update(source).digest('hex'))throw new Error('Restoration failed');
 writeFileSync(join(scratch,'state.json'),JSON.stringify({phase:'restored',path,sha256})+'\n');
 process.stdout.write(`Restored source; private recovery ${scratch}\n`);
}
