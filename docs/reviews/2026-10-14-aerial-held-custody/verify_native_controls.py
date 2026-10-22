"""Challenge candidate SQL copies on fresh retained clones, never editing sources."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, reason):
    return code == 1 and output.rstrip().endswith(reason) and re.search(
        r'^AssertionError: '+re.escape(reason)+r'\s*$',output,re.MULTILINE
    ) is not None and 'SyntaxError:' not in output and 'TimeoutError:' not in output


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    migration=repo/'openplan/supabase/migrations/20261017000011_aerial_preserve_held_custody.sql'
    original=migration.read_bytes();source=original.decode();controls=[];oracles=[]
    (out/'original-candidate.sql').write_bytes(original)
    def execute(label,sql=None,case=None):
        candidate=out/(label+'.sql');candidate.write_bytes(original if sql is None else sql.encode())
        cmd=[sys.executable,'-B',str(Path(__file__).with_name('native_guard.py')),'--repo',str(repo),'--out',str(out/label),'--migration',str(candidate)]
        if case:cmd+=['--only',case]
        try:
            result=subprocess.run(cmd,capture_output=True,text=True,timeout=240)
        except subprocess.TimeoutExpired:
            from verify_upgrade_controls import cleanup_owned_cluster
            cleanup_owned_cluster()
            raise TimeoutError('Owned native row control deadline; cleanup requested') from None
        output=result.stdout+result.stderr;(out/(label+'-private.log')).write_text(output)
        return result.returncode,output
    def positive(label,sql=None):
        code,_=execute(label,sql);assert code==0,label+' native cohort succeeds'
        report=json.loads((out/label/'result.json').read_text());assert len(report['cases'])==4
        controls.append({'case':label,'outcome':'survived','retainedDatabase':report['database']})
    try:
        positive('baseline');positive('harmless-comment',source+'\n-- Harmless held custody comment.\n');positive('restored-after-harmless')
        cases=[('serialization-code-used',source.replace("ERRCODE = '23514'","ERRCODE = '40001'"),'direct','Direct late failure rejects replacement of held facts'),('held-state-guard-disabled',source.replace("IF OLD.state = 'held'","IF FALSE"),'concurrency','Concurrent late upsert rejects replacement after the held commit'),
            ('before-update-trigger-omitted',source.replace('BEFORE UPDATE ON public.aerial_artifact_custody','BEFORE INSERT ON public.aerial_artifact_custody'),'concurrency','Concurrent late upsert rejects replacement after the held commit')]
        for field in ['checksum_sha256','storage_path','byte_size','held_at','source_host','crs']:
            old="ARRAY['attempt_count', 'last_attempt_at', 'updated_at']";assert source.count(old)==2
            changed=source.replace(old,"ARRAY['attempt_count', 'last_attempt_at', 'updated_at', '"+field+"']")
            cases.append(('original-'+field+'-made-mutable',changed,'fields','Held field cannot change: '+field))
        for label,changed,case,reason in cases:
            assert changed!=source
            code,output=execute(label,changed,case)
            assert intended(code,output,reason),label+' reaches intended native failure'
            for name,c,o,r,wanted in [('exact',code,output,reason,True),('success',0,output,reason,False),('wrong-exit',2,output,reason,False),('wrong-diagnostic',code,output,'Unrelated failure',False),('source-only',code,reason,reason,False),('syntax',code,'SyntaxError: '+reason,reason,False),('timeout',code,'TimeoutError: '+reason,reason,False)]:
                actual=intended(c,o,r);assert actual==wanted,label+' oracle '+name
                oracles.append({'case':label,'oracle':name,'accepted':actual})
            assert migration.read_bytes()==original,'Candidate source remains unchanged'
            controls.append({'case':label,'outcome':'intended_failure','diagnostic':reason})
        positive('restored')
        for name,value in [('controls',controls),('oracles',oracles),('bindings',{str(migration.relative_to(repo)):hashlib.sha256(original).hexdigest(),'native_guard.py':hashlib.sha256(Path(__file__).with_name('native_guard.py').read_bytes()).hexdigest()})]:
            (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
        print({'positive':4,'faults':len(cases),'oracles':len(oracles)})
    finally:
        assert migration.read_bytes()==original,'Controls never alter the source candidate'


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
