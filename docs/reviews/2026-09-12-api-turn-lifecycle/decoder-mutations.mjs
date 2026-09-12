import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const review=fileURLToPath(new URL('.',import.meta.url));
const app=resolve(review,'../../../openplan');
const path=join(app,'src/lib/assistant/provider-server.ts');
const source=readFileSync(path,'utf8');
const scratch=mkdtempSync(join(tmpdir(),'openplan-api-decoder-mutations-'));
const backup=join(scratch,'provider-server.ts');
writeFileSync(backup,source,{mode:0o600});
const state=join(scratch,'state.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
const projection=source.match(/export const PROVIDER_TURN_COLUMNS = .*;/)?.[0];
if(!projection)throw new Error('Missing projection');
const fields=['user_id','api_connection_id','api_revision_id','api_configuration_canonical','api_configuration_hash','api_charge_ack'];
const changes=[
  ['harmless-comment','export function checkedProviderTurn','// Retained turn decoding.\nexport function checkedProviderTurn',null],
  ...fields.map(field=>[`projection-${field}`,projection,projection.replace(new RegExp(`,${field}(?=[,"])`),''),'exact saved configuration and owner']),
  ['owner-required','provider: z.literal("api_connection"), user_id: z.string().uuid()','provider: z.literal("api_connection"), user_id: z.string().uuid().optional()','missing API user_id'],
  ...[
    ['api_connection_id','z.string().uuid()'],['api_revision_id','z.string().uuid()'],
    ['api_configuration_canonical','z.string().max(32_000)'],
    ['api_configuration_hash','z.string().regex(/^[a-f0-9]{64}$/)'],['api_charge_ack','z.literal(true)'],
  ].map(([field,schema])=>[`required-${field}`,`${field}: ${schema}`,`${field}: ${schema}.optional()`,`missing API ${field}`]),
  ['native-reference','user_id: z.string().uuid(), connection_id: z.null()','user_id: z.string().uuid(), connection_id: z.string().uuid().nullable()','native connection token reference'],
  ['charge-ack','api_charge_ack: z.literal(true)','api_charge_ack: z.boolean()','false charge acknowledgement'],
  ['auth-enum','z.enum(["connection_api_key", "connection_no_key"])','z.enum(["connection_api_key", "connection_no_key", "deployment_api_key"])','keyless mode'],
  ...fields.filter(field=>field!=='user_id').map(field=>[`legacy-${field}`,`${field}: z.null().optional()`,`${field}: z.unknown().optional()`,'preserves legacy codex']),
  ['config-hash','createHash("sha256").update(turn.api_configuration_canonical).digest("hex") !== turn.api_configuration_hash','false','invalid retained API hash'],
  ['config-model','!configuration.modelIds.includes(turn.model_id)','false','invalid retained API model'],
  ['config-auth','turn.auth_mode !==\n        (configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key")','false','invalid retained API mode'],
  ['config-schema','providerApiConfigurationSchema.parse(JSON.parse(turn.api_configuration_canonical))','JSON.parse(turn.api_configuration_canonical)','invalid retained API protocol'],
  ['packet-workspace','packet.workspaceId !== turn.workspace_id','false','foreign or tampered project packet'],
  ['packet-project','packet.project.id !== turn.project_id','false','foreign or tampered project packet'],
  ['packet-hash','createHash("sha256").update(turn.packet_canonical).digest("hex") !== turn.packet_hash','false','foreign or tampered project packet'],
];
const results=[];
try{
  for(const [name,before,after,expectedFailure] of changes){
    if(source.split(before).length!==2||before===after)throw new Error(`Invalid mutation anchor: ${name}`);
    writeFileSync(state,JSON.stringify({phase:'mutating',name,path,backup})+'\n');
    writeFileSync(path,source.replace(before,after));
    const output=join(scratch,`${name}.json`);
    const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/provider-api-retained-turn.test.ts','--reporter=json',`--outputFile=${output}`],{cwd:app,encoding:'utf8',timeout:30_000});
    const report=JSON.parse(readFileSync(output,'utf8'));
    const failures=report.testResults.flatMap(file=>file.assertionResults.filter(test=>test.status==='failed').map(test=>({name:test.fullName,message:test.failureMessages.join('\n').slice(0,1800)})));
    if(report.numTotalTests!==19||(run.status!==0&&failures.length===0))throw new Error(`Invalid test execution: ${name}`);
    const outcome=run.status===0?'survived':'killed';
    const matched=expectedFailure===null?outcome==='survived':outcome==='killed'&&failures.some(test=>test.name.includes(expectedFailure)&&/AssertionError/.test(test.message));
    results.push({name,outcome,expectedFailure,matched,failures});
    writeFileSync(join(review,'decoder-mutations.json'),JSON.stringify(results,null,2)+'\n');
    process.stdout.write(`${name}: ${outcome}${matched?'':' UNEXPECTED'}\n`);
    if(!matched)process.exitCode=1;
  }
}finally{
  writeFileSync(path,source);
  if(hash(readFileSync(path,'utf8'))!==hash(source))throw new Error('Source restoration failed');
  writeFileSync(state,JSON.stringify({phase:'restored',path,backup,sha256:hash(source)})+'\n');
  process.stdout.write(`Restored source; recovery state: ${state}\n`);
}
