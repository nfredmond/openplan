"""Collect modeled execution custody without reading any survey outcome field."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from prepare import E, m


def main():
    full=[]
    for receipt_name in ['full-runs.json','allocator-full-runs.json']:
        path=E/receipt_name
        if not path.exists():continue
        for entry in json.loads(path.read_text()):
            output=Path(entry['output']);name=output.name
            entry['configuration_family']=receipt_name
            entry['stages']={}
            for stage in ['prefix','suffix']:
                stem=name+'-'+stage;run=E/(stem+'.run.json');health=E/(stem+'.health.json')
                memory=E/(stem+'.memory.jsonl')
                if not run.exists():
                    entry['stages'][stage]={'status':'started_without_terminal_receipt' if (E/(stem+'.started.json')).exists() else 'not_run'};continue
                item={'run':json.loads(run.read_text()),'health':json.loads(health.read_text()) if health.exists() else None}
                with (E/(stem+'.systemd.final.log')).open('w') as stream:
                    subprocess.run(['journalctl','--user','-u','tbi-memory-'+stem+'.scope','--no-pager'],stdout=stream,stderr=subprocess.STDOUT)
                if memory.exists():
                    rows=[json.loads(line) for line in memory.read_text().splitlines()]
                    last=rows[-1]; peak=max(rows,key=lambda r:int(r['memory.current']))
                    stat=dict(line.split() for line in peak['memory.stat'].splitlines())
                    item['sampled_peak']={'elapsed_seconds':peak['elapsed_seconds'],'stage':peak['stage'],
                        'memory_current_bytes':int(peak['memory.current']),'memory_peak_counter_bytes':int(peak['memory.peak']),
                        'anon_bytes':int(stat['anon']),'file_bytes':int(stat['file']),
                        'process_memory_kib':peak.get('process_memory_kib')}
                    item['last_sample']=last
                entry['stages'][stage]=item
            entry['all_export_file_hashes']={p.name:m.digest(p) for p in output.glob('final_*.csv')}
            entry['checkpoint_file_hashes']={str(p.relative_to(output)):m.digest(p) for p in (output/'pipeline.parquetpipeline').rglob('*') if p.is_file()}
            full.append(entry)
    m.save('full-run-health.json',{'runs':full,'outcomes_accessed':False,
        'limits':'A missing terminal health receipt remains missing. Systemd journals establish OOM results and rounded lifetime peaks. Sampled peaks and last samples do not supply missing terminal event censuses. Partial exports, if present, are not completed outputs.'})
    comparisons={}
    for prefix in ['fit-2000','alloc-2000']:
        for arm in ['current','semcog']:
            path=E/(prefix+'-'+arm+'.comparison.json')
            if path.exists():comparisons[prefix+'-'+arm]=json.loads(path.read_text())
    m.save('parity-summary.json',comparisons)
    snapshots=E/'configurations';snapshots.mkdir(exist_ok=True)
    for cfg in m.R.glob('config-*'):
        shutil.copytree(cfg,snapshots/cfg.name,dirs_exist_ok=True)
    before=json.loads((E/'engine-custody.before.json').read_text())
    root=Path(before['installed_root'])
    m.save('engine-preservation.json',{'files':{n:m.digest(root/n)==sha for n,sha in before['files'].items()}})
    frozen=json.loads((E/'frozen-preservation.before.json').read_text())
    for item in frozen['files']:item['unchanged']=m.digest(m.REPO/item['path'])==item['sha256']
    frozen['all_unchanged']=all(item['unchanged'] for item in frozen['files'])
    m.save('frozen-preservation.final.json',frozen)
    m.save('source-closure.json',{'scripts':{p.name:m.digest(p) for p in E.glob('*.py')},
        'engine_custody_before_sha256':m.digest(E/'engine-custody.before.json'),
        'trained_cache_sha256':m.digest(m.R/'training-2000/cache/chunk_cache.csv'),
        'outcomes_accessed':False})
    for name in ['train-and-prove','prove-fit','profile-reduced','full','prove-allocator','profile-allocator','allocator-full']:
        src=m.R/(name+'.controller.log')
        if src.exists():shutil.copyfile(src,E/src.name)


if __name__=='__main__':main()
