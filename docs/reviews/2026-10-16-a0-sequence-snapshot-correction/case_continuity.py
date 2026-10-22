#!/usr/bin/python3
"""Reduced R6 continuity using the frozen R5 Popen-only case oracle."""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import types

import prepare


class Pipe(io.BytesIO):
    def close(self):
        self.data=self.getvalue();super().close()


def probe(out, subject, scenario):
    out.mkdir(mode=0o700)
    sys.path.insert(0,str(subject))
    for name in ['controller','journal','policy','cases','fixture']:sys.modules.pop(name,None)
    import controller, journal, policy
    root=out/'state'
    name=scenario.get('case','limited');mutation=scenario.get('mutation')
    stage='mutation-'+mutation if mutation else 'case-'+name
    for directory in [root/'stages'/stage/'controller',root/'stages/observe',root/'stages/allocate']:
        directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    plan=json.loads((prepare.ROOT/'plan.json').read_text())
    old=prepare.OLD.with_name('a0-usage-limit-native-wrapper-20261016-r3')/'stages/observe/controller'
    descriptor=(old/'request-006/stdout.bin').read_bytes()
    identity=dict(json.loads((old/'request-007/stdout.bin').read_text()),oid=5,database=plan['database'])
    scope={'synthetic':'same original scope'}
    journal.record(root/'stages/observe/observed.json',{'native':identity,'container':json.loads(descriptor),'originalScope':scope})
    journal.record(root/'stages/allocate/target.json',identity)
    pin={'sha256':'a'*64,'owner':'postgres','definer':True,'volatility':'v','config':[policy.PATH],'acl':[]}
    functions={key:dict(pin) for key in [policy.FINISH,policy.VALIDATOR]}
    controller.ROOT=root
    obj=controller.Controller(stage,plan,{'functionPins':functions})
    seen=[];calls=[];case_inputs=[];counts={'scope':0,'definitions':0,'snapshot':0}
    original=journal.subprocess
    class Process:
        def __init__(self,argv,stdin,stdout,stderr,env):
            assert env=={'PATH':'/usr/bin:/bin','HOME':'/home/nathaniel','LANG':'C.UTF-8'},'case-child-environment-differs'
            request=sorted(obj.t.root.glob('request-*'))[-1]
            intent=json.loads((request/'intent.json').read_text())
            assert intent['environment']==env and intent['argv']==argv,'case-request-intent-differs'
            assert (request/'input.bin').is_file(),'case-input-not-retained-before-dispatch'
            self.argv=argv;self.stdin=Pipe();self.stdout=stdout;self.stderr=stderr;self.pid=82000+len(calls);calls.append(argv)
        def wait(self,timeout):
            if self.argv[:2]==['/usr/bin/docker','inspect']:
                self.stdout.write(descriptor);return 0
            assert self.argv in [obj.argv(obj.db),obj.argv('postgres')],'case-command-scope-differs'
            sql=self.stdin.data.decode()
            request=sorted(obj.t.root.glob('request-*'))[-1]
            assert (request/'input.bin').read_bytes()==self.stdin.data,'case-journal-query-differs'
            code=0
            if "'applicationName'" in sql:
                assert "'oid',(SELECT oid::pg_catalog.int8 FROM pg_database" in sql,'case-native-main-cast-missing'
                seen.append('native');response=identity
            elif "'databases'" in sql:
                counts['scope']+=1;seen.append('scope')
                response={'synthetic':'changed scope'} if scenario.get('fault')=='scope' and counts['scope']==2 else scope
            elif 'SELECT json_object_agg(oid::' in sql:
                counts['definitions']+=1;seen.append('definitions');response=copy.deepcopy(functions)
                if scenario.get('fault')=='definition' and counts['definitions']==2:response[policy.FINISH]['sha256']='b'*64
            elif 'CREATE TEMP TABLE a0_snapshot' in sql:
                counts['snapshot']+=1;seen.append('snapshot')
                response={'synthetic':'changed snapshot' if scenario.get('fault')=='snapshot' and counts['snapshot']==2 else 'same snapshot'}
            elif "'caseBackend'" in sql:
                seen.append('case');case_inputs.append(sql)
                assert 'public.finish_assistant_provider_turn(' in sql and 'public.valid_assistant_native_limit_receipt(' in sql,'case-production-calls-missing'
                assert 'ROLLBACK;' in sql and "'rollback'" in sql,'case-same-backend-rollback-construction-missing'
                if name=='shadow':
                    assert 'CREATE DOMAIN pg_temp.jsonb AS pg_catalog.text;' in sql and 'CREATE DOMAIN pg_temp.uuid AS pg_catalog.text;' in sql,'case-shadow-construction-missing'
                cast="'caseTempSchema',pg_my_temp_schema()::pg_catalog.int8" in sql
                schema=scenario.get('schema',0)
                # Synthetic type behavior is selected from the ACTUAL generated projection.
                value=schema if cast else str(schema)
                if 'responseSchema' in scenario:value=scenario['responseSchema']
                backend=scenario.get('backend',777)
                output='t\n'+json.dumps({'caseBackend':backend})+'\n'+json.dumps({'caseTempSchema':value})+'\n'
                if mutation:
                    assert mutation=='validator-accept-all' and 'RETURN true;' in sql,'expected-fault-construction-missing'
                    self.stderr.write(b'ERROR: a0-assert:scope-userId\n');code=1
                else:output+=json.dumps({'rollback':True},separators=(',',':'))+'\n'
                self.stdout.write(output.encode());return code
            elif "'backendGone'" in sql:
                seen.append('absence')
                if scenario.get('error') is None:
                    assert 'WHERE pid=777' in sql,'case-cleanup-wrong-backend'
                    assert 'relnamespace='+str(scenario.get('schema',0)) in sql and 'typnamespace='+str(scenario.get('schema',0)) in sql,'case-cleanup-wrong-schema'
                response={'backendGone':True,'relationsGone':True,'typesGone':True}
                if scenario.get('fault') in response:response[scenario['fault']]=False
            else:raise AssertionError('unrecognized-case-query')
            self.stdout.write((json.dumps(response)+'\n').encode());return 0
    journal.subprocess=types.SimpleNamespace(Popen=Process,PIPE=-1)
    error=None
    try:
        try:obj.case(name,mutation)
        except ValueError as caught:error=str(caught)
    finally:journal.subprocess=original;sys.path.remove(str(subject))
    receipt=obj.path/'case.json'
    detail={'scenario':scenario['name'],'error':error,'queries':seen,'sqlRequests':len(seen),
        'PopenCalls':len(calls),'caseReceipt':receipt.exists(),'nativeOperations':0,
        'evidence':'synthetic replies through inert Popen; no native pg_my_temp_schema observation'}
    prepare.write(out/'result.json',detail)
    assert len(case_inputs)==1,'case-query-not-reached'
    assert "'caseBackend',pg_backend_pid()" in case_inputs[0],'case-backend-projection-differs'
    expected=scenario.get('error')
    if expected:
        assert error==expected and not receipt.exists(),scenario['oracle']
    else:
        if error=='case-native-session-custody':raise AssertionError('case-temp-oid-readback-not-reached')
        assert error is None,'case-unexpected-error:'+str(error)
        assert 'absence' in seen,'case-absence-readback-not-reached'
        assert counts['snapshot']==2,'case-target-readback-not-reached'
        assert counts['definitions']==2,'case-definition-readback-not-reached'
        assert counts['scope']==2,'case-scope-readback-not-reached'
        assert seen==['native','scope','definitions','snapshot','case','absence','snapshot','definitions','scope'],'case-readback-order-differs'
        assert receipt.exists(),'case-final-receipt-missing'
        saved=json.loads(receipt.read_text())
        assert saved['observedExpectedFailure']==bool(mutation),'case-expected-failure-receipt-differs'
    assert len(case_inputs)==1,'case-query-not-reached'
    return detail



