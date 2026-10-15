"""Exercise exact new identity refusals through actual consumers using owned fixtures."""
import json
import types
from unittest.mock import patch
from common import PUBLIC,ROOT,V2,HEAD,OLD_HEAD,write

text=(PUBLIC/'verify_controls.py').read_text().split('\nrows=campaign(m)\n')[0].replace('fixtures-05','identity-fixtures-01')
h=types.ModuleType('identity_fixture_support');h.__file__=str(PUBLIC/'verify_controls.py')
exec(compile(text,h.__file__,'exec'),vars(h))
BASE=(PUBLIC/'templates/app_binding_v1.py').read_bytes()


def campaign(source):
    module=h.load(source);h.m=module;h.configure(module)
    (h.FIX/'app_binding_v1.py').write_bytes(source);h.refresh_binding(module)
    rows=[]
    def attempt(label,action,reason=None):
        try:action()
        except BaseException as error:
            if reason is None or str(error)!=reason:raise AssertionError(label+':unexpected:'+str(error)) from error
            rows.append({'case':label,'outcome':'refused','reason':str(error)})
        else:
            if reason:raise AssertionError(label+':accepted-broken-behavior')
            rows.append({'case':label,'outcome':'survived'})
    attempt('v3 full identity baseline',module.bindings)
    path=h.FIX/'binding-private.json';saved=path.read_bytes()
    try:
        value=json.loads(saved);value['appHead']=OLD_HEAD;path.write_text(json.dumps(value))
        attempt('old 678 binding head',module.bindings,'binding-identity')
    finally:path.write_bytes(saved)
    saved_root=module.ROOT
    try:
        module.ROOT=V2
        attempt('old v2 launcher root',module.bindings,'launcher-root')
    finally:module.ROOT=saved_root
    h.state.clear();r=h.recovery(module)
    with patch.object(module,'command',side_effect=h.fake_command):
        attempt('full checkout identity baseline',lambda:module.app_check(r))
        h.state['head']=OLD_HEAD
        attempt('old 678 checkout head',lambda:module.app_check(r),'app-head')
        h.state['head']=HEAD[:12]
        attempt('short checkout SHA',lambda:module.app_check(r),'app-head')
        h.state.clear()
        path=h.FIX/'app-env-private.json';saved=path.read_bytes()
        try:
            values=json.loads(saved);values['OPENPLAN_COMMIT_SHA']=OLD_HEAD;path.write_text(json.dumps(values))
            attempt('old 678 env delta',lambda:module.app_values(r),'app-env-delta')
            values['OPENPLAN_COMMIT_SHA']=HEAD[:12];path.write_text(json.dumps(values))
            attempt('short full env SHA',lambda:module.app_values(r),'app-env-delta')
        finally:path.write_bytes(saved)
    return rows

baseline=campaign(BASE)
mutations=[
    ('harmless identity comment',BASE+b'\n# Harmless identity comment.\n',None),
    ('remove binding head identity',BASE.replace(b'(1, APP_HEAD, HELPER_HEAD, RECOVERY_PRODUCER, SOURCE_ANCHOR)',b"(1, binding['appHead'], HELPER_HEAD, RECOVERY_PRODUCER, SOURCE_ANCHOR)"),'old 678 binding head:accepted-broken-behavior'),
    ('remove launcher root guard',BASE.replace(b"require(Path(__file__).resolve() == ROOT/'app_binding_v1.py' and ROOT.resolve() == ROOT,",b"require(True or Path(__file__).resolve() == ROOT/'app_binding_v1.py' and ROOT.resolve() == ROOT,"),'old v2 launcher root:unexpected:binding-identity'),
    ('remove full checkout head guard',BASE.replace(b"require(head == APP_HEAD, 'app-head')",b"require(True, 'app-head')"),'old 678 checkout head:accepted-broken-behavior'),
    ('remove full env delta guard',BASE.replace(b"require(values == {**old, 'OPENPLAN_COMMIT_SHA': APP_HEAD}, 'app-env-delta')",b"require(True, 'app-env-delta')"),'old 678 env delta:unexpected:app-env-encoding'),
]
results=[]
for name,source,reason in mutations:
    assert source!=BASE
    try:
        campaign(source)
        if reason:raise AssertionError('fault-survived:'+name)
        results.append({'mutation':name,'outcome':'survived'})
    except AssertionError as error:
        assert reason and reason==str(error),str(error)
        results.append({'mutation':name,'outcome':'detected','reason':str(error)})
    finally:
        (h.FIX/'app_binding_v1.py').write_bytes(BASE);h.m=h.load(BASE);h.configure(h.m);h.refresh_binding(h.m)
restored=campaign(BASE);assert baseline==restored
assert (PUBLIC/'templates/app_binding_v1.py').read_bytes()==BASE
assert (ROOT/'app_binding_v1.py').read_bytes()==BASE
write(ROOT/'identity-controls-01.json',{'cases':baseline,'mutations':results,'restored':True,
    'limits':'Actual pure consumers with commands and data acquisition replaced. Root/env guard removals reach redundant refusals and prove participation, not unsafe execution.'})
print(json.dumps({'cases':len(baseline),'mutations':len(results),'survivors':1,'restored':True}))
