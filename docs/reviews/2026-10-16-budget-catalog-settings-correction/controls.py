"""Focused NEW schema2 controls. All contact is denied; execution needs a pure grant."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

ROOT = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016')
SERIAL = 0
INV = '11111111111111111111111111111111'
PID = 31337


def check(value, reason):
    if not value:
        raise AssertionError(reason)


def deny(event, args):
    if event.startswith(('subprocess.', 'socket.', 'os.exec', 'os.spawn',
                         'os.posix_spawn', 'os.fork', 'os.system', 'ctypes.dlopen')):
        raise AssertionError('FORBIDDEN_CONTACT:'+event)


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT/'work'/relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def modules():
    p = load('policy', 'runtime/policy.py')
    j = load('journal', 'runtime/journal.py')
    s = load('sql', 'runtime/sql.py')
    c = load('controller', 'runtime/controller.py')
    cap = load('capture_catalog', 'capture_catalog.py')
    builder = load('builder_under_test', 'build_observe_proposal.py')
    collector = load('collector_under_test', 'collector.py')
    return p, j, s, c, cap, builder, collector


def scope():
    return {'scopeSchema':'budget-protected-catalog-v2',
        'databases':[{'name':'postgres','oid':5,'owner':10,'acl':None,
                      'settings':{'rows':2,'digest':'a'*32}}],
        'roles':'b'*32,'memberships':'c'*32,'globalSettings':'d'*32}


def entry(p):
    return {'pid':PID,'uid':os.getuid(),'uids':[os.getuid()]*4,'invocation':INV,
            'controlGroup':'/user.slice/supplied-fixture.service',
            'resources':{'memoryMax':536870912,'swapMax':0,'cpuMax':'50000 100000','tasksMax':64}}


def manager_bytes(p, supplied, mode):
    values = {'Id':p.CAPTURE_UNIT+'.service','InvocationID':INV,'MainPID':str(PID),
        'ControlGroup':supplied['controlGroup'],'ActiveState':'active','SubState':'running',
        'RuntimeMaxUSec':'1min 30s','MemoryMax':'536870912','MemorySwapMax':'0',
        'CPUQuotaPerSecUSec':'500ms','TasksMax':'64'}
    changes = {'manager-pid':('MainPID','31338'), 'manager-inv':('InvocationID','2'*32),
        'manager-cgroup':('ControlGroup','/foreign.slice/unit'), 'manager-memory':('MemoryMax','1'),
        'manager-state':('SubState','start'), 'manager-runtime':('RuntimeMaxUSec','infinity')}
    if mode in changes:
        key, value = changes[mode]
        values[key] = value
    raw = ''.join(key+'='+value+'\n' for key,value in values.items()).encode()
    return raw+b'MainPID=31337\n' if mode == 'manager-duplicate' else raw


class SuppliedIO:
    """Replace process/FD surfaces only. No process, manager or SQL is contacted."""
    def __init__(self, p, j, response, supplied, mode, wrapper=None):
        self.p, self.j, self.response, self.supplied, self.mode = p,j,response,supplied,mode
        self.wrapper, self.calls, self.buffers, self.next_fd = wrapper, [], {}, 801
        self.saved = (j.subprocess.Popen,j.selectors.DefaultSelector,j.os.read,j.os.write,j.os.set_blocking,j.os.getpid)
    def __enter__(self):
        surface = self
        class Pipe:
            def __init__(self, data=b''):
                self.fd, self.closed = surface.next_fd, False
                surface.next_fd += 1
                surface.buffers[self.fd] = data
            def fileno(self):
                return self.fd
            def close(self):
                self.closed = True
        def popen(argv, **options):
            label, out, err = '', b'', b''
            if surface.wrapper is not None:
                check(argv == surface.wrapper, 'supplied-fixed-wrapper')
                label = 'wrapper'
                out = b'InvocationID=\nMemoryMax=infinity\n'
                err = ('Running as unit: '+surface.p.CAPTURE_UNIT+'.service'+
                       ('; invocation ID: '+INV if surface.mode == 'suffix' else '')+'\n'+
                       'Finished with result: success\n'+
                       'Main processes terminated with: code=exited, status=0/SUCCESS\n').encode()
                expected_env = surface.p.manager_env()
            elif argv == surface.p.manager_argv(surface.p.CAPTURE_UNIT):
                label, out = 'manager', manager_bytes(surface.p, surface.supplied, surface.mode)
                expected_env = surface.p.manager_env()
            elif argv == surface.p.absence_argv():
                label = 'absence'
                out = b'/nonexistent\n' if surface.mode == 'credential-present' else b''
                err = b'supplied find error\n' if surface.mode == 'absence-stderr' else b''
                expected_env = surface.p.ENV
            elif argv == surface.p.argv('sql','postgres'):
                label, out = 'query', surface.p.canonical(surface.response)
                expected_env = surface.p.ENV
                if surface.mode == 'native-warning':
                    err = b'WARNING: password file "/dev/null" is not a plain file\n'
            elif argv[:2] == ['/usr/bin/docker','inspect']:
                label = 'inspect'
                out = surface.p.canonical({'Id':surface.p.CONTAINER,'Image':surface.p.IMAGE,
                    'Name':'/supabase_db_'+surface.p.PROJECT,'Project':surface.p.PROJECT,
                    'NetworkID':surface.p.NETWORK_ID,'Running':True,'Paused':False,'Restarting':False})
                expected_env = surface.p.ENV
            else:
                raise AssertionError('UNPLANNED_SUPPLIED_ARGV')
            check(options['env'] == expected_env and options['close_fds'] is True,
                  'fixed-purpose-environment')
            surface.calls.append(label)
            proc = SimpleNamespace(pid=31400+len(surface.calls),stdin=Pipe(),stdout=Pipe(out),stderr=Pipe(err))
            proc.wait = lambda timeout: 1 if label == 'absence' and surface.mode == 'absence-nonzero' else 0
            return proc
        class Selector:
            def __init__(self):
                self.keys = {}
            def __enter__(self):
                return self
            def __exit__(self,*args):
                return False
            def register(self,pipe,events,label):
                self.keys[pipe.fd] = SimpleNamespace(fd=pipe.fd,fileobj=pipe,data=label)
            def unregister(self,pipe):
                del self.keys[pipe.fd]
            def get_map(self):
                return self.keys
            def select(self,timeout):
                return [(key,1) for key in list(self.keys.values())]
        def read(fd,count):
            check(fd in surface.buffers and count > 0, 'supplied-fd-read')
            data = surface.buffers[fd][:count]
            surface.buffers[fd] = surface.buffers[fd][count:]
            return data
        def write(fd,data):
            check(fd in surface.buffers, 'supplied-fd-write')
            surface.buffers[fd] += bytes(data)
            return len(data)
        self.j.os.getpid = lambda: PID  # SUPPLIED process identity, not the actual pure parent.
        self.j.subprocess.Popen, self.j.selectors.DefaultSelector = popen, Selector
        self.j.os.read, self.j.os.write = read, write
        self.j.os.set_blocking = lambda fd,value: check(fd in self.buffers and value is False,'supplied-fd-blocking')
        return self
    def __exit__(self,*args):
        (self.j.subprocess.Popen,self.j.selectors.DefaultSelector,self.j.os.read,
         self.j.os.write,self.j.os.set_blocking,self.j.os.getpid) = self.saved


def fixture(mods, mode):
    global SERIAL
    SERIAL += 1
    p,j,s,c,cap,builder,col = mods
    base = ROOT/'cases'/f'{SERIAL:03}-{mode}'
    base.mkdir(mode=0o700)
    for name in ('capture','runtime','packet','outer'):
        (base/name).mkdir(mode=0o700)
    (base/'packet/runtime').mkdir(mode=0o700)
    cap.ROOT, cap.SUBJECT, cap.RUNTIME_ROOT, cap.REPO = base/'capture',base/'packet',base/'runtime',base
    runtime = {}
    for name in ('controller.py','journal.py','policy.py','sql.py'):
        raw = (ROOT/'work/runtime'/name).read_bytes()
        for destination in (base/'runtime'/name,base/'packet/runtime'/name):
            destination.write_bytes(raw)
            destination.chmod(0o600)
        runtime[name] = cap.sha(base/'runtime'/name)
    cap.RUNTIME = runtime
    # Fixture source bindings are supplied. No actual422 donor corpus is copied.
    plan = (ROOT/'runtime-v2/plan.json').read_bytes()
    for destination in (base/'runtime/plan.json',base/'packet/plan.json'):
        destination.write_bytes(plan)
        destination.chmod(0o600)
    pins = {'source':{},'runtime':{},'bindings':{'plan.json':{'sha256':cap.sha(base/'packet/plan.json')}}}
    j.record(base/'packet/source-pins.json',pins)
    cap.SEAL = cap.sha(base/'packet/source-pins.json')
    names = ('capture_catalog.py','build_observe_proposal.py','observe-input.json',
             'observe-bindings.required.json','run-capture-window.sh')
    for name in names:
        source = ROOT/'work'/name if (ROOT/'work'/name).is_file() else ROOT/'capture-v2'/name
        destination = cap.ROOT/name
        destination.write_bytes(source.read_bytes())
        destination.chmod(0o600)
    j.write(cap.ROOT/'catalog-capture.sql',cap.query(s))
    inputs = {path.name:{'sha256':cap.sha(path),'bytes':path.stat().st_size}
              for path in cap.ROOT.iterdir()}
    argv = ['/bin/bash',str(cap.ROOT/'run-capture-window.sh')]
    request = {'inputs':inputs,'packageSHA256':cap.SEAL,'outerArgv':argv}
    j.record(cap.ROOT/'catalog-capture-request.json',request)
    now = int(time.time())
    common = {'schema':2,'stage':'catalog-capture-v2','packageSHA256':cap.SEAL,
        'requestSHA256':cap.sha(cap.ROOT/'catalog-capture-request.json'),'exclusive':True,
        'nativeOperationGranted':True,'uid':os.getuid(),'unitName':cap.UNIT,
        'notBefore':now-10,'notAfter':now+300,'fixture':'SUPPLIED_NOT_AUTHORITY'}
    j.record(cap.ROOT/'capture-window.json',common)
    j.write(cap.ROOT/'capture-review.md',b'SUPPLIED INERT REVIEW, NOT APPROVAL\n')
    j.record(cap.ROOT/'capture-grant.json',dict(common,
        reviewSHA256=cap.sha(cap.ROOT/'capture-review.md'),
        windowSHA256=cap.sha(cap.ROOT/'capture-window.json')))
    catalog = {'database':'postgres','oid':5,'systemIdentifier':'1234567890123','pid':1234,
        'sessionRole':'supabase_admin','currentRole':'supabase_admin','sessionOid':11,
        'currentOid':11,'postgresOid':10,'adminSuperuser':True,'postgresSuperuser':False,
        'applicationName':'budget-target-history','version':'170006'}
    supplied = entry(p)
    j.self_identity = lambda: supplied
    builder.ROOT, builder.SUBJECT, builder.SEAL = cap.ROOT,cap.SUBJECT,cap.SEAL
    builder.OUTER_ROOT, builder.CONTROLLER_ROOT = base/'outer',str(base/'runtime')
    col.ROOT, col.CAPTURE, col.RUNTIME = base/'outer',cap.ROOT,base/'runtime'
    col.REQUEST, col.ARGV, col.PACKAGE, col.RUNTIME_PINS = common['requestSHA256'],argv,cap.SEAL,runtime
    return base, supplied, {'catalogIdentity':catalog,'originalScope':scope(),'readOnly':'on'}


def assertion_refusal(call, expected, assertion):
    try:
        call()
    except ValueError as error:
        check(str(error) == expected, 'unexpected-refusal:'+str(error))
    else:
        raise AssertionError(assertion)


def projection(p,s,cap):
    query = cap.query(s).decode()
    check(query.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog;\n'),
          'catalog-read-only-intent')
    check('WHERE s.setdatabase=d.oid' in s.SETTINGS_SUMMARY
          and 'setrole<>' not in s.SETTINGS_SUMMARY and 'ORDER BY s.setrole' in s.SETTINGS_SUMMARY,
          'scope-all-setting-rows-covered')
    check("'rows',pg_catalog.count(*)::int8" in s.SETTINGS_SUMMARY
          and "'digest',pg_catalog.md5(" in s.SETTINGS_SUMMARY
          and "'row',pg_catalog.to_jsonb(s)" in s.SETTINGS_SUMMARY
          and 'pg_catalog.pg_typeof(s.setconfig)' in s.SETTINGS_SUMMARY
          and 'pg_catalog.array_dims(s.setconfig)' in s.SETTINGS_SUMMARY
          and 'jsonb_agg(to_jsonb(s)' not in s.SETTINGS_SUMMARY,
          'scope-no-setting-values-on-wire')
    check(s.SCOPE.count(s.SETTINGS_SUMMARY) == 1 and s.PROPERTIES.count(s.SETTINGS_SUMMARY) == 1,
          'same-summary-scope-and-properties')
    assertion_refusal(lambda:p.argv('sql','foreign_database'),'HELD_NON_CATALOG_COMMAND','scope-fixed-maintenance')
    for kind in ('allocate','render419','restore419'):
        assertion_refusal(lambda:p.argv(kind),'HELD_NON_CATALOG_COMMAND','noncatalog-remains-held')


def authorize_collector(cap,col):
    facts = {key:cap.sha(cap.ROOT/name) for key,name in (
        ('captureGrantSHA256','capture-grant.json'),('captureReviewSHA256','capture-review.md'),
        ('captureWindowSHA256','capture-window.json'))}
    grant = col.read(cap.ROOT/'capture-grant.json')
    col.record(col.ROOT/'collector-authorization.json',dict(facts,requestSHA256=col.REQUEST,
        collectorSHA256=col.sha(Path(col.__file__)),nativeOperationGranted=True,exclusive=True,
        uid=os.getuid(),notBefore=grant['notBefore'],notAfter=grant['notAfter']))
    col.record(col.ROOT/'root-outer-intent.json',dict(facts,requestSHA256=col.REQUEST,
        collectorSHA256=col.sha(Path(col.__file__)),
        collectorAuthorizationSHA256=col.sha(col.ROOT/'collector-authorization.json'),
        argv=col.ARGV,unitName=col.UNIT,retry='FORBIDDEN',deadlineSeconds=col.DEADLINE,
        stdoutLimit=col.BOUNDS['stdout'],stderrLimit=col.BOUNDS['stderr']))


def proposal_inputs(p,j,cap,builder,col, bad=None):
    capture = j.read(cap.ROOT/'capture-attempt/complete.json')
    common = {'status':'terminal-success','invocation':INV,'unitName':cap.UNIT,
              'requestSHA256':capture['requestSHA256'],'returncode':0}
    for name in ('capture-manager-terminal.json','capture-outer-terminal.json'):
        value = dict(common)
        if bad == name:
            value['status'] = 'unknown'
        j.record(cap.ROOT/name,value)
    if not (col.ROOT/'native-capture-parent').exists():
        (col.ROOT/'native-capture-parent').mkdir(mode=0o700)
        j.record(col.ROOT/'native-capture-parent/terminal.json',{'returncode':0,'failure':None})
        j.record(col.ROOT/'native-capture-parent/complete.json',{
            'status':'collected-correlated-capture','invocation':INV,
            'captureManagerAckSHA256':cap.sha(cap.ROOT/'capture-attempt/manager-ack.json'),
            'captureCompleteSHA256':cap.sha(cap.ROOT/'capture-attempt/complete.json'),
            'outerTerminalSHA256':cap.sha(col.ROOT/'native-capture-parent/terminal.json')})
    j.write(cap.ROOT/'observe-review.md',b'SUPPLIED PROPOSAL REVIEW, NOT ADMISSION\n')
    now = int(time.time())
    proposal = {'stage':'observe','source':p.SOURCE,'app':p.APP,'target':p.TARGET,
        'exclusive':False,'nativeOperationGranted':False,'notBefore':now+60,'notAfter':now+360,
        'inputSHA256':cap.sha(cap.ROOT/'observe-input.json')}
    for name in ('observe-window.json','observe-publication.json'):
        j.record(cap.ROOT/name,proposal)
    paths = {'catalogSHA256':cap.ROOT/'capture-attempt/catalog.json',
        'scopeSHA256':cap.ROOT/'capture-attempt/original-scope.json',
        'captureCompleteSHA256':cap.ROOT/'capture-attempt/complete.json',
        'captureManagerAckSHA256':cap.ROOT/'capture-attempt/manager-ack.json',
        'captureCollectedSHA256':col.ROOT/'native-capture-parent/complete.json',
        'captureManagerTerminalSHA256':cap.ROOT/'capture-manager-terminal.json',
        'captureOuterTerminalSHA256':cap.ROOT/'capture-outer-terminal.json',
        'reviewSHA256':cap.ROOT/'observe-review.md','windowSHA256':cap.ROOT/'observe-window.json',
        'publicationSHA256':cap.ROOT/'observe-publication.json','inputSHA256':cap.ROOT/'observe-input.json',
        'packageSHA256':cap.SUBJECT/'source-pins.json','planSHA256':cap.SUBJECT/'plan.json'}
    bindings = {key:cap.sha(path) for key,path in paths.items()}
    j.record(cap.ROOT/'observe-bindings.actual.json',dict(bindings,
        independentReviewCommit=builder.REVIEW,metadataResponseCommit=builder.RESPONSE))


def case(mode='baseline'):
    mods = modules()
    p,j,s,c,cap,builder,col = mods
    base,supplied,response = fixture(mods,mode)
    projection(p,s,cap)
    if mode == 'scope-equality':
        changed = scope()
        changed['databases'][0]['settings']['digest'] = 'e'*32
        obj = c.Controller('observe',{}, {'originalScope':scope()},None,base)
        calls = []
        obj.sql = lambda query,**options: (calls.append((query,options)) or changed)
        assertion_refusal(obj.original_scope,'protected-original-scope','scope-full-v2-equality')
        check(calls == [(s.SCOPE,{'catalog':True})], 'scope-selected-projection')
        return
    sys.argv = ['capture_catalog.py','--capture-once']
    refusals = {'credential-present':('credential-directory-must-be-absent','credential-present-stops-before-query'),
        'manager-pid':('manager-main-pid','manager-ack-independent-identity'),
        'manager-inv':('manager-invocation','manager-invalid-inv-refused'),
        'manager-cgroup':('manager-control-group','manager-invalid-cgroup-refused'),
        'manager-memory':('manager-resource-MemoryMax','manager-invalid-resource-refused'),
        'manager-state':('manager-running','manager-invalid-state-refused'),
        'manager-runtime':('manager-duration-token','manager-invalid-duration-refused'),
        'manager-duplicate':('manager-property-unique','manager-duplicate-refused'),
        'absence-stderr':('transport-unknown-stderr','absence-stderr-stops-before-query'),
        'absence-nonzero':('transport-nonzero','absence-nonzero-stops-before-query'),
        'native-warning':('transport-unknown-stderr','native-warning-remains-refused')}
    with SuppliedIO(p,j,response,supplied,mode) as surface:
        if mode in refusals:
            assertion_refusal(cap.main,*refusals[mode])
            check(not (cap.ROOT/'capture-attempt/complete.json').exists(),'refused-no-capture-complete')
            if mode in ('credential-present','absence-stderr','absence-nonzero'):
                check('query' not in surface.calls,'credential-present-stops-before-query')
            return
        cap.main()
        check(surface.calls == ['manager','inspect','absence','query','inspect'],'one-fixed-capture-sequence')
    if mode == 'builder-ackhash' or mode == 'collector-ackhash':
        path = cap.ROOT/'capture-attempt/complete.json'
        value = j.read(path)
        value['managerAckSHA256'] = 'f'*64
        path.write_bytes(p.canonical(value))
    if mode.startswith('builder-') or mode == 'baseline':
        bad = {'builder-manager':'capture-manager-terminal.json',
               'builder-outer':'capture-outer-terminal.json'}.get(mode)
        proposal_inputs(p,j,cap,builder,col,bad)
        sys.argv = ['build_observe_proposal.py','--prepare-only']
        if bad:
            assertion_refusal(builder.main,'capture-parent-terminal',
                'proposal-manager-terminal-correlated' if mode == 'builder-manager'
                else 'proposal-outer-terminal-correlated')
        elif mode == 'builder-ackhash':
            assertion_refusal(builder.main,'capture-ack-hash','proposal-manager-ack-hash-bound')
        else:
            builder.main()
            proposed = j.read(cap.ROOT/'observe-proposal.json')
            check(proposed['admissionProposal']['nativeOperationGranted'] is False and
                  proposed['admissionProposal']['exclusive'] is False and
                  proposed['admissionProposal']['scopeSchema'] == p.SCOPE_SCHEMA,'proposal-remains-unadmitted')
        return
    if mode == 'child-only':
        (cap.ROOT/'capture-attempt/manager-ack.json').rename(
            cap.ROOT/'capture-attempt/manager-ack.supplied-omitted.json')
    authorize_collector(cap,col)
    sys.argv = ['collector.py','--collect-once']
    with SuppliedIO(p,j,response,supplied,mode,wrapper=col.ARGV):
        if mode == 'child-only':
            try:
                col.main()
            except FileNotFoundError as error:
                check(error.filename == str(cap.ROOT/'capture-attempt/manager-ack.json'),
                      'missing-ack-exact-path')
            else:
                raise AssertionError('child-only-identity-refused')
        elif mode == 'collector-ackhash':
            assertion_refusal(col.main,'capture-manager-ack-hash','manager-ack-hash-bound-to-complete')
        else:
            col.main()
            collected = col.read(col.ROOT/'native-capture-parent/complete.json')
            check(collected['invocation'] == INV and collected['postShow'] ==
                  'RAW_RETAINED_UNBOUND_FOR_IDENTITY_AND_LIMITS','independent-ack-with-optional-start-suffix')


def typed_cases():
    p,j,s,c,cap,builder,col = modules()
    for field,value,reason in [('scopeSchema',1,'scope-v2-version'),
            ('databases',[],'scope-v2-databases')]:
        row = scope()
        row[field] = value
        assertion_refusal(lambda:p.scope(row),reason,'typed-scope-refused')
    for value,reason in [({'rows':True,'digest':'a'*32},'scope-settings-count'),
            ({'rows':1,'digest':None},'scope-settings-digest'),
            ({'rows':0,'digest':'a'*32},'scope-zero-settings-digest'),
            ({'rows':1,'digest':'a'*32,'setconfig':['SECRET_CANARY']},'scope-settings-fields')]:
        row = scope()
        row['databases'][0]['settings'] = value
        assertion_refusal(lambda:p.scope(row),reason,'typed-settings-refused')
    p.settings({'rows':0,'digest':'d41d8cd98f00b204e9800998ecf8427e'})
    assertion_refusal(lambda:c.ready('allocate'),'HELD_NON_OBSERVE_STAGE','allocation-remains-held')
    obj = c.Controller('observe',{}, {'originalScope':scope()},None,ROOT)
    assertion_refusal(obj.capture,'HELD_TARGET_CAPTURE_CONFIG_ASSESSMENT','target-config-capture-remains-held')
    assertion_refusal(lambda:obj.sql(s.PROPERTIES,catalog=False),
                      'HELD_NON_CATALOG_QUERY','target-properties-remain-held')
    assertion_refusal(lambda:obj.sql('SELECT foreign',catalog=True),
                      'HELD_NON_CATALOG_QUERY','foreign-query-remains-held')
    assertion_refusal(lambda:p.manager_argv('foreign.service'),
                      'manager-fixed-owned-unit','foreign-manager-unit-refused')
    supplied = entry(p)
    supplied['uids'][1] += 1
    props = p.manager_properties(manager_bytes(p,entry(p),'baseline'))
    assertion_refusal(lambda:p.manager_binding(props,supplied,p.CAPTURE_UNIT,90),
                      'manager-kernel-uids','typed-manager-uid-refused')


def baseline():
    typed_cases()
    for mode in ('baseline','scope-equality','credential-present','manager-pid','manager-inv',
                 'manager-cgroup','manager-memory','manager-state','manager-runtime','manager-duplicate',
                 'absence-stderr','absence-nonzero','native-warning','missing-suffix','suffix','child-only','collector-ackhash','builder-ackhash',
                 'builder-manager','builder-outer'):
        case(mode)


def run(record):
    sys.addaudithook(deny)
    names = ('runtime/controller.py','runtime/journal.py','runtime/policy.py','runtime/sql.py',
             'capture_catalog.py','build_observe_proposal.py','collector.py')
    originals = {name:((ROOT/'source'/name).read_bytes(),(ROOT/'source'/name).stat().st_mode & 0o777)
                 for name in names}
    result = {'status':'RUNNING','surface':'SUPPLIED_IDENTITIES_BINDINGS_PROCESS_FD_ONLY','faults':[]}
    saved_argv, saved_path = sys.argv[:], sys.path[:]
    saved_modules = {name:sys.modules.get(name) for name in
                     ('policy','journal','sql','controller','capture_catalog','builder_under_test','collector_under_test')}
    try:
        baseline()
        result['baseline'] = 'PASS'
        work = ROOT/'work/capture_catalog.py'
        work.write_bytes(originals['capture_catalog.py'][0]+b'\n# Harmless schema2 capture annotation.\n')
        baseline()
        result['harmless'] = 'SURVIVED'
        work.write_bytes(originals['capture_catalog.py'][0])
        for fault in json.loads((ROOT/'mutations.json').read_bytes()):
            observations = []
            try:
                for edit in fault['edits']:
                    raw = originals[edit['file']][0].decode()
                    check(raw.count(edit['old']) == 1,'unique-anchor:'+fault['name'])
                    (ROOT/'work'/edit['file']).write_text(raw.replace(edit['old'],edit['new'],1))
                for test in fault['tests']:
                    try:
                        case(test['mode'])
                    except AssertionError as error:
                        check(str(error) == test['reason'],'unexpected-mutant-assertion:'+str(error))
                        observations.append({'reason':str(error),'result':'KILLED'})
                    else:
                        raise AssertionError('mutation-survived:'+fault['name'])
            finally:
                for name,(raw,mode) in originals.items():
                    (ROOT/'work'/name).write_bytes(raw)
                    (ROOT/'work'/name).chmod(mode)
            result['faults'].append({'name':fault['name'],'observations':observations})
        baseline()
        result.update(status='PASS_SELECTED_SCHEMA2_INERT_CONTROLS',restoredBaseline='PASS')
    finally:
        sys.argv, sys.path[:] = saved_argv, saved_path
        for name,value in saved_modules.items():
            if value is None:
                sys.modules.pop(name,None)
            else:
                sys.modules[name] = value
        for name,(raw,mode) in originals.items():
            (ROOT/'work'/name).write_bytes(raw)
            (ROOT/'work'/name).chmod(mode)
        result['exactRestoration'] = all((ROOT/'work'/name).read_bytes() == raw and
            (ROOT/'work'/name).stat().st_mode & 0o777 == mode for name,(raw,mode) in originals.items())
        result['sourceExact'] = all((ROOT/'source'/name).read_bytes() == raw and
            (ROOT/'source'/name).stat().st_mode & 0o777 == mode for name,(raw,mode) in originals.items())
        # Use the immutable, already loaded runner writer; no subject import in finally.
        record(ROOT/'pure-attempt/controls.json',result)
    check(result['exactRestoration'] and result['sourceExact'],'exact-schema2-restoration')
