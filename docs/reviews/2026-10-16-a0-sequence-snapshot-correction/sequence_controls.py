#!/usr/bin/python3
"""Capture actual snapshot SQL through real Transport and inert Popen only."""
import copy
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import types

import prepare


class Pipe(io.BytesIO):
    def close(self):self.data=self.getvalue();super().close()


def probe(subject,out):
    out.mkdir(mode=0o700)
    sys.path.insert(0,str(subject))
    import controller,journal,policy
    root=out/'inert-state';(root/'stages/observe/controller').mkdir(mode=0o700,parents=True)
    controller.ROOT=root
    plan=json.loads((prepare.ROOT/'plan.json').read_text())
    obj=controller.Controller('observe',plan,{})
    old=prepare.OLD.with_name('a0-usage-limit-native-wrapper-20261016-r3')/'stages/observe/controller'
    descriptor=(old/'request-006/stdout.bin').read_bytes()
    obj.observation={'native':{'systemIdentifier':'7683856985084612646'},'container':json.loads(descriptor)}
    obj.target={'oid':17}
    state={'last_value':42,'log_cnt':7,'is_called':True}
    table={'count':2,'digest':'a'*32};census='b'*32
    original=journal.subprocess;inputs=[];states=[]
    class Process:
        def __init__(self,argv,stdin,stdout,stderr,env):
            assert env=={'PATH':'/usr/bin:/bin','HOME':'/home/nathaniel','LANG':'C.UTF-8'},'snapshot-environment-differs'
            request=sorted(obj.t.root.glob('request-*'))[-1]
            assert (request/'input.bin').is_file(),'snapshot-input-before-dispatch-missing'
            intent=json.loads((request/'intent.json').read_text())
            assert intent['argv']==argv and intent['environment']==env,'snapshot-intent-differs'
            self.argv=argv;self.stdin=Pipe();self.stdout=stdout;self.stderr=stderr;self.pid=83000+len(inputs)
        def wait(self,timeout):
            if self.argv[:2]==['/usr/bin/docker','inspect']:
                self.stdout.write(descriptor);return 0
            assert self.argv==obj.argv(obj.db),'snapshot-target-command-differs'
            sql=self.stdin.data.decode();inputs.append(sql)
            assert "current_database()<>"+controller.f.literal(obj.db) in sql and 'current_database())<>17' in sql,'snapshot-same-backend-guard-missing'
            assert 'BEGIN ISOLATION LEVEL REPEATABLE READ;' in sql and 'ROLLBACK;' in sql,'snapshot-transaction-differs'
            if 'SELECT to_jsonb(s) FROM %I.%I s' in sql:
                self.stderr.write((prepare.OLD/'stages/restore419/controller/request-021/stderr.bin').read_bytes())
                return 3
            match=re.search(r"IF t.relkind='S' THEN EXECUTE format\('([^\n]+?)',t.nspname,t.relname\) INTO value;",sql)
            assert match,'sequence-branch-not-reached'
            expression=match[1]
            assert expression.startswith('SELECT pg_catalog.jsonb_build_object('),'sequence-builder-not-catalog-qualified'
            assert expression.endswith(' FROM %I.%I s'),'sequence-relation-format-differs'
            fields=dict(re.findall(r"''([a-z_]+)'',s\.([a-z_]+)",expression))
            projected={key:state[column] for key,column in fields.items()}
            value={}
            if "c.relkind IN ('r','p','S')" in sql or "c.relkind IN ('r','p')" in sql:
                assert 'FROM ONLY %I.%I t' in sql,'snapshot-table-only-hash-missing'
                assert "ORDER BY md5(to_jsonb(t)::pg_catalog.text)" in sql,'snapshot-table-hash-order-missing'
                value['public.synthetic_table']=table
            if "c.relkind IN ('r','p','S')" in sql or "c.relkind IN ('S')" in sql:value['net.synthetic_sequence']=projected
            if "SELECT '__pg_sequences__'" in sql and 'FROM pg_sequences t;' in sql:value['__pg_sequences__']=census
            self.stdout.write((json.dumps(value)+'\n').encode());return 0
    journal.subprocess=types.SimpleNamespace(Popen=Process,PIPE=-1)
    try:
        try:before=obj.snapshot()
        except ValueError as error:
            assert str(error).startswith('transport-exit;')
            raise AssertionError('sequence-snapshot-readback-not-reached') from error
        assert 'net.synthetic_sequence' in before,'sequence-map-entry-missing'
        assert before['net.synthetic_sequence']==state,'sequence-state-fields-differ'
        assert before.get('public.synthetic_table')==table,'snapshot-table-map-differs'
        assert before.get('__pg_sequences__')==census,'snapshot-sequence-census-missing'
        assert set(before)=={'net.synthetic_sequence','public.synthetic_table','__pg_sequences__'},'snapshot-complete-map-differs'
        policy.unchanged(before,obj.snapshot())
        for key,new_value in [('last_value',43),('log_cnt',8),('is_called',False)]:
            original_value=state[key]
            try:
                state[key]=new_value;after=obj.snapshot()
                try:policy.unchanged(before,after)
                except ValueError as error:assert str(error)=='rollback-state'
                else:raise AssertionError('sequence-state-change-not-refused:'+key)
                states.append({'field':key,'refusal':'rollback-state'})
            finally:state[key]=original_value
        policy.unchanged(before,obj.snapshot())
        prepare.write(out/'result.json',{'actualSnapshotSQLRequests':len(inputs),'stateFaults':states,
            'tablesAndCensusRetained':True,'nativeOperations':0,'realTransport':True,
            'blind':'Finite fake recognizes emitted SQL; it does not parse PostgreSQL, execute dynamic SQL or read/increment/reset a sequence.'})
    finally:journal.subprocess=original


