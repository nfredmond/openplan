"""Repeat the prefix after the unsuccessful stock restore reset its inventory."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time

import activitysim
import pandas as pd

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('resume_mp',E/'resume.py')
r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
m=r.m; R=m.R


def check_checkpoint(output):
    inventory=pd.read_parquet(output/'pipeline.parquetpipeline/checkpoints.parquet')
    if 'mp_households' not in inventory['checkpoint_name'].tolist():
        raise RuntimeError('Missing coalesced checkpoint; refuse stock restore')


def execute():
    m.save('status.resume.json',json.loads((R/'status.json').read_text()))
    m.save('replay-before-run.json',{'recorded_unix':time.time(),'source_sha256':m.digest(__file__),
        'criterion_sha256':m.digest(R/'criterion-before-run.json'),
        'reason':'The first absent-checkpoint restore overwrote the coalesced inventory with init. The copied inventory therefore also lacked mp_households. Preserve both failures, repeat into a new directory, then validate inventory before restoring the correctly named checkpoint.',
        'models_changed':False,'outcomes_accessed':False})
    stock=Path(activitysim.__file__).parent/'examples/prototype_mtc/configs'
    status={'parity':{'current':'not_run','semcog':'not_run'},'full':{a:{'status':'not_run','final_hashes':{}} for a in ['current','semcog']},'outcomes_accessed':False}
    original=m.prior.command
    def command(name,cfg,output,stock):
        cmd=original(name,cfg,output,stock); cmd[cmd.index('-d')+1]=str(m.prior.PRIOR/'inputs-2000'); return cmd
    m.prior.command=command
    for arm in ['current','semcog']:
        out=R/('parity-'+arm+'-r3'); out.mkdir(); (out/'cache').mkdir()
        shutil.copyfile(m.prior.CACHE,out/'cache/chunk_cache.csv')
        try:
            m.prior.run_stage('mp4-r3-'+arm+'-prefix',R/f'config-{arm}-prefix',out,stock)
            log=(R/f'mp4-r3-{arm}-prefix.engine.log').read_text()
            m.save(arm+'-r3-chunks.json',m.chunk_evidence(log))
            if 'initial_row_size is zero' in log:
                raise RuntimeError('Production cache coverage missing')
            check_checkpoint(out)
            r.validate_suffix(r.suffix_settings(arm))
            m.prior.run_stage('mp4-r3-'+arm+'-suffix',R/f'config-{arm}-suffix-r2',out,stock)
            m.compare(arm,out)
            status['parity'][arm]='passed_exact_parity'; m.save('status.json',status)
        except Exception as exc:
            status['parity'][arm]='failed'; status['error']=str(exc); m.save('status.json',status)
            raise


if __name__=='__main__':
    execute()
