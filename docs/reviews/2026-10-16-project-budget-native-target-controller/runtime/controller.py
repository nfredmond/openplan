#!/usr/bin/python3
"""One admitted finite native TARGET/HISTORY stage. Import performs no operation."""
import json
import os
from pathlib import Path
import re
import sys
import time

import journal as j
import policy as p
import sql as s

HERE = Path(__file__).resolve().parent
REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74')
ROOT = Path('/home/nathaniel/.local/state/openplan/project-budget-native-target-controller-20261016')
PACKET = REPO/'docs/reviews/2026-10-16-project-budget-native-target-controller'
ARCHIVE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump')
MIGRATIONS = REPO/'openplan/supabase/migrations'


def file_sha(path):
    import hashlib
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def bounded(path, limit=16777216):
    j.private(path)
    p.require(path.stat().st_size <= limit, 'file-bound')
    return path.read_bytes()


def source_seal():
    pins = json.loads((PACKET/'source-pins.json').read_bytes())
    for base, values in ((REPO, pins['source']), (PACKET, pins['runtime'])):
        for name, value in values.items():
            path = base/name
            p.require(path.is_file() and not path.is_symlink(), 'source-regular')
            p.same(value['sha256'], file_sha(path), 'source-sha:'+name)
            p.same(value['bytes'], path.stat().st_size, 'source-length:'+name)
    for name,value in pins['runtime'].items():
        path = HERE/Path(name).name
        p.require(not path.is_symlink(),'executing-template-symlink')
        p.same(value['sha256'],file_sha(path),'executing-template-sha')
    for name,value in pins['bindings'].items():
        p.same(value['sha256'],file_sha(PACKET/name),'binding-sha')
    p.same(file_sha(PACKET/'plan.json'),file_sha(ROOT/'plan.json'),'private-plan-exact-binding')
    # Exact git identity is also checked by a journaled fixed local read in run.
    return file_sha(PACKET/'source-pins.json')


def ready(stage, now=None):
    p.require(stage in p.STAGES, 'stage-name')
    j.private(ROOT, True)
    path = ROOT/'admissions'/(stage+'.json')
    p.require(path.is_file(), 'MISSING_ROOT_ADMISSION:'+stage)
    j.private(ROOT/'admissions', True)
    admission = j.read(path)
    plan = j.read(ROOT/'plan.json')
    parent = None
    if stage in p.PARENT:
        parent_path = ROOT/'stages'/p.PARENT[stage]/'complete.json'
        parent = j.read(parent_path)
        p.same('complete', parent.get('status'), 'predecessor-complete')
        p.same(p.PARENT[stage], parent.get('stage'), 'predecessor-stage')
        terminal = j.read(parent_path.parent/'manager-terminal.json')
        p.same('terminal-success', terminal.get('status'), 'predecessor-manager-terminal')
        p.same(parent['invocation'], terminal.get('invocation'), 'predecessor-invocation')
    package_sha = source_seal()
    p.admission(admission, stage, package_sha, file_sha(ROOT/'plan.json'),
                file_sha(parent_path) if parent else None, int(time.time()) if now is None else now)
    # These are concrete retained root records, not merely hash-shaped caller
    # strings. Same-user hostile forgery is outside this local mechanism.
    for folder,suffix,key in (('reviews','.md','reviewSHA256'),
                              ('publications','.json','publicationSHA256'),
                              ('windows','.json','windowSHA256')):
        record_path = ROOT/folder/(stage+suffix)
        j.private(record_path.parent,True)
        j.private(record_path)
        p.same(admission[key],file_sha(record_path),'actual-root-record-'+key)
    publication = j.read(ROOT/'publications'/(stage+'.json'))
    window = j.read(ROOT/'windows'/(stage+'.json'))
    for row in (publication,window):
        for key in ('stage','source','app','target','exclusive','nativeOperationGranted','notBefore','notAfter','inputSHA256'):
            p.same(admission[key],row.get(key),'root-publication-window-'+key)
    p.same(os.getuid(), admission['uid'], 'admission-local-uid')
    p.same(p.TARGET, plan.get('target'), 'plan-target')
    p.same('UNALLOCATED_NOT_AVAILABLE_UNADMITTED', plan.get('proposalStatus'), 'plan-proposal')
    p.same(p.SOURCE, plan.get('source'), 'plan-source')
    p.same(p.APP, plan.get('app'), 'plan-app')
    p.require(type(admission.get('originalScope')) is dict and bool(admission['originalScope']), 'admitted-original-scope')
    p.require(type(plan.get('versions')) is list and len(plan['versions']) == 422, 'plan-source-422')
    pins = json.loads((PACKET/'source-pins.json').read_bytes())
    versions = [Path(name).name.split('_')[0] for name in sorted(pins['source'])
                if name.startswith('openplan/supabase/migrations/')]
    p.same(versions,plan['versions'],'plan-exact-source-versions')
    p.require(set(('systemIdentifier','oid','sessionOid','currentOid','postgresOid')) <= set(admission.get('catalogIdentity',{})), 'admitted-complete-catalog-identity')
    if stage not in ('observe','allocate'):
        p.require(set(('systemIdentifier','oid','sessionOid','currentOid','postgresOid')) <= set(admission.get('targetIdentity',{})), 'admitted-complete-target-identity')
        allocated = j.read(ROOT/'stages/allocate/target.json')['identity']
        for key in ('systemIdentifier','oid','sessionOid','currentOid','postgresOid'):
            p.same(allocated[key],admission['targetIdentity'][key],'actual-allocation-pin-'+key)
    return plan, admission, parent