def main():
    os.umask(0o077)
    root=prepare.EVIDENCE/'case-continuity-01';root.mkdir(mode=0o700)
    original=(prepare.SOURCE/'controller.py').read_bytes()
    needle="'caseTempSchema',pg_my_temp_schema()::pg_catalog.int8"
    rows=[]
    for name in ['baseline','harmless','case-cast-removed','restored']:
        directory=root/name;directory.mkdir(mode=0o700);subject=directory/'subject';subject.mkdir(mode=0o700)
        for file in prepare.RUNTIME:
            path=subject/file;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            path.write_bytes((prepare.SOURCE/file).read_bytes());path.chmod(0o600)
        path=subject/'controller.py';pins={n:prepare.pin(subject/n) for n in prepare.RUNTIME}
        if name=='harmless':path.write_bytes(original+b'\n# Harmless R6 continuity comment.\n')
        elif name=='case-cast-removed':
            assert original.decode().count(needle)==1
            path.write_text(original.decode().replace(needle,"'caseTempSchema',pg_my_temp_schema()",1))
        (directory/'executed-controller.py').write_bytes(path.read_bytes())
        prepare.write(directory/'executed-subject.json',{n:prepare.pin(subject/n) for n in prepare.RUNTIME})
        try:
            scenarios=[{'name':'ordinary-zero'},{'name':'shadow','case':'shadow','schema':888},
                {'name':'expected-validator-failure','case':'scope-userId','mutation':'validator-accept-all'}]
            for scenario in scenarios:
                try:detail=probe(directory/scenario['name'],subject,scenario)
                except AssertionError as error:
                    assert name=='case-cast-removed' and str(error)=='case-temp-oid-readback-not-reached'
                    detail=json.loads((directory/scenario['name']/'result.json').read_text())
                    outcome='KILLED'
                else:
                    assert name!='case-cast-removed'
                    outcome='SURVIVED' if name=='harmless' else 'PASS'
                rows.append({'trial':name,'scenario':scenario['name'],'outcome':outcome,'detail':detail})
        finally:path.write_bytes(original)
        assert {n:prepare.pin(subject/n) for n in prepare.RUNTIME}==pins,'continuity-source-restoration-differs'
        prepare.write(directory/'restoration.json',pins)
    prepare.write(root/'result.json',{'rows':rows,'nativeOperations':0,
        'reuse':'Exact R5 probe implementation, with capture path rebound to immutable R3 and new private subject paths. Not an independent fake-SQL implementation.',
        'blind':'Three actual case/transport compositions with inert Popen; no native sequence or case acceptance. Full 15-fault campaign is not rerun.'})
    print(json.dumps({'continuityProbes':len(rows),'harmlessSurvivors':3,'namedFaults':3,'nativeOperations':0}))


if __name__=='__main__':main()
