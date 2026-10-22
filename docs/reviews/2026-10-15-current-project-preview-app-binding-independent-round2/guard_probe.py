"""Exercise retained start receipt/code/tool gates with all operational I/O replaced."""
import json
import os
import types
from common import PUBLIC, V2, OUT, write

os.umask(0o077)
text = (PUBLIC/'verify_controls.py').read_text().split('\nrows=campaign(m)\n')[0]
text = text.replace(str(V2), str(OUT)).replace('fixtures-05','guard-fixtures-01')
h = types.ModuleType('guard_support'); h.__file__ = str(PUBLIC/'verify_controls.py')
exec(compile(text,h.__file__,'exec'),vars(h))
base = (PUBLIC/'templates/app_binding_v1.py').read_bytes()

def campaign(source):
    a = h.load(source); h.m = a; (h.FIX/'app_binding_v1.py').write_bytes(source)
    observed = []
    def prepare():
        h.build_setup(a); h.run_consumer(a,'build')
    def attempt(name, reason=None):
        try: h.run_consumer(a,'start')
        except BaseException as error:
            assert reason and reason in str(error), name+':unexpected:'+str(error)
            observed.append({'case':name,'outcome':'refused','reason':reason})
        else:
            assert reason is None, name+':accepted-broken-behavior'
            observed.append({'case':name,'outcome':'survived'})
    prepare(); attempt('start baseline')
    for name, field, value, reason in [
        ('changed binding code hash','bindingSha256','0'*64,'build-code'),
        ('changed launcher code hash','launcherSha256','0'*64,'build-code'),
        ('changed node executable hash','executables',{'/usr/bin/node':'0'*64},'build-tools'),
        ('changed inventory file hash','buildFilesSha256','0'*64,'build-inventory'),
        ('wrong full app receipt HEAD','app',{'head':a.HELPER_HEAD},'build-receipt-binding'),
    ]:
        prepare(); report=a.RUN/'build-result.json'; saved=report.read_bytes()
        try:
            data=json.loads(saved); data[field]=value; report.write_text(json.dumps(data))
            attempt(name,reason)
        finally: report.write_bytes(saved)
    prepare(); h.state['head']=a.APP_HEAD[:12]
    try: h.run_consumer(a,'start')
    except ValueError as error:
        assert str(error)=='app-head'
        observed.append({'case':'short checkout SHA','outcome':'refused','reason':str(error)})
    else: raise AssertionError('short checkout SHA:accepted-broken-behavior')
    return observed

baseline = campaign(base)
faults = [
    ('harmless comment first',base+b'\n# Harmless retained guard comment.\n',None),
    ('remove code binding guard',base.replace(b"require(report['bindingSha256'] == sha(ROOT/'binding-private.json') and",b"require(True or report['bindingSha256'] == sha(ROOT/'binding-private.json') and"),'changed binding code hash:accepted-broken-behavior'),
    ('remove executable identity guard',base.replace(b"require(report['executables'] == {name: sha(Path(name))",b"require(True or report['executables'] == {name: sha(Path(name))"),'changed node executable hash:accepted-broken-behavior'),
    ('remove inventory guard',base.replace(b"require(report['buildFilesSha256'] == sha(RUN/'build-files.json') and",b"require(True or report['buildFilesSha256'] == sha(RUN/'build-files.json') and"),'changed inventory file hash:accepted-broken-behavior'),
]
mutations=[]
for name,source,reason in faults:
    assert source!=base
    try:
        campaign(source)
        assert reason is None, name+':fault-survived'
        mutations.append({'mutation':name,'outcome':'survived'})
    except AssertionError as error:
        assert reason and str(error)==reason, str(error)
        mutations.append({'mutation':name,'outcome':'detected','reason':reason})
    finally:
        (h.FIX/'app_binding_v1.py').write_bytes(base)
assert campaign(base)==baseline
assert (PUBLIC/'templates/app_binding_v1.py').read_bytes()==base
write(OUT/'retained-guard-controls-01.json',{'cases':baseline,'mutations':mutations,'restored':True,
      'blindCategory':'Synthetic receipts and operational observations. No actual executable transition, application process or build.'})
print(json.dumps({'cases':len(baseline),'mutations':len(mutations),'restored':True}))
