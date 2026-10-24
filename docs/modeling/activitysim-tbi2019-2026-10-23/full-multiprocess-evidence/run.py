"""Continue admitted four-process execution without survey outcome access."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time

import activitysim
import pandas as pd

E = Path(__file__).resolve().parent
REPO = E.parents[3]
R = Path('/home/nathaniel/.local/state/openplan/tbi2019-full-multiprocess-20261024')
spec = importlib.util.spec_from_file_location('retained_replay', E.parent/'multiprocess-evidence/replay.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
prior = old.m.prior
prior.R = R
sys.path.insert(0, str(REPO/'scripts/modeling'))
from activitysim_choice_parity import compare_choices, IDENTITIES

digest = prior.digest


def save(name, data):
    (R/name).write_text(json.dumps(data, indent=2)+'\n')


def compare(arm, output):
    reference = json.loads((R/'freeze.json').read_text())['references'][arm]
    if {p.name:digest(p) for p in Path(reference['path']).glob('final_*.csv')} != reference['hashes']:
        raise RuntimeError('Reference custody mismatch')
    tables = compare_choices(reference['path'], output)
    for name in IDENTITIES:
        frames = [pd.read_csv(Path(root)/f'final_{name}.csv', float_precision='round_trip')
                  for root in [reference['path'], output]]
        if not frames[0].dtypes.equals(frames[1].dtypes):
            raise RuntimeError('Final table dtype mismatch: '+name)
    save(arm+'-comparison.json', {'status':'passed_choice_parity','dtypes_identical':True,'tables':tables})
    return tables


def prepare():
    R.mkdir(mode=0o700)
    prior.verify()
    frozen = json.loads((E.parent/'multiprocess-evidence/criterion-before-run.json').read_text())
    for path, expected in json.loads((E.parent/'multiprocess-evidence/engine-preservation.json').read_text())['files'].items():
        if digest(path) != expected:
            raise RuntimeError('Installed engine changed: '+path)
    for arm in ['current','semcog']:
        for part, source in [('prefix','prefix'),('suffix','suffix-r2')]:
            shutil.copytree(E.parent/f'multiprocess-evidence/config-{arm}-{source}', R/f'config-{arm}-{part}')
    shutil.copyfile(E/'monitor.py',R/'monitor.py')
    shutil.copyfile(E.parent/'prechunk-evidence/observe-scope.py',R/'observe-scope.py')
    save('freeze.json', {'recorded_unix':time.time(),'base_head':'ee8f3f4e462b0ccc3daf41c4ca6b59b3d22d79eb',
        'criterion':'Round 3 choice-level criterion; exact choices, identities, counts and dtypes; logsums/utilities within max(4 ULP, 1e-12 relative).',
        'references':frozen['references'],'num_processes':4,'memory_max_bytes':16*1024**3,'swap_max_bytes':0,
        'python':sys.version,'python_realpath':str(Path(sys.executable).resolve()),'activitysim':activitysim.__version__,
        'cache_sha256':digest(prior.CACHE),'source_sha256':digest(__file__),'monitor_sha256':digest(E/'monitor.py'),
        'config_hashes':{str(p.relative_to(R)):digest(p) for p in R.glob('config-*/*')},
        'outcomes_accessed':False})
    compare('current', old.m.R/'parity-current-r3')
    save('status.json', {'parity':{'current':'passed_choice_parity_retained','semcog':'not_run'},
        'full':{a:{'status':'not_run','final_hashes':{}} for a in ['current','semcog']},'outcomes_accessed':False})


def execute_arm(arm, subset):
    label = ('parity-' if subset else 'full-')+arm
    output=R/label
    output.mkdir(); (output/'cache').mkdir()
    shutil.copyfile(prior.CACHE, output/'cache/chunk_cache.csv')
    stock=Path(activitysim.__file__).parent/'examples/prototype_mtc/configs'
    original=prior.command
    def command(name,cfg,out,stock):
        cmd=original(name,cfg,out,stock)
        if subset:
            cmd[cmd.index('-d')+1]=str(prior.PRIOR/'inputs-2000')
        return cmd
    prior.command=command
    try:
        prior.run_stage('fullmp4-'+label+'-prefix', R/f'config-{arm}-prefix', output, stock)
        log=(R/('fullmp4-'+label+'-prefix.engine.log')).read_text()
        if 'initial_row_size is zero' in log:
            raise RuntimeError('Production cache coverage missing')
        old.check_checkpoint(output)
        old.r.validate_suffix(old.r.suffix_settings(arm))
        prior.run_stage('fullmp4-'+label+'-suffix', R/f'config-{arm}-suffix', output, stock)
        if subset:
            compare(arm,output)
        return {p.name:digest(p) for p in output.glob('final_*.csv')}
    finally:
        prior.command=original


def parity():
    state=json.loads((R/'status.json').read_text())
    try:
        execute_arm('semcog',True)
        state['parity']['semcog']='passed_choice_parity'
    except Exception as exc:
        state['parity']['semcog']='failed'; state['error']=str(exc)
        raise
    finally:
        save('status.json',state)


def full():
    state=json.loads((R/'status.json').read_text())
    if state['parity'] != {'current':'passed_choice_parity_retained','semcog':'passed_choice_parity'}:
        raise RuntimeError('Both parity admissions required')
    prior.verify()
    for arm in ['current','semcog']:
        state['full'][arm]['status']='running'; save('status.json',state)
        try:
            hashes=execute_arm(arm,False)
            state['full'][arm]={'status':'completed_pending_health','final_hashes':hashes}
        except Exception as exc:
            state['full'][arm]['status']='failed'; state['error']=str(exc)
            raise
        finally:
            save('status.json',state)


if __name__=='__main__':
    {'prepare':prepare,'parity':parity,'full':full}[sys.argv[1]]()
