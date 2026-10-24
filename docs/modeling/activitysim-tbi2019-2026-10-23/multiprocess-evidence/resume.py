"""Correct the stock MP checkpoint name without replaying its completed prefix."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time

import yaml
import activitysim

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('mp_run',E/'run.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
R=m.R


def suffix_settings(arm):
    settings=m.settings(arm,'suffix')
    models=yaml.safe_load((m.prior.INPUT/'bundle/configs/settings.yaml').read_text())['models']
    settings.update(resume_after='mp_households',models=models[models.index('trip_scheduling'):])
    return settings


def validate_suffix(settings):
    expected=yaml.safe_load((m.prior.INPUT/'bundle/configs/settings.yaml').read_text())['models']
    expected=expected[expected.index('trip_scheduling'):]
    if (settings['resume_after'] != 'mp_households' or settings['models'] != expected
            or settings['multiprocess'] is not False or settings['chunk_size'] != 0
            or settings['chunk_training_mode'] != 'disabled'):
        raise RuntimeError('Suffix must restore the coalesced MP checkpoint and execute only the unchanged unchunked suffix')


def prepare():
    frozen=json.loads((R/'criterion-before-run.json').read_text())
    m.save('status.initial.json',json.loads((R/'status.json').read_text()))
    # Preserve the failed suffix and the completed prefix with independent bytes.
    shutil.copytree(R/'parity-current',R/'parity-current-r2')
    for arm in ['current','semcog']:
        target=R/f'config-{arm}-suffix-r2'
        shutil.copytree(R/f'config-{arm}-suffix',target)
        settings=suffix_settings(arm); validate_suffix(settings)
        (target/'settings.yaml').write_text(yaml.safe_dump(settings,sort_keys=False))
    copied={str(p.relative_to(R/'parity-current-r2')):m.digest(p) for p in (R/'parity-current-r2').rglob('*') if p.is_file()}
    original={str(p.relative_to(R/'parity-current')):m.digest(p) for p in (R/'parity-current').rglob('*') if p.is_file()}
    if copied != original:
        raise RuntimeError('Copied checkpoint custody differs')
    m.save('resume-before-run.json',{'recorded_unix':time.time(),'criterion_unchanged':frozen['criterion'],
        'source_sha256':m.digest(__file__),'configuration_hashes':{str(p.relative_to(R)):m.digest(p) for p in R.glob('config-*-suffix-r2/*')},
        'copied_current_files':copied,'reason':'Stock mp_tasks.run_simulation saves step_info.name as the final checkpoint; coalesce retains that name. The failed suffix requested a model checkpoint absent from the coalesced store.',
        'source':'https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/mp_tasks.py#L1059-L1066',
        'prefix_replayed':False,'outcomes_accessed':False})


def execute():
    stock=Path(activitysim.__file__).parent/'examples/prototype_mtc/configs'
    status={'parity':{'current':'not_run','semcog':'not_run'},'full':{a:{'status':'not_run','final_hashes':{}} for a in ['current','semcog']},'outcomes_accessed':False}
    original=m.prior.command
    def command(name,cfg,output,stock):
        cmd=original(name,cfg,output,stock); cmd[cmd.index('-d')+1]=str(m.prior.PRIOR/'inputs-2000'); return cmd
    m.prior.command=command
    for arm in ['current','semcog']:
        out=R/('parity-current-r2' if arm=='current' else 'parity-semcog')
        try:
            if arm=='semcog':
                out.mkdir(); (out/'cache').mkdir(); shutil.copyfile(m.prior.CACHE,out/'cache/chunk_cache.csv')
                m.prior.run_stage('mp4-semcog-prefix',R/'config-semcog-prefix',out,stock)
                log=(R/'mp4-semcog-prefix.engine.log').read_text()
                m.save('semcog-chunks.json',m.chunk_evidence(log))
                if 'initial_row_size is zero' in log:
                    raise RuntimeError('Production cache coverage missing')
            m.prior.run_stage('mp4-'+arm+'-suffix-r2',R/f'config-{arm}-suffix-r2',out,stock)
            m.compare(arm,out)
            status['parity'][arm]='passed_exact_parity'
            m.save('status.json',status)
        except Exception as exc:
            status['parity'][arm]='failed'; status['error']=str(exc); m.save('status.json',status)
            raise


if __name__=='__main__':
    {'prepare':prepare,'execute':execute}[sys.argv[1]]()