def resources():
    relative = next(line.split(':',2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
    root = Path('/sys/fs/cgroup')/relative.lstrip('/')
    value = {'memoryMax': int((root/'memory.max').read_text()),
             'swapMax': int((root/'memory.swap.max').read_text()),
             'cpuMax': (root/'cpu.max').read_text().strip(),
             'tasksMax': int((root/'pids.max').read_text())}
    p.resource(value)
    return value


class Controller:
    def __init__(self, stage, plan, admission, parent, path):
        self.stage = stage
        self.plan = plan
        self.a = admission
        self.parent = parent
        self.path = path
        self.t = j.Transport(path)
        self.catalog = admission.get('catalogIdentity', {})
        self.target = admission.get('targetIdentity', {})
        self.scope = admission.get('originalScope')

    def inspect(self):
        template = '{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"Project":{{json (index .Config.Labels "com.supabase.cli.project")}},"NetworkID":{{json (index .NetworkSettings.Networks "'+p.NETWORK+'" ).NetworkID}},"Running":{{json .State.Running}},"Paused":{{json .State.Paused}},"Restarting":{{json .State.Restarting}}}'
        row = json.loads(self.t.run(['/usr/bin/docker','inspect','--format',template,p.CONTAINER], limit=65536))
        p.container(row)
        return row

    def sql(self, query, *, catalog=False, identity=True):
        self.inspect()
        database = 'postgres' if catalog else p.TARGET
        expected = self.catalog if catalog else self.target
        header = "SET application_name='budget-target-history'; SET standard_conforming_strings=on;\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n"+s.BOUNDS+'\n'
        if identity:
            header += s.guard(expected, database)
        # No arbitrary operator SQL input. Callers are fixed code paths only.
        raw = self.t.run(p.argv('sql', database), (header+query+';\nROLLBACK;\n').encode(), timeout=90)
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        p.same(1, len(rows), 'sql-output-envelope')
        return rows[0]

    def native(self, catalog=False):
        row = self.sql(s.IDENTITY, catalog=catalog,
                       identity=not ((self.stage == 'observe' and catalog) or
                                     (self.stage == 'allocate' and not catalog and 'oid' not in self.target)))
        p.native(row, self.catalog if catalog else self.target, 'postgres' if catalog else p.TARGET)
        if self.stage != 'observe':
            same = self.catalog['systemIdentifier']
            p.same(same, row['systemIdentifier'], 'catalog-target-system')
        return row

    def original_scope(self):
        row = self.sql(s.SCOPE, catalog=True)
        if self.scope is not None:
            p.same(self.scope, row, 'protected-original-scope')
        return row

    def capture(self):
        # Complete raw migration rows, complete ordinary-table and sequence map,
        # actual public definitions and an outer-joined wanted projection census.
        query = s.SNAPSHOT.replace("SELECT jsonb_build_object('snapshot',(SELECT jsonb_object_agg(label,value ORDER BY label) FROM pg_temp.budget_snapshot));", '')
        query += "SELECT jsonb_build_object('identity',("+s.IDENTITY+"),'history',("+s.HISTORY_ROWS+"),'historyDigest',("+s.HISTORY_DIGEST+"),'statementProof',("+s.HISTORY_STATEMENTS+"),'snapshot',(SELECT jsonb_object_agg(label,value ORDER BY label) FROM pg_temp.budget_snapshot),'definitions',("+s.DEFINITIONS+"),'wanted',("+s.wanted_sql()+"),'properties',("+s.PROPERTIES+"))"
        row = self.sql(query)
        p.native(row['identity'], self.target, p.TARGET)
        expected_count = {'restore419':419,'apply17':420,'apply18':421,'apply19':422}.get(self.stage)
        p.history(row['history'], self.plan['versions'][:expected_count])
        self.validate_wanted(row['wanted'])
        for value in row['definitions'].values():
            value['sha256'] = p.digest(value['definition'].encode())
        return row

    @staticmethod
    def validate_wanted(rows):
        expected = {(role, table, col) for role in ('anon','authenticated','service_role','postgres')
                    for table, columns in s.WANTED.items() for col in columns}
        p.require(type(rows) is list, 'wanted-list')
        actual = [(r.get('role'),r.get('relation'),r.get('column')) for r in rows]
        p.same(len(expected), len(actual), 'wanted-count')
        p.same(expected, set(actual), 'wanted-complete-set')
        for row in rows:
            for field in ('roleMissing','relationMissing','attributeMissing'):
                p.same(False, row.get(field), 'wanted-'+field)
            for field in ('tableSelect','columnSelect'):
                p.require(type(row.get(field)) is bool, 'wanted-privilege-truth')
            for field in ('rawTableACL','rawColumnACL','effectiveTableACL','effectiveColumnACL'):
                p.require(field in row, 'wanted-acl-field')
        # This inventory records real effective truth. It does not admit ordinary
        # callers, infer EXECUTE or silently grant a denied SELECT.

    def compare_properties(self, row):
        p.same(self.a.get('expectedProperties'), row, 'actual-owner-locale-properties')

    def definitions(self, row, field):
        pins = self.a.get(field)
        p.require(type(pins) is dict and len(pins)>0, 'MISSING_REVIEWED_DEFINITION_PINS')
        # Root supplies the COMPLETE public function map, including explicit
        # owner/config/raw and effective ACL. Empty ACL arrays remain evidence.
        p.same(set(row),set(pins),'definition-complete-set')
        for name, expected in pins.items():
            p.require(name in row, 'missing-definition:'+name)
            p.require({'definition','sha256','owner','ownerOid','language','result','definer',
                       'volatility','config','rawACL','effectiveACL'} <= set(row[name]), 'definition-complete-fields')
            p.same(expected, row[name], 'installed-definition:'+name)

    def predecessor_state(self, state):
        path = ROOT/'stages'/p.PARENT[self.stage]/'state.json'
        previous = j.read(path)
        p.same(previous, state, 'actual-predecessor-state')
        self.definitions(state['definitions'], 'priorDefinitionPins')
        return previous

    def payload(self):
        if self.stage == 'restore419':
            raw = bounded(ROOT/'stages/render419/guarded-restore.sql', 134217728)
        elif self.stage.startswith('apply'):
            number = int(self.stage[5:])
            entry = self.plan['migrations'][str(number)]
            filename = {17:'20261017000017_portfolio_skip_invalid_classifications.sql',
                        18:'20261017000018_assistant_usage_limit_receipts.sql',
                        19:'20261017000019_project_budget_complete_inputs.sql'}[number]
            p.same(filename,entry['filename'],'migration-fixed-profile-file')
            p.same(Path(filename).stem.split('_',1)[1],entry['name'],'migration-fixed-profile-name')
            raw_source = (MIGRATIONS/entry['filename']).read_bytes()
            p.same(entry['sha256'], p.digest(raw_source), 'migration-source-pin')
            prior = j.read(ROOT/'stages'/p.PARENT[self.stage]/'state.json')
            raw = s.migration(raw_source, number, entry['name'], self.target, prior['historyDigest'])
        else:
            raw = p.canonical({'stage':self.stage,'argv':p.argv(self.stage)}) if self.stage in ('allocate','render419') else p.canonical({'stage':'observe','source':p.SOURCE,'target':p.TARGET})
        p.same(self.a['inputSHA256'], p.digest(raw), 'admitted-exact-input')
        return raw

    def mutate_sql(self, payload):
        self.inspect()
        raw = self.t.run(p.argv('sql'), payload, timeout=180, limit=1048576)
        values = [json.loads(line) for line in raw.splitlines() if line.strip()]
        p.require(values and values[-1].get('commitACK') is True, 'missing-real-commit-ack')
        p.positive(values[-1].get('pid'), 'commit-backend-pid')
        p.same(False, values[-1].get('inTransaction'), 'commit-envelope')
        if self.stage.startswith('apply'):
            p.same(2, len(values), 'migration-output-unknown')
            p.same(values[0]['pid'], values[-1]['pid'], 'commit-same-backend')
            p.same('postgres', values[0]['role'], 'actual-migration-role')
            p.require(type(values[0]['transactionID']) is str and values[0]['transactionID'].isdigit(), 'actual-transaction-id')
        else:
            p.same(1, len(values), 'restore-output-unknown')
        # The post-COMMIT SELECT is issued to the very same ON_ERROR_STOP psql
        # backend. It is custody of a real server response, not a precommit flag.
        j.record(self.path/'commit-ack.json', {'returned':values,'stdoutSHA256':p.digest(raw)})

    def run(self):
        # Revalidate source and actual commit/app before any native request.
        source_seal()
        self.t.run(['/usr/bin/git','-C',str(REPO),'merge-base','--is-ancestor',p.SOURCE,'HEAD'],limit=4096)
        value = self.t.run(['/usr/bin/git','-C',str(REPO),'rev-parse','HEAD:openplan'],limit=4096).decode().strip()
        p.same(p.APP,value,'actual-git-binding')
        self.t.run(['/usr/bin/git','-C',str(REPO),'diff','--quiet','HEAD','--','openplan'],limit=4096)
        payload = self.payload()
        j.write(self.path/'stage-input.bin', payload)
        self.inspect()
        catalog = self.native(catalog=True)
        scope = self.original_scope()
        j.record(self.path/'before-catalog.json', {'native':catalog,'originalScope':scope})
        if self.stage == 'observe':
            p.require(type(self.a.get('catalogIdentity')) is dict, 'admitted-catalog-identity')
            p.native(catalog,self.a['catalogIdentity'],'postgres')
            names = self.sql("SELECT coalesce(jsonb_agg(datname ORDER BY datname),'[]') FROM pg_database",catalog=True)
            p.require(p.TARGET not in names, 'target-already-exists')
            j.record(self.path/'observation.json',{'catalogIdentity':catalog,'originalScope':scope,'targetAbsent':True})
        elif self.stage == 'allocate':
            observed = j.read(ROOT/'stages/observe/observation.json')
            p.same(observed['originalScope'],scope,'allocation-scope-predecessor')
            for key in ('systemIdentifier','oid','sessionOid','currentOid','postgresOid'):
                p.same(observed['catalogIdentity'][key], catalog[key], 'allocation-observed-identity')
            names = self.sql("SELECT coalesce(jsonb_agg(datname ORDER BY datname),'[]') FROM pg_database",catalog=True)
            p.require(p.TARGET not in names,'allocation-existing-name')
            self.inspect()
            p.same(b'',self.t.run(p.argv('allocate'),timeout=90,limit=65536),'allocate-unknown-output')
            # OID does not exist before creation. Allocation admission pins the
            # cluster/actors, never predicts a future OID. Strict returned readback
            # becomes the root-reviewed target identity for the NEXT admission.
            self.target = {k:catalog[k] for k in ('systemIdentifier','sessionOid','currentOid','postgresOid')}
            native = self.native()
            self.target = {k:native[k] for k in ('systemIdentifier','oid','sessionOid','currentOid','postgresOid')}
            props = self.sql(s.PROPERTIES)
            expected = self.a.get('creationProperties')
            p.require(type(expected) is dict and set(expected)=={'owner','encoding','collate','ctype','localeProvider','icuLocale'},'allocation-property-fields')
            p.same(expected,{k:props[k] for k in expected},'allocation-actual-owner-locale')
            j.record(self.path/'target.json',{'identity':native,'properties':props})
        elif self.stage == 'render419':
            self.native()
            p.same({'schemas':[],'relations':0,'functions':0},self.sql(s.EMPTY),'render-empty-target')
            j.private(ARCHIVE)
            p.same(16232305,ARCHIVE.stat().st_size,'archive-bytes')
            p.same(p.ARCHIVE_SHA,file_sha(ARCHIVE),'archive-sha')
            j.record(self.path/'archive-binding.json',{'path':str(ARCHIVE),'sha256':p.ARCHIVE_SHA,'bytes':16232305})
            rendered = self.t.run(p.argv('render419'),input_file=ARCHIVE,timeout=120,limit=134217728)
            p.same(p.ARCHIVE_SHA,file_sha(ARCHIVE),'archive-after-sha')
            j.write(self.path/'rendered.sql',rendered)
            guarded = s.restore(rendered,self.target)
            j.write(self.path/'guarded-restore.sql',guarded)
            j.record(self.path/'render.json',{'renderedSHA256':p.digest(rendered),'guardedSHA256':p.digest(guarded),
                'nativeRestore':False,'requiresFreshRootReview':True})
        else:
            self.native()
            self.compare_properties(self.sql(s.PROPERTIES))
            if self.stage == 'restore419':
                p.same({'schemas':[],'relations':0,'functions':0},self.sql(s.EMPTY),'restore-empty-preflight')
            else:
                # Capture expects the *prior* version count before the mutation.
                number = int(self.stage[5:])
                saved = self.stage
                self.stage = 'restore419' if number==17 else 'apply'+str(number-1)
                try:
                    before = self.capture()
                finally:
                    self.stage = saved
                # Backend PID differs on independent observations. Everything
                # else, including full definitions and history, stays exact.
                before['identity'].pop('pid')
                previous = self.predecessor_state(before)
            self.mutate_sql(payload)
            after = self.capture()
            p.require(after['identity']['pid'] != j.read(self.path/'commit-ack.json')['returned'][-1]['pid'], 'independent-postreadback-backend')
            after['identity'].pop('pid')
            self.compare_properties(after['properties'])
            self.definitions(after['definitions'], 'postDefinitionPins')
            if self.stage == 'restore419':
                p.same(self.plan['baselineHistoryDigest'],after['historyDigest'],'restore419-history-digest')
                tables = {k:v for k,v in after['snapshot'].items() if isinstance(v,dict) and set(v)=={'count','digest'}}
                p.same(self.plan['baselineTables'],tables,'restore419-ordinary-table-map')
                p.same(self.plan['baselineSequencesCensus'],after['snapshot']['__pg_sequences__'],'restore419-sequences-census')
                # Explicit states are retained but have no independent donor map.
                j.record(self.path/'sequence-boundary.json',{'explicitStateCaptured':True,
                    'independentInitialLogCntIsCalledComparison':False})
            else:
                number = int(self.stage[5:])
                entry = self.plan['migrations'][str(number)]
                history = previous['history']+[{'version':'202610170000'+str(number),'name':entry['name'],
                    'statements':[(MIGRATIONS/entry['filename']).read_text()]}]
                p.same(history,after['history'],'atomic-complete-body-history-readback')
                proof = previous['statementProof']+[{'version':'202610170000'+str(number),
                    'cardinality':1,'dimensions':'[1:1]','sha256':[entry['sha256']]}]
                p.same(proof,after['statementProof'],'independent-history-statement-cardinality-sha')
                for field in ('snapshot',):
                    p.same({k:v for k,v in previous[field].items() if k!='supabase_migrations.schema_migrations'},
                           {k:v for k,v in after[field].items() if k!='supabase_migrations.schema_migrations'}, 'upgrade-existing-data-sequences')
            j.record(self.path/'state.json',after)
        p.same(scope,self.original_scope(),'final-original-scope')
        j.record(self.path/'complete.json', {'stage':self.stage,'status':'complete','source':p.SOURCE,'app':p.APP,
            'invocation':self.a['invocation'],'admissionSHA256':file_sha(ROOT/'admissions'/(self.stage+'.json')),
            'claim':'Only this native target/history stage. No ordinary caller, money, browser or full restore acceptance.'})


def main():
    os.umask(0o077)
    p.require(len(sys.argv)==3 and sys.argv[1]=='--run', 'usage-controller-run-fixed-stage')
    stage = sys.argv[2]
    plan, admission, parent = ready(stage)
    # Root owns the single finite manager unit and operating exclusion. This
    # controller never acquires a lock, starts a manager or launches successors.
    limits = resources()
    invocation = os.environ.get('INVOCATION_ID','')
    p.require(re.fullmatch('[a-f0-9]{32}',invocation) is not None,'actual-manager-invocation')
    p.same('openplan-budget-target-'+stage,admission.get('unitName'),'admitted-one-unit')
    admission = dict(admission,invocation=invocation)
    stages = ROOT/'stages'
    j.private(stages,True)
    # Every attempt reserves this exact stage before any external request. Even
    # a failed source check leaves a fence. There is no adopt/drop/cleanup entry.
    path = j.begin(stages,stage, {'stage':stage,'admissionSHA256':file_sha(ROOT/'admissions'/(stage+'.json')),
        'admission':admission,'planSHA256':file_sha(ROOT/'plan.json'),'packageSHA256':source_seal(),
        'uid':os.getuid(),'controllerPID':os.getpid(),'resources':limits,'retry':'FORBIDDEN'})
    try:
        Controller(stage,plan,admission,parent,path).run()
    except BaseException as error:
        j.record(path/'failure.json',{'errorType':type(error).__name__,
            'status':'FENCED_NO_REPLAY','backend':'UNKNOWN','commitACK':'inspect retained receipts'})
        raise


if __name__=='__main__':
    try:
        main()
    except BaseException:
        print('REFUSED: inspect private intent/streams; no replay',file=sys.stderr)
        raise SystemExit(1)