def main():
    os.umask(0o077)
    if len(sys.argv)==4 and sys.argv[1]=='--probe':probe(Path(sys.argv[2]),Path(sys.argv[3]));return
    root=prepare.EVIDENCE/'sequence-controls-01';root.mkdir(mode=0o700)
    base=(prepare.SOURCE/'controller.py').read_text()
    explicit="SELECT pg_catalog.jsonb_build_object(''last_value'',s.last_value,''log_cnt'',s.log_cnt,''is_called'',s.is_called) FROM %I.%I s"
    census=next(line for line in base.splitlines() if "INSERT INTO pg_temp.a0_snapshot SELECT '__pg_sequences__'" in line)
    faults={
        'whole-sequence-row':(explicit,'SELECT to_jsonb(s) FROM %I.%I s','sequence-snapshot-readback-not-reached'),
        'last-value-omitted':("''last_value'',s.last_value,",'','sequence-state-fields-differ'),
        'log-cnt-omitted':(",''log_cnt'',s.log_cnt",'','sequence-state-fields-differ'),
        'is-called-omitted':(",''is_called'',s.is_called",'','sequence-state-fields-differ'),
        'unqualified-builder':('SELECT pg_catalog.jsonb_build_object(','SELECT jsonb_build_object(','sequence-builder-not-catalog-qualified'),
        'sequence-kind-omitted':("c.relkind IN ('r','p','S')","c.relkind IN ('r','p')",'sequence-map-entry-missing'),
        'table-only-omitted':('FROM ONLY %I.%I t','FROM %I.%I t','snapshot-table-only-hash-missing'),
        'census-omitted':(census,'-- deliberate owned census omission','snapshot-sequence-census-missing'),
        'tables-omitted':("c.relkind IN ('r','p','S')","c.relkind IN ('S')",'snapshot-table-map-differs')}
    rows=[]
    for name,fault in [('baseline',None),('harmless-comment',None),*faults.items(),('restored',None)]:
        trial=root/name;trial.mkdir(mode=0o700);subject=trial/'subject';subject.mkdir(mode=0o700)
        for file in prepare.RUNTIME:
            path=subject/file;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            path.write_bytes((prepare.SOURCE/file).read_bytes());path.chmod(0o600)
        path=subject/'controller.py';original=path.read_bytes()
        original_pins={n:prepare.pin(subject/n) for n in prepare.RUNTIME}
        if fault:
            assert fault[0] in base,(name,'anchor missing')
            path.write_text(base.replace(fault[0],fault[1],1))
        elif name=='harmless-comment':path.write_bytes(original+b'\n# Harmless sequence snapshot comment.\n')
        (trial/'executed-controller.py').write_bytes(path.read_bytes())
        prepare.write(trial/'executed-subject.json',{n:prepare.pin(subject/n) for n in prepare.RUNTIME})
        with (trial/'stdout.log').open('xb') as out,(trial/'stderr.log').open('xb') as err:
            try:
                process=subprocess.run([sys.executable,'-B',str(Path(__file__).resolve()),'--probe',str(subject),str(trial/'state')],stdout=out,stderr=err,timeout=25,
                    env={'PATH':'/usr/bin:/bin','HOME':str(prepare.EVIDENCE/'home'),'LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'})
            finally:path.write_bytes(original)
        restored={n:prepare.pin(subject/n) for n in prepare.RUNTIME}
        assert restored==original_pins,'sequence-source-restoration-differs'
        if fault:
            assert process.returncode==1 and 'AssertionError: '+fault[2] in (trial/'stderr.log').read_text(),(name,(trial/'stderr.log').read_text()[-2000:])
            outcome='KILLED'
        else:
            assert process.returncode==0,(name,(trial/'stderr.log').read_text()[-2000:]);outcome='SURVIVED' if name=='harmless-comment' else 'PASS'
        row={'trial':name,'outcome':outcome,'assertion':fault[2] if fault else None,'exitCode':process.returncode,
            'restored':restored,'stdoutSHA256':prepare.sha(trial/'stdout.log'),'stderrSHA256':prepare.sha(trial/'stderr.log')}
        prepare.write(trial/'receipt.json',row);rows.append(row)
    prepare.write(root/'result.json',{'rows':rows,'nativeOperations':0,
        'blind':'Captured actual query and synthetic output establish builder/transport/policy composition only. No native parsing, sequence state or restoration acceptance.'})
    print(json.dumps({'trials':len(rows),'namedFaults':len(faults),'harmlessSurvivors':1,'restoration':'exact','nativeOperations':0}))


if __name__=='__main__':main()
