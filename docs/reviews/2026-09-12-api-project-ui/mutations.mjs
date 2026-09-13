import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const review=fileURLToPath(new URL('.',import.meta.url)),root=resolve(review,'../../..'),app=join(root,'openplan');
const path=join(app,'src/components/assistant/project-provider-panel.tsx'),source=readFileSync(path,'utf8');
const scratch=mkdtempSync(join(tmpdir(),'openplan-api-project-ui-mutations-')),results=[];
writeFileSync(join(scratch,'panel.original'),source,{mode:0o600});
const changes=[
 ['harmless-comment','This is a narrow alternative inside','This is an optional alternative inside',null],
 ['missing-consent','Boolean(apiRevision?.configuration.modelIds.includes(model)) && charges','Boolean(apiRevision?.configuration.modelIds.includes(model))','sends the exact saved revision'],
 ['wrong-revision','revisionId: apiRevision.id','revisionId: apiSelection.id','sends the exact saved revision'],
 ['wrong-hash','configurationHash: apiRevision.configuration_hash','configurationHash: "0".repeat(64)','sends the exact saved revision'],
 ['wrong-auth','apiRevision.configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key"','"connection_api_key"','sends the exact saved revision and configured model with none'],
 ['wrong-ack','authMode: apiRevision.configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key", acceptApiCharges: true','authMode: apiRevision.configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key", acceptApiCharges: undefined','sends the exact saved revision'],
 ['missing-model-consent-reset','onChange={event => { setModel(event.target.value); setCharges(false); }}','onChange={event => { setModel(event.target.value); }}','requires fresh consent after changing'],
 ['missing-page-append','...prior.filter(row => !page.connections.some(next => next.id === row.id)), ...page.connections','...page.connections','loads subsequent metadata pages'],
 ['foreign-workspace','row.workspace_id !== workspaceId || row.current_revision &&','false || row.current_revision &&','refuses metadata outside the requested workspace'],
 ['foreign-revision-workspace','row.current_revision.workspace_id !== workspaceId || row.current_revision.connection_id','false || row.current_revision.connection_id','refuses metadata outside the requested revision_workspace'],
 ['foreign-connection','row.current_revision.connection_id !== row.id','false','refuses metadata outside the requested connection'],
 ['foreign-revision','row.current_revision.id !== row.current_revision_id','false','refuses metadata outside the requested revision_id'],
 ['regressing-pagination','page.nextOffset !== null && page.nextOffset <= offset','false','refuses metadata outside the requested offset'],
 ['changed-selection-revision','row.current_revision_id === apiRevision.id','true','does not silently replace a selected revision after edit'],
 ['changed-selection-hash','row.current_revision?.configuration_hash === apiRevision.configuration_hash','true','does not silently replace a selected revision after hash'],
 ['changed-selection-revocation','row.id === apiSelection.id && !row.revoked_at','row.id === apiSelection.id','does not silently replace a selected revision after revoke'],
 ['recreated-retry','onClick={() => void send(pending)}','onClick={() => void send({ ...pending, requestId: crypto.randomUUID() })}','keeps the exact pending payload'],
 ['wrong-recovered-connection','turn.api_connection_id === body.connectionId','true','does not accept a POST response for a different API connection'],
 ['wrong-recovered-revision','turn.api_revision_id === body.revisionId','true','does not accept a POST response for a different API revision'],
 ['wrong-recovered-hash','turn.api_configuration_hash === body.configurationHash','true','does not accept a POST response for a different API hash'],
 ['missing-history-auth-check','turn.auth_mode !== (config.authMode === "api_key" ? "connection_api_key" : "connection_no_key")','false','refuses an unreadable retained API configuration: auth'],
 ['missing-history-model-check','!config.modelIds.includes(turn.model_id)','false','refuses an unreadable retained API configuration: model'],
 ['current-history-destination','providerApiRevisionMetadata.shape.configuration.parse(JSON.parse(turn.api_configuration_canonical)).endpoint','apiConnections[0]?.current_revision?.configuration.endpoint','retains the old destination'],
];
try{
 for(const [name,before,after,expected] of changes){
  if(source.split(before).length!==2)throw new Error(`Invalid anchor: ${name}`);
  writeFileSync(join(scratch,'state.json'),JSON.stringify({phase:'mutating',name,path})+'\n');writeFileSync(path,source.replace(before,after));
  const output=join(scratch,`${name}.json`);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/project-api-provider-panel.test.tsx','--reporter=json',`--outputFile=${output}`],{cwd:app,encoding:'utf8',timeout:60000});
  const report=JSON.parse(readFileSync(output,'utf8'));
  const failures=report.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='failed').map(test=>({name:test.fullName,message:test.failureMessages.join('\n').slice(0,1600)})));
  if(report.numTotalTests!==25 || report.numPendingTests!==0)throw new Error(`Invalid execution: ${name}`);
  const outcome=run.status===0?'survived':'killed';
  const matched=expected===null?outcome==='survived'&&report.numPassedTests===25:outcome==='killed'&&failures.some(test=>test.name.includes(expected)&&/AssertionError|expect\(|Unable to find/.test(test.message));
  results.push({name,outcome,matched,expected,passed:report.numPassedTests,failures});writeFileSync(join(review,'mutations.json'),JSON.stringify(results,null,2)+'\n');
  process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);if(!matched)process.exitCode=1;
 }
}finally{
 writeFileSync(path,source);const sha256=createHash('sha256').update(readFileSync(path)).digest('hex');if(sha256!==createHash('sha256').update(source).digest('hex'))throw new Error('Restoration failed');
 writeFileSync(join(scratch,'state.json'),JSON.stringify({phase:'restored',path,sha256})+'\n');process.stdout.write(`Restored source; recovery ${scratch}\n`);
}
