"""Prove four-process household slicing against retained exact references."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time

import activitysim
import yaml

E = Path(__file__).resolve().parent
REPO = E.parents[3]
R = Path('/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024')
spec = importlib.util.spec_from_file_location('prior16', E.parent/'full16-evidence/run.py')
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
prior.R = R
digest = prior.digest
sys.path.insert(0, str(REPO/'scripts/modeling'))
from activitysim_chunk_parity import compare_tables, chunk_evidence

PROCESS_COUNT = 4
CHUNK = 268435456
BOUNDARY = 'trip_purpose_and_destination'


def save(name, value):
    (R/name).write_text(json.dumps(value, indent=2)+'\n')


def settings(arm, part):
    result = yaml.safe_load((E.parent/f'full16-evidence/config-{arm}-{part}/settings.yaml').read_text())
    if part == 'prefix':
        result.update(multiprocess=True, num_processes=PROCESS_COUNT, fail_fast=True,
                      use_shadow_pricing=False, want_dest_choice_sample_tables=False)
        result['multiprocess_steps'] = [
            {'name':'mp_initialize', 'begin':'initialize_landuse', 'num_processes':1, 'chunk_size':CHUNK},
            {'name':'mp_households', 'begin':'school_location', 'num_processes':PROCESS_COUNT,
             'chunk_size':CHUNK, 'slice':{'tables':['households','persons']}},
        ]
    return result


def validate_settings(prefix, suffix):
    """Refuse slicing or chunking of the cohort-sensitive scheduling suffix."""
    if (prefix['models'][-1] != BOUNDARY or 'trip_scheduling' in prefix['models']
            or suffix['multiprocess'] is not False or suffix['chunk_size'] != 0
            or suffix['chunk_training_mode'] != 'disabled' or suffix['resume_after'] != BOUNDARY):
        raise RuntimeError('Trip scheduling must remain coalesced, single-process and unchunked')
    steps = prefix['multiprocess_steps']
    if (prefix['num_processes'] != PROCESS_COUNT or steps[1]['num_processes'] != PROCESS_COUNT
            or steps[1]['slice'] != {'tables':['households','persons']}
            or steps[1]['chunk_size'] != CHUNK or prefix['chunk_training_mode'] != 'production'):
        raise RuntimeError('Household slicing or per-process production settings differ')


def prepare():
    R.mkdir(mode=0o700)
    prior.verify()
    shutil.copyfile(E/'monitor.py', R/'monitor.py')
    shutil.copyfile(E.parent/'prechunk-evidence/observe-scope.py', R/'observe-scope.py')
    for arm in ['current','semcog']:
        prefix, suffix = settings(arm,'prefix'), settings(arm,'suffix')
        validate_settings(prefix,suffix)
        for part, cfg in [('prefix',prefix),('suffix',suffix)]:
            target=R/f'config-{arm}-{part}'
            shutil.copytree(E.parent/f'full16-evidence/config-{arm}-{part}', target)
            (target/'settings.yaml').write_text(yaml.safe_dump(cfg, sort_keys=False))
            logging = yaml.safe_load((target/'logging.yaml').read_text())
            logging['logging']['formatters']['elapsedFormatter']['format'] = '[{elapsedTime}] {process:d} {processName:s} {levelname:s}: {message:s}'
            (target/'logging.yaml').write_text(yaml.safe_dump(logging, sort_keys=False))
    installed = Path(activitysim.__file__).parent
    engine = json.loads((E.parent/'full16-evidence/engine-preservation.json').read_text())['files']
    for path, expected in engine.items():
        if digest(path) != expected:
            raise RuntimeError('Installed source custody mismatch: '+path)
    engine[str(installed/'core/mp_tasks.py')] = digest(installed/'core/mp_tasks.py')
    save('engine-before.json',engine)
    references={}
    for arm, name in [('current','r2-2000-current-reference'),('semcog','r3-2000-semcog-reference')]:
        files = {p.name:digest(p) for p in (prior.REFERENCES/name).glob('final_*.csv')}
        expected=json.loads(prior.source(f'chunk-cause-evidence/{name}.run.json').read_text())['final_files']
        if files != expected:
            raise RuntimeError('Reference custody mismatch')
        references[arm]={'path':str(prior.REFERENCES/name),'hashes':files}
    save('criterion-before-run.json',{
        'recorded_unix':time.time(), 'base_head':'0a6005948542e48361b333926ba6f7674aceb78d',
        'criterion':'Exact values, dtypes, columns, unique row identities and counts in all seven reference tables. No logsum or utility tolerance.',
        'stop':'Any parity failure stops every subsequent engine run. Any cap failure stops every subsequent arm.',
        'households':2000,'persons':4971,'zones':634,'num_processes':PROCESS_COUNT,
        'prefix_chunk_bytes_per_process':CHUNK,'suffix_multiprocess':False,'suffix_chunk_bytes':0,
        'memory_max_bytes':16*1024**3,'swap_max_bytes':0,'python':sys.version,
        'python_realpath':str(Path(sys.executable).resolve()),'activitysim':activitysim.__version__,
        'references':references,'source_sha256':digest(__file__),'monitor_sha256':digest(E/'monitor.py'),
        'cache_sha256':digest(prior.CACHE),'outcomes_accessed':False,
        'config_hashes':{str(p.relative_to(R)):digest(p) for p in R.glob('config-*/*') if p.is_file()},
        'sizing_before_parity':{'full_households_per_slice_max':265151,
          'prior_single_process_cap_bytes':17179869184,
          'warning':'A killed 16 GiB run is a censored lower bound. Dividing by four gives at least 4 GiB per process, then four simultaneous processes still total at least 16 GiB before duplicated overhead. Full admission requires measured subset accounting; no safe full-run fit is established yet.'}})
    save('status.json',{'parity':{a:'not_run' for a in ['current','semcog']},
        'full':{a:{'status':'not_run','final_hashes':{}} for a in ['current','semcog']},'outcomes_accessed':False})


def compare(arm, out):
    reference=json.loads((R/'criterion-before-run.json').read_text())['references'][arm]
    if {p.name:digest(p) for p in Path(reference['path']).glob('final_*.csv')} != reference['hashes']:
        raise RuntimeError('Reference changed after freeze')
    try:
        tables=compare_tables(reference['path'],out)
    except AssertionError as exc:
        save(arm+'-comparison.json',{'status':'failed_exact_parity','error':str(exc),
            'reference':reference,'candidate_hashes':{p.name:digest(p) for p in out.glob('final_*.csv')}})
        raise
    save(arm+'-comparison.json',{'status':'passed_exact_parity','tables':tables})


def parity():
    status=json.loads((R/'status.json').read_text())
    stock=Path(activitysim.__file__).parent/'examples/prototype_mtc/configs'
    for arm in ['current','semcog']:
        out=R/('parity-'+arm)
        out.mkdir(); (out/'cache').mkdir()
        shutil.copyfile(prior.CACHE,out/'cache/chunk_cache.csv')
        try:
            # The shared prior controller supplies the 16 GiB all-descendant scope and external observer.
            original=prior.command
            def command(name,cfg,output,stock):
                cmd=original(name,cfg,output,stock)
                cmd[cmd.index('-d')+1]=str(prior.PRIOR/'inputs-2000')
                cmd[3]='--unit=tbi16-'+name
                return cmd
            prior.command=command
            for part in ['prefix','suffix']:
                prior.run_stage('mp4-'+arm+'-'+part,R/f'config-{arm}-{part}',out,stock)
                if part == 'prefix':
                    log=(R/f'mp4-{arm}-prefix.engine.log').read_text()
                    chunks=chunk_evidence(log)
                    if 'initial_row_size is zero' in log:
                        raise RuntimeError('Production cache coverage missing')
                    save(arm+'-chunks.json',chunks)
            compare(arm,out)
            status['parity'][arm]='passed_exact_parity'
        except Exception as exc:
            status['parity'][arm]='failed'
            status['error']=str(exc)
            save('status.json',status)
            raise
        finally:
            prior.command=original
        save('status.json',status)


if __name__=='__main__':
    {'prepare':prepare,'parity':parity}[sys.argv[1]]()
