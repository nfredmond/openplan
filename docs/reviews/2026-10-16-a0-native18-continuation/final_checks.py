"""Finite pure custody/refusal checks. All external subject Popen is denied."""
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-native18-continuation-20261016')
OLD=ROOT.with_name('a0-usage-limit-native-wrapper-20261016-r6')


def check(value,label):
    if not value:raise AssertionError(label)


def main():
    os.umask(0o077)
    sys.path.insert(0,str(ROOT/'templates'))
    c=importlib.import_module('controller')
    c.sources()
    check(not os.path.lexists(ROOT/'admissions') and not os.path.lexists(ROOT/'stages'),'real-admission-stage-absence')
    check(not os.path.lexists(OLD/'admissions/apply17.json') and not os.path.lexists(OLD/'stages/apply17'),'old17-absence')
    def denied(*args,**kwargs):raise AssertionError('unplanned-external-Popen')
    saved=c.j.subprocess.Popen;c.j.subprocess.Popen=denied
    try:
        try:c.launch('apply18')
        except ValueError as error:check(str(error)=='MISSING_ROOT_ADMISSION:apply18','real-missing-admission-code')
        else:raise AssertionError('missing-admission-accepted')
    finally:c.j.subprocess.Popen=saved
    pins=json.loads((ROOT/'selected-before.json').read_text())
    for name,expected in pins.items():
        path=Path(name);info=path.lstat()
        actual={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':info.st_size,
                'mode':info.st_mode & 0o777,'uid':info.st_uid,'gid':info.st_gid}
        check(not path.is_symlink() and actual==expected,'selected-custody:'+name)
    inherited=[]
    prior=ROOT.with_name('a0-migration-history-literal-correction-20261016')
    for path in sorted((HERE/'runtime').rglob('*')):
        if not path.is_file():continue
        relative=path.relative_to(HERE/'runtime')
        check(path.read_bytes()==(ROOT/'templates'/relative).read_bytes(),'new-source-template-equality')
        if str(relative) not in ['controller.py','literal_history.py','continuation.py']:
            check(path.read_bytes()==(OLD/'templates'/relative).read_bytes(),'unchanged-r6-runtime:'+str(relative))
            inherited.append(str(relative))
        if str(relative)=='literal_history.py':
            previous=(prior/'templates'/relative).read_text()
            previous=previous.replace('20261017000017','20261017000018').replace('portfolio_skip_invalid_classifications','assistant_usage_limit_receipts').replace('b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b','655e625878b3e62f332a7f17d6e126879813cc2bf881ca745593978d8eed6559')
            check(path.read_text()==previous,'hex-phase-history-only18-rebinding')
    expected=c.read(ROOT/'bindings/expected-post-functions.json')
    raw=(c.REPO/c.SQL18).read_bytes()
    check(hashlib.sha256(raw).hexdigest()==expected['sourceSHA256'],'post-function-original-source')
    bodies=['\n'+part.split('$$;',1)[0] for part in raw.decode().split('AS $$\n')[1:]]
    check(len(bodies)==2,'two-source-function-bodies')
    for name,pin in expected['functions'].items():
        check(pin['body'] in bodies and pin['bodySHA256']==hashlib.sha256(pin['body'].encode()).hexdigest(),'post-body-independent-source-oracle')
    check(c.STAGES==['apply18'],'only18-stage')
    syntax=[]
    for path in sorted(HERE.rglob('*.py')):
        compile(path.read_bytes(),str(path),'exec');syntax.append(str(path.relative_to(HERE)))
    sourcepins=json.loads((ROOT/'bindings/source-pins.json').read_text())['files']
    migrations=[x for x in sourcepins if x.startswith('openplan/supabase/migrations/')]
    check(len(migrations)==421,'all421-source-migrations')
    snapshot=c.co.DECISION/'actual-post-map.json'
    check(hashlib.sha256(snapshot.read_bytes()).hexdigest()==c.co.SNAPSHOT_SHA,'retained-post17-map-custody')
    import window
    original=(HERE/'window.py').read_text()
    resource={'memory.max':'536870912','memory.swap.max':'0','cpu.max':'50000 100000','pids.max':'64'}
    controls=[]
    for label,subject in [('baseline',original),('harmless',original.replace('One nonblocking shared compiler acquisition','One finite nonblocking shared compiler acquisition')),
                          ('resource-omitted',original.replace("raise ValueError('test-resource-refusal')",'pass')),
                          ('restored',original)]:
        namespace={'__file__':str(HERE/'window.py'),'__name__':'inert_window_control'}
        exec(compile(subject,'inert-window','exec'),namespace)
        namespace['check_resources'](resource)
        changed={**resource,'memory.max':'1073741824'}
        try:namespace['check_resources'](changed)
        except ValueError as error:
            check(str(error)=='test-resource-refusal','resource-named-refusal');outcome='pass'
        else:outcome='named-failure'
        check((label=='resource-omitted')==(outcome=='named-failure'),'resource-control-sensitive')
        controls.append({'trial':label,'outcome':'survived' if label=='harmless' else outcome})
    check((HERE/'window.py').read_text()==original,'window-source-exact-restoration')
    check(window.argv()[-(len(window.argv())-window.argv().index('--dev-bind')):][:3]==['--dev-bind','/dev/null','/dev/null'],'final-devnull-bind')
    result={'selectedExternalUnchanged':len(pins),'unchangedR6Runtime':inherited,'sourceMigrations':len(migrations),
        'syntax':syntax,'windowGuardControls':controls,'realRefusal':'MISSING_ROOT_ADMISSION:apply18',
        'nativeDispatches':0,'nativeParserAccepted':False,'admissionsAbsent':True,'stagesAbsent':True}
    result['retainedSnapshot']={'sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),'bytes':snapshot.stat().st_size,'labels':len(json.loads(snapshot.read_bytes())['snapshot'])}
    (ROOT/'final-checks.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':main()
