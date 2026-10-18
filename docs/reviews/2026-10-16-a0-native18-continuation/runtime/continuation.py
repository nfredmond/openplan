"""Exact external actual map17 custody and source-based SQL18 descriptors."""
import hashlib
import json
from pathlib import Path
import policy as p

MAPROOT=Path('/home/nathaniel/.local/state/openplan/a0-predecessor-map-correction-20261016')
DECISION=Path('/home/nathaniel/.local/state/openplan/a0-map-apply17-root-decision-20261016')
COMPLETE_SHA='985e563b691ad8a063925363b9c350f96df02632852f22274c9a6ab73da32f2d'
MANAGER_SHA='372c0b72c03f1f80cdc7002c649043a009e59b48122a04d231b677d5e21574b3'
ADMISSION_SHA='8193d17f537cb64420ef95e54ea00f7fd94b06f893c473281a2ca24b66a4557e'
SNAPSHOT_SHA='b63c569f70e77dc6f01ff206967f69af1c17de9c3b9271b10fabed74228b73e7'
STDOUT_SHA='af07e643b91881210d59f8be36ebac9d798bbf6d5e695ade5596d6268683af65'


def read(path):return json.loads(path.read_bytes())


def selected(binding,path,private):
    descriptor=binding['files'].get(str(path))
    p.require(type(descriptor) is dict,'map17-unallowlisted-file')
    private(path)
    info=path.lstat();raw=path.read_bytes()
    actual={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}
    p.same(descriptor,actual,'map17-selected-custody')
    return raw


def retained_snapshot(bindings,private,typed_equal):
    binding=read(bindings/'continued-predecessor.json')
    path=DECISION/'actual-post-map.json'
    p.same(str(path),binding['snapshotPath'],'map17-snapshot-path')
    p.same(SNAPSHOT_SHA,binding['snapshotSHA256'],'map17-snapshot-binding')
    raw=selected(binding,path,private)
    p.same(SNAPSHOT_SHA,hashlib.sha256(raw).hexdigest(),'map17-snapshot-bytes')
    derived=json.loads(raw)
    request=MAPROOT/'stages/apply17/controller/request-025'
    p.same(str(request),binding['snapshotSourceRequest'],'map17-source-request-binding')
    p.same(str(request),derived['sourceRequest'],'map17-source-request')
    p.same(STDOUT_SHA,binding['snapshotSourceStdoutSHA256'],'map17-stdout-binding')
    p.same(STDOUT_SHA,derived['sourceStdoutSHA256'],'map17-derived-stdout')
    stdout=selected(binding,request/'stdout.bin',private)
    p.same(STDOUT_SHA,hashlib.sha256(stdout).hexdigest(),'map17-stdout-bytes')
    p.require(typed_equal(json.loads(stdout),derived['snapshot']),'map17-derivation-exact')
    return derived['snapshot']


def retained_history(bindings):
    # ready() pins this file before any native dispatch; apply() also requires
    # full exact map equality, including the history label, before body readiness.
    binding=read(bindings/'continued-predecessor.json')
    path=MAPROOT/'stages/apply17/history.json'
    raw=path.read_bytes()
    p.same(binding['files'][str(path)]['sha256'],hashlib.sha256(raw).hexdigest(),'map17-history-custody')
    return json.loads(raw)


def verify_predecessor(bindings,private,typed_equal):
    binding=read(bindings/'continued-predecessor.json')
    p.same(str(MAPROOT),binding['root'],'map17-root-binding')
    p.same('actual-new-map-apply17',binding['kind'],'map17-kind')
    p.same('apply17',binding['stage'],'map17-stage')
    p.same(COMPLETE_SHA,binding['completeSHA256'],'map17-complete-binding')
    p.same(MANAGER_SHA,binding['managerTerminalSHA256'],'map17-manager-binding')
    p.same(ADMISSION_SHA,binding['admissionSHA256'],'map17-admission-binding')
    for name in binding['files']:selected(binding,Path(name),private)
    for relative,expected,label in [('stages/apply17/complete.json',COMPLETE_SHA,'complete'),
        ('stages/apply17/manager-terminal.json',MANAGER_SHA,'manager'),('admissions/apply17.json',ADMISSION_SHA,'admission')]:
        p.same(expected,hashlib.sha256(selected(binding,MAPROOT/relative,private)).hexdigest(),'map17-'+label+'-bytes')
    p.predecessor(read(MAPROOT/'stages/apply17/complete.json'),'apply17')
    p.same({'stage':'apply17','status':'terminal'},read(MAPROOT/'stages/apply17/manager-terminal.json'),'map17-manager-terminal')
    p.same(ADMISSION_SHA,read(MAPROOT/'stages/apply17/intent.json')['admissionSHA256'],'map17-intent-admission')
    p.same(binding['originalR6BindingSHA256'],hashlib.sha256((bindings/'external-predecessor.json').read_bytes()).hexdigest(),'map17-original-r6-binding')
    p.same(binding['originalPlanSHA256'],hashlib.sha256((MAPROOT/'plan.json').read_bytes()).hexdigest(),'map17-original-plan')
    p.require(typed_equal(binding['target'],read(bindings/'external-predecessor.json')['target']),'map17-target-binding')
    retained_snapshot(bindings,private,typed_equal)
    return binding


def post_functions(actual,expectation,typed_equal):
    expected=expectation['functions']
    p.same(set(expected),set(actual),'post18-definition-set')
    for name,pin in expected.items():
        row=actual[name]
        p.same(set(pin)-{'bodySHA256'}|{'definition','sha256'},set(row),'post18-descriptor-fields')
        for key in ['body','owner','definer','volatility','config','acl','language','result']:
            p.require(typed_equal(pin[key],row.get(key)),'post18-'+key)
        p.same(pin['bodySHA256'],hashlib.sha256(row['body'].encode('utf-8')).hexdigest(),'post18-body-source-sha')
        p.same(row['sha256'],hashlib.sha256(row['definition'].encode('utf-8')).hexdigest(),'post18-definition-capture-sha')
