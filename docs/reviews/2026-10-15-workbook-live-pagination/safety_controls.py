"""Pure guard controls use altered metadata, never an alternate live target."""
import copy
import inspect
import json
from pathlib import Path

import native

def rejected(call,diagnostic):
    try:call()
    except AssertionError as e:
        assert str(e)==diagnostic,'safety exact refusal diagnostic'
        return
    raise AssertionError('safety must refuse '+diagnostic)

def checks(ns):
    target='openplan_workbook_native_'+'a'*24
    ns['guard_database'](native.SOURCE,True,target)
    ns['guard_database'](target,False,target)
    rejected(lambda:ns['guard_database'](native.SOURCE,False,target),'database allowlist')
    rejected(lambda:ns['guard_database']('openplan_attempt_cli_other',False,target),'database allowlist')
    ns['guard_cluster']({'Id':native.CLUSTER,'Name':'/'+native.NAME,'State':{'Running':True}})
    rejected(lambda:ns['guard_cluster']({'Id':'foreign','Name':'/'+native.NAME,'State':{'Running':True}}),'cluster identity')
    ns['guard_runner']('1073741824','0')
    rejected(lambda:ns['guard_runner']('max','0'),'runner bounds')
    rejected(lambda:ns['guard_runner']('1073741824','max'),'runner bounds')
    uri='postgres://synthetic@cluster/'+target
    value={'Id':'owned-id','Name':'/owned','Image':native.IMAGE,'Config':{'Labels':{'openplan.proof.database':target},'Env':['PGRST_DB_URI='+uri]},
        'HostConfig':{'Memory':536870912,'MemorySwap':536870912,'NanoCpus':500000000,'PortBindings':{'3000/tcp':[{'HostIp':native.HOST,'HostPort':str(native.PORT)}]}},'Mounts':[]}
    run=lambda v:ns['guard_helper'](v,'owned-id','owned',target,uri)
    run(value)
    for key,diagnostic in [('identity','owned helper identity'),('target','owned helper target'),('bounds','helper bounds'),('port','loopback no mounts'),('uri','helper URI target exact')]:
        bad=copy.deepcopy(value)
        if key=='identity':bad['Id']='foreign'
        elif key=='target':bad['Config']['Labels']['openplan.proof.database']=native.SOURCE
        elif key=='bounds':bad['HostConfig']['MemorySwap']=-1
        elif key=='port':bad['HostConfig']['PortBindings']['3000/tcp'][0]['HostIp']='0.0.0.0'
        elif key=='uri':bad['Config']['Env']=['PGRST_DB_URI=postgres://synthetic@cluster/'+native.SOURCE]
        rejected(lambda:run(bad),diagnostic)

def main():
    functions=[native.guard_database,native.guard_cluster,native.guard_runner,native.guard_helper]
    source='\n'.join(inspect.getsource(f) for f in functions)
    def load(text):
        ns=dict(vars(native));exec(text,ns);return ns
    checks(load(source));checks(load(source+'\n# harmless guard comment\n'))
    events=[]
    for line in source.splitlines():
        if not line.lstrip().startswith('assert '):continue
        diagnostic=line.rsplit(', ',1)[1].strip("'")
        broken=source.replace(line,'    pass # private omitted guard',1)
        try:checks(load(broken))
        except AssertionError as e:assert str(e)=='safety must refuse '+diagnostic,'safety intended guard assertion';failure=str(e)
        else:raise AssertionError('safety omission must fail '+diagnostic)
        checks(load(source))
        events.append({'guard':diagnostic,'baseline':'passed','harmless':'survived','targetedOmission':'killed','failure':failure,'restored':'passed'})
    native.write(native.BASE/'safety-controls.json',{'controls':events,'blind':'Pure metadata controls do not start a wrong helper or connect to an unauthorized database.'})

if __name__=='__main__':main()
