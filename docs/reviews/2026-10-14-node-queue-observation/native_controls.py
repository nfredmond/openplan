"""Retained isolated SQL upgrade and process-observation controls. No hosted writes."""
import argparse
from datetime import datetime,timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


def intended_sql_failure(code,log,expected):
    return code==3 and re.findall(r'^ERROR:\s*(.*)$',log,re.M)==[expected]


def oracle_controls(out):
    reason='Original native process refusal'
    for log in ['ERROR:  '+reason+'\n','NOTICE: harmless\nERROR: '+reason+'\n']:
        assert intended_sql_failure(3,log,reason),'Native classifier positive differs'
    faults=[(0,'ERROR: '+reason),(1,'ERROR: '+reason),(3,'NOTICE: '+reason),
        (3,'ERROR: different'),(3,'ERROR: '+reason+'\nERROR: another'),(3,'ERROR: prefix '+reason)]
    for code,log in faults:assert not intended_sql_failure(code,log,reason),'Native classifier accepted unrelated failure'
    (out/'oracle-controls.json').write_text(json.dumps({'positiveControls':2,'refusedFaults':len(faults)},indent=2)+'\n')


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    oracle_controls(out)
    spec=importlib.util.spec_from_file_location('owned_native_definition',repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    definitions=importlib.util.module_from_spec(spec);spec.loader.exec_module(definitions)
    pg='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
    template='odm_held_restore_d056e9b4d2b34ada925a6b65f22f4fd8'
    info=json.loads(subprocess.check_output(['docker','inspect',pg]))[0]
    assert info['Id']==pg and info['Image']==definitions.PG_IMAGE
    assert info['Config']['Labels']['openplan.purpose']==definitions.PURPOSE
    assert info['HostConfig']['Memory']==info['HostConfig']['MemorySwap']==1073741824
    assert not info['HostConfig']['PortBindings'] and not info['State']['Running']
    database='node_observation_'+uuid.uuid4().hex;number=0;started=False
    migration=repo/'openplan/supabase/migrations/20261017000015_node_queue_process_observations.sql'
    source=migration.read_text();source_hash=hashlib.sha256(migration.read_bytes()).hexdigest()
    def sql(target,text,label,expected=None,user='postgres'):
        nonlocal number
        number+=1
        p=subprocess.run(['docker','exec','-i',pg,'psql','-XqAt','-U',user,'-d',target,'-v','ON_ERROR_STOP=1'],
            input=text.encode(),capture_output=True,timeout=40)
        log=p.stdout+p.stderr;(out/(f'{number:03d}-'+label+'-private.log')).write_bytes(log)
        if expected is None:
            assert p.returncode==0,'Owned native SQL failed: '+label
        else:
            assert intended_sql_failure(p.returncode,log.decode(errors='replace'),expected),'Native diagnostic differs: '+label
        return p.stdout.decode().strip()
    def history():return json.loads(sql(database,'SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;','history'))
    def apply(path):
        body=path.read_text();version,name=path.stem.split('_',1)
        lines=body.splitlines();content=[line for line in lines if line.strip().upper() not in ('BEGIN;','COMMIT;')]
        forms=[line.strip().upper() for line in lines if line.strip().upper() in ('BEGIN;','COMMIT;')]
        assert forms in ([],['BEGIN;','COMMIT;']),'Native transaction shape differs'
        tag='$node_observation_original_history$';assert tag not in body
        sql(database,'BEGIN;\n'+'\n'.join(content)+"\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('"+version+"','"+name+"',ARRAY["+tag+body+tag+']);\nCOMMIT;','apply-'+version,user='supabase_admin' if version=='20261017000013' else 'postgres')
    def replace(before,after):
        assert source.count(before)==1,'Native mutation anchor differs';return source.replace(before,after,1)
    def functions(text):
        matches=re.findall(r'CREATE FUNCTION public\.(?:record_node_queue_process_observation|read_node_queue_process_observations)\(.*?\$\$;',text,re.S)
        assert len(matches)==2,'Native function extraction differs'
        return '\n'.join(piece.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1) for piece in matches)
    controls=[]
    try:
        subprocess.run(['docker','start',pg],check=True,capture_output=True);started=True
        for _ in range(60):
            if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
            time.sleep(.1)
        else:raise AssertionError('Owned native cluster did not become ready')
        (out/'ownership.json').write_text(json.dumps({'database':database,'template':template,'container':pg,'retained':True},indent=2)+'\n')
        sql('postgres','CREATE DATABASE '+database+' TEMPLATE '+template+' OWNER postgres;','clone-retained-415')
        original=history();assert len(original)==415,'Retained fixture is not the recorded415 baseline'
        expected={p.name.split('_',1)[0] for p in (repo/'openplan/supabase/migrations').glob('*.sql') if not p.name.startswith('20261017000015_')}
        assert expected-set(original)=={'20261017000013','20261017000014'} and not set(original)-expected,'Selected417 upgrade source differs'
        for version in ('20261017000013','20261017000014'):
            paths=list((repo/'openplan/supabase/migrations').glob(version+'_*.sql'));assert len(paths)==1;apply(paths[0])
        assert set(history())==expected,'Selected417 schema history differs'
        apply(migration);assert len(history())==418,'Candidate418 schema history differs'
        catalog=json.loads(sql(database,"SELECT jsonb_build_object('tables',count(*),'rlsTables',count(*) FILTER(WHERE rowsecurity)) FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys';",'application-table-catalog'))
        assert catalog=={'tables':310,'rlsTables':310},'Candidate native table census differs'
        report={'checkedAt':datetime.now(timezone.utc).isoformat(),'database':database,'template':template,
            'originalHistory':415,'selectedMainHistory':417,'candidateHistory':418,'applicationCatalog':catalog,'migrationSha256':source_hash,
            'boundary':'Retained isolated logical SQL fixture. No hosted, PostgREST, worker, independent-host or whole-installation restore acceptance.'}
        (out/'database.json').write_text(json.dumps(report,indent=2)+'\n')
        probe=(repo/'docs/reviews/2026-10-14-node-queue-observation/native_probe.sql').read_text()
        for label,body in [('baseline',probe),('harmless','-- Harmless SQL probe comment.\n'+probe),('restored-after-harmless',probe)]:
            sql(database,'BEGIN;\n'+body+'\nROLLBACK;',label,user='supabase_admin');controls.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
        mutations=[
            ('registry',replace("('document-exports'),('engagement-email')","('foreign-process'),('engagement-email')"),'Process registry preserves every declared queue'),
            ('replay-refresh',replace('original.sequence<EXCLUDED.sequence','original.sequence<=EXCLUDED.sequence'),'Original replay cannot refresh process time'),
            ('late-revival',replace(" AND original.state<>'stopped'",''),'Stopped process cannot revive'),
            ('build-change',replace('      AND original.build_sha IS NOT DISTINCT FROM EXCLUDED.build_sha',''),'Changed build cannot replace process identity'),
            ('state-regression',replace("      AND (original.state<>'stopping' OR EXCLUDED.state IN ('stopping','stopped'))",''),'Stopping process cannot become running'),
            ('stale-window',replace("interval '2 minutes'","interval '2 days'"),'Old process observations remain stale'),
            ('future-time',replace("        WHEN latest.last_seen_at>stamp.observed_at THEN 'unknown'",''),'Future process observations remain unknown'),
            ('latest-stop-precedence',replace("WHEN alive.running_count>0 THEN 'observed_running'","WHEN latest.state='stopped' THEN 'last_observed_stopped'\n        WHEN alive.running_count>0 THEN 'observed_running'"),'Mixed latest and active process states remain separate'),
            ('claim-tier',replace("'jobCompletion','unassessed'","'jobCompletion','approved'"),'Process observation cannot approve jobs'),
        ]
        for label,changed,reason in mutations:
            sql(database,'BEGIN;\n'+functions(changed)+'\n'+probe+'\nROLLBACK;',label,reason,user='supabase_admin')
            controls.append({'control':label,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
        scale=(repo/'docs/reviews/2026-10-14-node-queue-observation/scale_probe.sql').read_text()
        for label,body in [('scale-baseline',scale),('scale-harmless','-- Harmless scale comment.\n'+scale),('scale-restored',scale)]:
            plan=sql(database,"BEGIN; SET LOCAL statement_timeout='3s';\n"+body+'\nROLLBACK;',label,user='supabase_admin')
            controls.append({'control':label,'outcome':'survived','retiredRows':10000,'runningRows':256,'statementTimeoutMs':3000,'executionMs':json.loads(plan)[0]['Execution Time']})
        inflated=replace("count(*) FILTER(WHERE state='running') AS running_count","(count(*) FILTER(WHERE state='running'))+1 AS running_count")
        sql(database,'BEGIN;\n'+functions(inflated)+'\n'+scale+'\nROLLBACK;','scale-inflated-count','Retired history cannot inflate active process counts',user='supabase_admin')
        controls.append({'control':'scale-inflated-count','outcome':'intended_failure','reason':'Retired history cannot inflate active process counts'})
        sql(database,'BEGIN;\n'+probe+'\nROLLBACK;','restored-final',user='supabase_admin');controls.append({'control':'restored-final','outcome':'survived'})
        (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
        print('Native logical SQL controls complete; retained database '+database,flush=True)
    finally:
        assert hashlib.sha256(migration.read_bytes()).hexdigest()==source_hash,'Native runner changed candidate source'
        if started:subprocess.run(['docker','stop','--time','10',pg],check=True,capture_output=True,timeout=20)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
