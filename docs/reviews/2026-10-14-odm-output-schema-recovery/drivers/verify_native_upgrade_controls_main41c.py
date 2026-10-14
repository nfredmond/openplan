"""Exercise the selected-schema upgrade and output recovery with bounded native controls."""
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path

def intended(code,text,reason):
    return code==1 and re.findall(r'^([A-Za-z_][\w.]*Error:.*)$',text,re.MULTILINE)==['AssertionError: '+reason]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in ['repo','proof','out']:p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args();repo=a.repo.resolve();out=a.out.resolve();out.mkdir(mode=0o700);os.umask(0o077)
    producer=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-output-schema-recovery-20261014/native_upgrade_restore_main41c.py');observer=repo/'workers/odm_worker/runtime_observation.py';intake=repo/'workers/odm_worker/runtime_output_intake.py'
    originals={f:f.read_bytes() for f in [producer,observer,intake]};rows=[]
    reason='Current schema upgrade must install the exact main migration set';diagnostic='Traceback (most recent call last):\nAssertionError: '+reason+'\n';oracles=[]
    for name,code,text,accept in [('baseline',1,diagnostic,True),('harmless',1,diagnostic+'# Comment\n',True),('restored',1,diagnostic,True),('wrong-exit',0,diagnostic,False),('wrong-reason',1,diagnostic.replace(reason,'Unrelated'),False),('wrong-kind',1,diagnostic.replace('AssertionError','ValueError'),False),('extra-error',1,diagnostic+'ValueError: Extra\n',False),('missing-error',1,'',False)]:
        assert intended(code,text,reason)==accept,'Schema control oracle accepted an unrelated outcome';oracles.append({'case':name,'accepted':accept})
    (out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
    def restore():
        for f,data in originals.items():f.write_bytes(data)
    def phase(label,variant='baseline',expected=None):
        r=subprocess.run([sys.executable,'-B',str(producer),'--repo',str(repo),'--proof',str(a.proof.resolve()),'--out',str(out/(label+'-private')),'--variant',variant],capture_output=True,text=True,timeout=600,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        text=r.stdout+r.stderr;(out/(label+'-private.log')).write_text(text)
        if expected:
            assert intended(r.returncode,text,expected),'Wrong native schema failure: '+label
            row={'case':label,'outcome':'intended_failure','reason':expected}
        else:
            assert r.returncode==0,'Native schema positive failed: '+label
            data=json.loads((out/(label+'-private/result.json')).read_bytes());assert data['historyBefore']==406 and data['historyAfter']==409
            row={'case':label,'outcome':'survived','historyBefore':406,'historyAfter':409}
        stopped=json.loads((out/(label+'-private/stopped.json')).read_bytes());assert all(not x['running'] and not x['oomKilled'] for x in stopped)
        rows.append(row);(out/'partial-controls.json').write_text(json.dumps(rows,indent=2)+'\n');print(label+': '+row['outcome'],flush=True)
    def mutate(path,old,new):
        assert originals[path].count(old)==1,'Mutation source differs';path.write_bytes(originals[path].replace(old,new))
    try:
        phase('baseline');producer.write_bytes(originals[producer]+b'\n# Harmless native recovery comment.\n');phase('harmless-source');restore();phase('harmless-sql','harmless');phase('missing-main-migration','missing-migration',reason)
        old=b"env['PGRST_DB_URI']=urlunsplit((uri.scheme,uri.netloc,'/'+database,uri.query,uri.fragment))";mutate(producer,old,b"env['PGRST_DB_URI']=oldenv['PGRST_DB_URI']");phase('rest-points-to-old-database',expected='Owned schema REST must use its selected restored database');restore()
        mutate(observer,b"        if observed['authorizedNow'] is not True:",b'        if False:');phase('revoked-actor-ignored',expected='Current schema recovery must refuse revoked actor access');restore()
        old=b" archive=next(root.glob('preparation-*/output-archive'));assert digest";new=b" archive=next(root.glob('preparation-*/output-archive'))\n with (archive/'archive.zip').open('ab') as stream:stream.write(b'changed native retained bytes')\n assert digest";mutate(producer,old,new);phase('copied-output-corrupted',expected='Current schema physical output bytes differ');restore()
        old=b"                'callbackPermission': False, 'publicationPermission': False}";mutate(intake,old,old.replace(b"'publicationPermission': False",b"'publicationPermission': True"));phase('publication-promoted',expected='Current schema recovery must preserve exact output custody and claim tiers');restore()
        phase('restored','restored');(out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        bindings={(str(f.relative_to(repo)) if f.is_relative_to(repo) else str(f)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [producer,observer,intake,Path(__file__)]};(out/'source-bindings.json').write_text(json.dumps(bindings,indent=2)+'\n')
        group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/');(out/'resources.json').write_text(json.dumps({k:(group/k).read_text().strip() for k in ['memory.max','memory.peak','memory.swap.max','memory.swap.peak','memory.events']},indent=2)+'\n')
    finally:
        restore()
        for f,data in originals.items():assert f.read_bytes()==data

if __name__=='__main__':main()
