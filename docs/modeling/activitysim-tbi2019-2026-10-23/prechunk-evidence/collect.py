"""Retain modeled resource metadata and immutable artifact custody after execution."""
import gzip
import json
from pathlib import Path
import re
import shutil
import subprocess
from prepare import E, m


def collect():
    runs = []
    for receipt in sorted(E.glob('*.run.json')):
        name = receipt.name.removesuffix('.run.json')
        health = E/(name+'.health.json')
        record = {'name':name,'run':json.loads(receipt.read_text()),
                  'health':json.loads(health.read_text()) if health.exists() else None}
        groups = {}
        stage = 'startup'
        memory = E/(name+'.memory.jsonl')
        if memory.exists():
            for line in memory.open():
                row = json.loads(line)
                match = re.search(r'(initialize_landuse|initialize_households|compute_accessibility|school_location|workplace_location|auto_ownership|free_parking|cdap|mandatory_tour|joint_tour|non_mandatory_tour|tour_mode_choice|atwork_subtour|stop_frequency|trip_purpose|trip_destination|trip_scheduling|trip_mode_choice|write_tables|write_data_dictionary)',row['stage'])
                if match:
                    stage = match.group(1)
                group = groups.setdefault(stage, {'sampled_peak_bytes':0,'sampled_anon_peak_bytes':0,'sampled_file_peak_bytes':0,'samples':0})
                stat = dict(x.split() for x in row['memory.stat'].splitlines())
                group['samples'] += 1
                group['sampled_peak_bytes'] = max(group['sampled_peak_bytes'],int(row['memory.current']))
                for field in ['anon','file']:
                    key = 'sampled_'+field+'_peak_bytes'
                    group[key] = max(group[key],int(stat[field]))
                record['last_sample'] = row
        record['sampled_stage_groups'] = groups
        runs.append(record)
        if name.startswith('full-'):
            with (E/(name+'.systemd.final.log')).open('w') as stream:
                subprocess.run(['journalctl','--user','-u','tbi-prechunk-'+name+'.scope','--no-pager'],stdout=stream,stderr=subprocess.STDOUT)
    m.save('run-health-summary.json', {'runs':runs, 'outcomes_accessed':False,
        'limits':'Stage peaks are one-second lower-bound samples. Missing terminal scope receipts stay missing. No completed full travel outputs are inferred from checkpoints.'})
    for cfg in m.R.glob('config-*'):
        shutil.copytree(cfg,E/'configurations'/cfg.name,dirs_exist_ok=True)
    source = json.loads((E/'installed-source.json').read_text())
    engine = {name:m.digest(Path(source['root'])/name)==sha for name,sha in source['files'].items()}
    prior = json.loads((E.parent/'memory-fit-evidence/engine-custody.before.json').read_text())
    prior_engine = {name:m.digest(Path(prior['installed_root'])/name)==sha for name,sha in prior['files'].items()}
    additional = json.loads((E/'additional-source.json').read_text())
    extra = {name:m.digest(Path(additional['root'])/name)==sha for name,sha in additional['files'].items()}
    frozen = json.loads((E.parent/'memory-fit-evidence/frozen-preservation.before.json').read_text())
    for item in frozen['files']:
        item['unchanged'] = m.digest(m.REPO/item['path']) == item['sha256']
    frozen['all_unchanged'] = all(item['unchanged'] for item in frozen['files'])
    m.save('frozen-preservation.json',frozen)
    m.save('engine-preservation.json',{'files':engine,'prior_ten_files':prior_engine,'additional_files':extra,
        'all_unchanged':all(engine.values()) and all(prior_engine.values()) and all(extra.values())})
    logs = []
    for path in sorted([*E.glob('*.engine.log'),*E.glob('*.memory.jsonl'),*E.glob('*.profile.jsonl'),*m.R.glob('*.controller.log')]):
        target = E/(path.name+'.gz')
        raw = path.read_bytes()
        with target.open('wb') as out:
            with gzip.GzipFile(filename='',mode='wb',fileobj=out,mtime=0) as compressed:
                compressed.write(raw)
        logs.append({'raw_path':str(path), 'raw_bytes':len(raw), 'raw_sha256':m.digest(path),
                     'compressed_name':target.name,'compressed_sha256':m.digest(target),
                     'inflates_identically':gzip.decompress(target.read_bytes())==raw})
    m.save('log-custody.json',logs)
    m.save('source-custody.json',{p.name:m.digest(p) for p in E.glob('*.py')})


if __name__ == '__main__':
    collect()
