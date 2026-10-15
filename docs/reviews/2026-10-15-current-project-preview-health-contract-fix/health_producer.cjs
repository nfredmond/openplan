/** Offline fixture: transpile the pinned actual route and its actual identity helpers. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const vm = require('node:vm');
const ts = require('/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules/typescript');
const repo = '/home/nathaniel/.t3/worktrees/openplan/t3-f129cb09';
const head = '67828c17c4c270529468eef1edd144e4a52b693a';
const paths = {
  route:'openplan/src/app/api/health/route.ts',
  identity:'openplan/src/lib/runtime/app-version.ts',
  migrations:'openplan/src/lib/ops/migration-manifest.ts',
  package:'openplan/package.json',
};
function git(args) {return execFileSync('/usr/bin/git', ['-C',repo,...args], {encoding:'utf8'});}
const sources = Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,git(['show',head+':'+path])]));
const versions = git(['ls-tree','-r','--name-only',head,'openplan/supabase/migrations']).trim().split('\n')
  .map(path=>path.split('/').at(-1).match(/^([0-9]+)_.*\.sql$/)?.[1]).filter(Boolean).sort();
assert.equal(new Set(versions).size,419);
assert.equal(versions.at(-1),'20261017000016');
const initialBytes = JSON.stringify(sources);

// These adapters replace Next's response object and unavailable build-time injection.
// They do not replace appCommitSha, safeCommitSha, expectedMigrations or GET.
function produce(input=sources, env={OPENPLAN_COMMIT_SHA:head,OPENPLAN_BUILD_MIGRATION_VERSIONS:versions.join(',')}) {
  assert.equal(Object.hasOwn(env,'VERCEL_GIT_COMMIT_SHA'),false);
  function compile(source,filename,modules) {
    const module = {exports:{}};
    const requireAdapter = name=>{
      assert.ok(Object.hasOwn(modules,name),'unexpected-module:'+name);
      return modules[name];
    };
    const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(output,{module,exports:module.exports,require:requireAdapter,process:{env}},{filename});
    return module.exports;
  }
  const identity = compile(input.identity,paths.identity,{'../../../package.json':JSON.parse(input.package)});
  const migrations = compile(input.migrations,paths.migrations,{});
  class NextResponse {
    constructor(body,init) {this.body=body;this.status=init.status;this.headers=init.headers;}
    static json(body,init) {return new NextResponse(body,init);}
  }
  const route = compile(input.route,paths.route,{
    'next/server':{NextResponse},'@/lib/ops/migration-manifest':migrations,'@/lib/runtime/app-version':identity,
  });
  const response = route.GET();
  assert.equal(response.status,200);
  assert.equal(response.headers['Cache-Control'],'no-store, max-age=0');
  return {payload:JSON.parse(JSON.stringify(response.body)),appCommitSha:identity.appCommitSha()};
}
function check(input) {
  const actual = produce(input);
  assert.equal(actual.appCommitSha,head,'full environment identity');
  assert.equal(actual.payload.deployment.commit,head.slice(0,12),'actual route twelve-character contract');
  assert.deepEqual(actual.payload.deployment.migrations,{expected:419,latest:'20261017000016'});
  const padded=produce(input,{OPENPLAN_COMMIT_SHA:'  '+head.toUpperCase()+'  ',OPENPLAN_BUILD_MIGRATION_VERSIONS:versions.join(',')});
  assert.equal(padded.appCommitSha,head.toUpperCase(),'actual helper trims');
  assert.equal(padded.payload.deployment.commit,head.slice(0,12),'actual safeCommitSha trims and lowercases');
  return actual;
}
const baseline = check(sources);
const mutations=[];
for (const [name,input,reason] of [
  ['harmless producer comment',{...sources,route:sources.route+'\n// Harmless fixture comment.\n'},null],
  ['producer emits seven characters',{...sources,route:sources.route.replace('trimmed.slice(0, 12)','trimmed.slice(0, 7)')},'actual route twelve-character contract'],
  ['producer drops self-hosted identity',{...sources,identity:sources.identity.replace('process.env.OPENPLAN_COMMIT_SHA?.trim()','undefined')},'full environment identity'],
]) {
  assert.notEqual(JSON.stringify(input),initialBytes);
  try {check(input);assert.equal(reason,null,'producer fault survived');mutations.push({mutation:name,outcome:'survived'});}
  catch(error) {assert.ok(reason && error.message.includes(reason),error.message);mutations.push({mutation:name,outcome:'detected',reason});}
  finally {assert.equal(JSON.stringify(sources),initialBytes);}
}
check(sources);
const old=produce(sources,{OPENPLAN_COMMIT_SHA:'06a108010ab39aa42eed4c2bcda3e1371b8aa813',OPENPLAN_BUILD_MIGRATION_VERSIONS:versions.join(',')});
const unknown=produce(sources,{OPENPLAN_BUILD_MIGRATION_VERSIONS:versions.join(',')});
const migrationError=produce(sources,{OPENPLAN_COMMIT_SHA:head,OPENPLAN_BUILD_MIGRATION_VERSIONS:'invalid'});
assert.equal(old.payload.deployment.commit,'06a108010ab3');
assert.equal(unknown.payload.deployment.commit,'unknown');
assert.equal(migrationError.payload.deployment.migrations,null);
console.log(JSON.stringify({baseline,old,unknown,migrationError,mutations,restored:true,
  sourceCommit:head,sourceHashes:Object.fromEntries(Object.entries(sources).map(([key,value])=>[paths[key],crypto.createHash('sha256').update(value).digest('hex')])),
  adapters:['NextResponse response object only','build-time OPENPLAN_BUILD_MIGRATION_VERSIONS from pinned git filenames'],
  limits:'No Next server, build, HTTP transport, installed schema census or live process evidence.'}));
