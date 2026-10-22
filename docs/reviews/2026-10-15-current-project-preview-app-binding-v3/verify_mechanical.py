"""Check the fixed v2-to-v3 runtime delta, with named faults and exact restoration."""
import json
from common import PUBLIC,OLD_PUBLIC,ROOT,V2,HEAD,OLD_HEAD,UNIT,write

names=['app_binding_v1.py','attest_start_v1.py']
base={name:(PUBLIC/'templates'/name).read_bytes() for name in names}
runner=(PUBLIC/'run_stage_v3.sh').read_bytes()
prior={name:(OLD_PUBLIC/'templates'/name).read_bytes() for name in names}
old_runner=(OLD_PUBLIC/'run_stage_v2.sh').read_bytes()
expected={
    'app_binding_v1.py':prior['app_binding_v1.py'].replace(str(V2).encode(),str(ROOT).encode()).replace(OLD_HEAD.encode(),HEAD.encode()),
    'attest_start_v1.py':prior['attest_start_v1.py'].replace(b'openplan-current-project-preview-app-678-v1-web.service',UNIT.encode()),
}
expected_runner=old_runner.replace(str(V2).encode(),str(ROOT).encode()).replace(b'openplan-current-project-preview-app-678-v1-',b'openplan-current-project-preview-app-21510042e-v3-')


def check(subject,stage,observation_label):
    # observation_label is report text only and cannot change the bound bytes.
    assert isinstance(observation_label,str)
    assert subject==expected,'nonmechanical-runtime-delta'
    assert stage==expected_runner,'nonmechanical-runner-delta'


def campaign(source):
    scope={};exec(compile(source,'mechanical-checker','exec'),scope)
    checker=scope['check'];rows=[]
    for label,subject,stage,reason in [
        ('harmless observation text first',base,runner,None),
        ('old 678 runtime head',{**base,'app_binding_v1.py':base['app_binding_v1.py'].replace(HEAD.encode(),OLD_HEAD.encode())},runner,'nonmechanical-runtime-delta'),
        ('old v2 runtime root',{**base,'app_binding_v1.py':base['app_binding_v1.py'].replace(str(ROOT).encode(),str(V2).encode())},runner,'nonmechanical-runtime-delta'),
        ('old 678 web unit',{**base,'attest_start_v1.py':base['attest_start_v1.py'].replace(UNIT.encode(),b'openplan-current-project-preview-app-678-v1-web.service')},runner,'nonmechanical-runtime-delta'),
        ('full SHA health comparison',{**base,'attest_start_v1.py':base['attest_start_v1.py'].replace(b'a.APP_HEAD[:12].lower()',b'a.APP_HEAD')},runner,'nonmechanical-runtime-delta'),
        ('loosen full checkout SHA',{**base,'app_binding_v1.py':base['app_binding_v1.py'].replace(b'head == APP_HEAD',b'head.startswith(APP_HEAD[:12])')},runner,'nonmechanical-runtime-delta'),
        ('changed source anchor',{**base,'app_binding_v1.py':base['app_binding_v1.py'].replace(b'82fda3004c8dd5d3',b'0000000000000000')},runner,'nonmechanical-runtime-delta'),
        ('old unit runner',base,runner.replace(b'openplan-current-project-preview-app-21510042e-v3-',b'openplan-current-project-preview-app-678-v1-'),'nonmechanical-runner-delta'),
        ('old root runner',base,runner.replace(str(ROOT).encode(),str(V2).encode()),'nonmechanical-runner-delta'),
        ('restored exact runtime',base,runner,None),
    ]:
        try:checker(subject,stage,label+' harmless wording')
        except AssertionError as error:
            assert reason and str(error)==reason,label+':unexpected:'+str(error)
            rows.append({'case':label,'outcome':'refused','reason':reason})
        else:
            assert reason is None,label+':accepted-broken-behavior'
            rows.append({'case':label,'outcome':'survived'})
    return rows

# The checker itself is exercised, rather than trusting a hardcoded count.
import inspect
source=inspect.getsource(check)
prelude='expected='+repr(expected)+'\nexpected_runner='+repr(expected_runner)+'\n'
subject=prelude+source
baseline=campaign(subject);mutations=[]
for label,changed,reason in [
    ('harmless checker comment',subject+'\n# Harmless checker comment.\n',None),
    ('remove runtime equality',subject.replace("assert subject==expected,'nonmechanical-runtime-delta'",'pass'),'old 678 runtime head:accepted-broken-behavior'),
    ('remove runner equality',subject.replace("assert stage==expected_runner,'nonmechanical-runner-delta'",'pass'),'old unit runner:accepted-broken-behavior'),
]:
    assert changed!=subject
    try:
        campaign(changed)
        assert reason is None,label+':fault-survived'
        mutations.append({'mutation':label,'outcome':'survived'})
    except AssertionError as error:
        assert reason and str(error)==reason,str(error)
        mutations.append({'mutation':label,'outcome':'detected','reason':reason})
    finally:
        assert {name:(PUBLIC/'templates'/name).read_bytes() for name in names}==base
        assert (PUBLIC/'run_stage_v3.sh').read_bytes()==runner
assert campaign(subject)==baseline
assert all((ROOT/name).read_bytes()==data for name,data in base.items())
assert (ROOT/'run_stage_v3.sh').read_bytes()==runner
write(ROOT/'mechanical-controls-01.json',{'cases':baseline,'mutations':mutations,'restored':True,
    'blindCategory':'Exact byte delta and identity constants, not application execution, host trust or production behavior.'})
print(json.dumps({'cases':len(baseline),'mutations':len(mutations),'survivors':1,'restored':True}))
