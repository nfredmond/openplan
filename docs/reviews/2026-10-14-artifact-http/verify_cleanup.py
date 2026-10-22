"""Challenge the actual runner cleanup AST with fake container operations.

No Docker call or retained database change occurs in these controls.
"""
import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace


def cleanup_body(text):
    run=next(n for n in ast.parse(text).body if isinstance(n,ast.FunctionDef) and n.name=='run')
    candidates=[n.finalbody for n in ast.walk(run) if isinstance(n,ast.Try) and n.finalbody
        and isinstance(n.finalbody[0],ast.Assign) and any(isinstance(t,ast.Name) and t.id=='errors' for t in n.finalbody[0].targets)]
    assert len(candidates)==1,'Cleanup controls select the actual unique finally block'
    return candidates[0]


def exercise(body,mode):
    calls=[];pg_running=True
    driver=SimpleNamespace(PG='owned-pg',IMAGE='pg-image')
    def inspect(identity):
        if identity=='owned-rest':
            return {'Id':'foreign-rest' if mode=='foreign-rest' else identity,'Image':'rest-image',
                'Config':{'Labels':{'openplan.purpose':'rest-purpose'}},'State':{'Running':mode!='foreign-pg'}}
        assert identity==driver.PG,'Cleanup inspects only its recorded containers'
        return {'Id':'foreign-pg' if mode=='foreign-pg' else identity,'Image':driver.IMAGE,
            'Config':{'Labels':{'openplan.purpose':'odm-private-dispatch-rpc-cli-20261012'}},'State':{'Running':pg_running,'OOMKilled':False}}
    def stop(command,**options):
        nonlocal pg_running
        assert command[:4]==['docker','stop','--time','120'] and options.get('timeout')==140,'Cleanup keeps its bounded stop operation'
        identity=command[-1];calls.append(identity)
        if identity=='owned-rest' and mode in ('rest-failure','both-failure'):raise OSError('synthetic REST stop failure')
        if identity==driver.PG and mode=='both-failure':raise OSError('synthetic PostgreSQL stop failure')
        if identity==driver.PG:pg_running=False
    namespace={'created_id':'owned-rest','REST_IMAGE':'rest-image','PURPOSE':'rest-purpose',
        'inspect':inspect,'driver':driver,'subprocess':SimpleNamespace(run=stop,DEVNULL=-3)}
    function=ast.FunctionDef(name='cleanup',args=ast.arguments(posonlyargs=[],args=[],kwonlyargs=[],kw_defaults=[],defaults=[]),body=copy.deepcopy(body),decorator_list=[])
    module=ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[]));exec(compile(module,'actual-native-cleanup','exec'),namespace)
    error=None
    try:namespace['cleanup']()
    except BaseException as caught:error=caught
    if mode=='both-failure':
        assert calls==['owned-rest','owned-pg'],'Both cleanup failures still attempt both recorded containers'
        assert isinstance(error,BaseExceptionGroup) and [str(e) for e in error.exceptions]==['synthetic REST stop failure','synthetic PostgreSQL stop failure'],'Both cleanup failure diagnostics remain visible'
    elif mode=='rest-failure':
        assert calls==['owned-rest','owned-pg'],'REST stop failure must still attempt verified PostgreSQL cleanup'
        assert isinstance(error,BaseExceptionGroup) and len(error.exceptions)==1 and str(error.exceptions[0])=='synthetic REST stop failure','Cleanup retains the original REST diagnostic'
    elif mode=='foreign-rest':
        assert calls==['owned-pg'],'Foreign REST identity must never be stopped'
        assert isinstance(error,BaseExceptionGroup),'Refused REST cleanup remains an explicit error'
    else:
        assert calls==[],'Foreign PostgreSQL identity must never be stopped'
        assert isinstance(error,BaseExceptionGroup),'Refused PostgreSQL cleanup remains an explicit error'


def run(repo,out):
    out.mkdir(mode=0o700,parents=True)
    source=repo/'docs/reviews/2026-10-14-artifact-http/native_http.py';original=source.read_bytes();text=original.decode();results=[]
    def positive(label,body):
        for mode in ('rest-failure','both-failure','foreign-rest','foreign-pg'):exercise(body,mode)
        results.append({'case':label,'outcome':'survived'});print(label+' survived',flush=True)
    positive('baseline',cleanup_body(text));positive('harmless',cleanup_body(text+'\n# Harmless cleanup note.\n'));positive('restored-after-harmless',cleanup_body(text))
    body=copy.deepcopy(cleanup_body(text));first=next(i for i,n in enumerate(body) if isinstance(n,ast.Try));body[first:first+1]=body[first].body
    faults=[('rest-failure-skips-pg',body,'rest-failure','REST stop failure must still attempt verified PostgreSQL cleanup')]
    for label,mode,message in [('foreign-rest-stopped','foreign-rest','Foreign REST identity must never be stopped'),('foreign-pg-stopped','foreign-pg','Foreign PostgreSQL identity must never be stopped')]:
        body=copy.deepcopy(cleanup_body(text));target='Only owned REST cleanup is allowed' if mode=='foreign-rest' else 'Only original owned PostgreSQL cleanup is allowed'
        nodes=[n for root in body for n in ast.walk(root) if isinstance(n,ast.Assert) and isinstance(n.msg,ast.Constant) and n.msg.value==target]
        assert len(nodes)==1,'Cleanup identity guard is unique';nodes[0].test=ast.Constant(True)
        faults.append((label,body,mode,message))
    body=copy.deepcopy(cleanup_body(text));tries=[n for n in body if isinstance(n,ast.Try)];assert len(tries)==2,'Cleanup has both recorded stop attempts';tries[1].handlers[0].body=[ast.Pass()]
    faults.append(('pg-error-discarded',body,'both-failure','Both cleanup failure diagnostics remain visible'))
    for label,body,mode,message in faults:
        try:exercise(body,mode)
        except AssertionError as error:assert str(error)==message,'Cleanup fault has its exact intended diagnostic'
        else:raise AssertionError('Cleanup fault must fail: '+label)
        results.append({'case':label,'outcome':'intended_failure','reason':message});print(label+' intended failure',flush=True)
    positive('restored-final',cleanup_body(text));assert source.read_bytes()==original,'Cleanup controls never mutate source'
    (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
    (out/'source-binding.json').write_text(json.dumps({str(source.relative_to(repo)):hashlib.sha256(original).hexdigest()})+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
