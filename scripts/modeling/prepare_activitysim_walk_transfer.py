#!/usr/bin/env python3
"""Prepare synthetic or input-only development archives and freeze the study lock."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from activitysim_walk_transfer import ROOT, PACKAGE, SCHEMA, digest

BUNDLE_FILES = ('households.csv', 'persons.csv', 'land_use.csv', 'skims/mtc_skims.omx',
                'configs/settings.yaml', 'configs/network_los.yaml')


def zip_bundle(bundle: Path, target: Path):
    if target.exists():
        raise ValueError('source archive already exists')
    files = {}
    with zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as z:
        for filename in BUNDLE_FILES:
            path = bundle / filename
            files[filename] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
            z.write(path, filename)
    return files


def synthetic(bundle: Path, stock: Path):
    import numpy as np
    import openmatrix as omx
    import pandas as pd
    from activitysim_mtc_inputs import mtc_settings_yaml, mtc_network_los_yaml
    bundle.mkdir()
    (bundle / 'configs').mkdir()
    (bundle / 'skims').mkdir()
    (bundle / 'configs/settings.yaml').write_text(mtc_settings_yaml())
    (bundle / 'configs/network_los.yaml').write_text(mtc_network_los_yaml())
    zones = list(range(1, 7))
    hh, persons = [], []
    for i in range(1, 61):
        hh.append({'household_id': i, 'home_zone_id': zones[(i-1) % 6], 'income': 20000+i*1000,
                   'hhsize': 4, 'HHT': 1, 'auto_ownership': i % 4, 'num_workers': 2})
        for j, (age, pemploy, pstudent, ptype) in enumerate([(40,1,3,1), (35,2,3,2), (10,4,1,7), (70,3,3,5)], 1):
            persons.append({'person_id': (i-1)*4+j, 'household_id': i, 'age': age, 'PNUM': j,
                            'sex': 1+j%2, 'pemploy': pemploy, 'pstudent': pstudent, 'ptype': ptype})
    pd.DataFrame(hh).to_csv(bundle / 'households.csv', index=False)
    pd.DataFrame(persons).to_csv(bundle / 'persons.csv', index=False)
    lu=[]
    for z in zones:
        lu.append(dict(zone_id=z,DISTRICT=1,SD=1,county_id=0,TOTHH=40,TOTPOP=160,TOTACRE=200,
                       RESACRE=100,CIACRE=50,TOTEMP=120,AGE0519=30,RETEMPN=20,FPSEMPN=20,HEREMPN=20,
                       OTHEMPN=20,AGREMPN=20,MWTEMPN=20,PRKCST=0,OPRKCST=0,area_type=4,HSENROLL=40,
                       COLLFTE=40,COLLPTE=10,TOPOLOGY=1,TERMINAL=1))
    pd.DataFrame(lu).to_csv(bundle / 'land_use.csv', index=False)
    # Only the stock matrix-name vocabulary is read; all numeric cells are synthetic.
    with omx.open_file(str(stock.parent / 'data/skims.omx'), 'r') as original:
        names = list(original.list_matrices())
    dist = (np.abs(np.arange(6)[:,None]-np.arange(6)[None,:])+.25).astype(float)
    with omx.open_file(str(bundle / 'skims/mtc_skims.omx'), 'w') as out:
        out.create_mapping('ZONE', zones)
        for name in names:
            if 'DIST' in name: a=dist
            elif 'TIME' in name and not any(t in name for t in ('TRN','WLK','DRV')): a=dist*3
            else: a=np.zeros((6,6))
            out[name]=a


def environment_manifest():
    import importlib.metadata as md
    import activitysim
    root = Path(activitysim.__file__).parent
    sources = {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*.py'))}
    return {'packages': {n: md.version(n) for n in ('activitysim','numpy','pandas','numba','scipy','openmatrix','PyYAML','tables','pyarrow')},
            'activitysim_python_files': sources, 'python': sys.version}


def freeze(run: Path, archive: Path, stock: Path, study_id: str):
    script = ROOT / 'scripts/modeling/activitysim_walk_transfer.py'
    def entry(p): return {'path': str(p.resolve()), 'sha256': digest(p)}
    files = [script, Path(__file__).resolve(), ROOT/'scripts/modeling/activitysim_accepted_components.py',
             ROOT/'scripts/modeling/activitysim_mtc_inputs.py', ROOT/'scripts/modeling/screening_metrics.py',
             ROOT/'scripts/research/sealed_study.py', ROOT/'scripts/research/streaming_zip_csv.py',
             ROOT/'docs/modeling/activitysim-coefficients-2026-10-23/PREREGISTRATION.md',
             ROOT/'docs/modeling/activitysim-coefficients-2026-10-23/stock-files.json',
             ROOT/'data/modeling/activitysim-accepted-components.json',
             ROOT/'data/modeling/auto-ownership-fresh-holdout-2026-08-19-result.json', run/'environment.json']
    files += [p for p in sorted(PACKAGE.rglob('*')) if p.is_file()]
    files += [p for p in sorted((ROOT/'data/modeling/activitysim-auto-ownership-national-v1').glob('*')) if p.is_file()]
    entries=[entry(p) for p in files]
    closure=hashlib.sha256(json.dumps(entries,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    scratch=run/'scratch'; scratch.mkdir()
    command=[sys.executable,str(script),'evaluate',str(archive),str(scratch),str(stock),str(PACKAGE/'overlay'),str(scratch/'candidate.json'),study_id]
    lock={'schema_version':'openplan.sealed-study.lock.v1','study_id':study_id,'status':'frozen_unopened',
          'working_directory':str(ROOT),'scratch_directory':str(scratch),'lease_path':str(run/'lease.json'),
          'receipt_path':str(run/'receipt.json'),'candidate_result_path':str(scratch/'candidate.json'),
          'aggregate_result_path':str(run/'aggregate.json'),'candidate_result_schema_version':SCHEMA,
          'evaluator':{'command':command,'files':entries,'closure_sha256':closure},
          'validator':{'command':[sys.executable,str(ROOT/'scripts/modeling/validate_activitysim_walk_transfer.py'),str(scratch/'candidate.json')],
                       'files':[entry(ROOT/'scripts/modeling/validate_activitysim_walk_transfer.py')],
                       'closure_sha256':hashlib.sha256(json.dumps([entry(ROOT/'scripts/modeling/validate_activitysim_walk_transfer.py')],sort_keys=True,separators=(',',':')).encode()).hexdigest()},
          'sources':[{'name':'development_input_bundle','path':str(archive),'sha256':digest(archive),'selected_members':list(BUNDLE_FILES)}],
          'output_policy':{'maximum_bytes':10485760,'prohibited_fields':['person_id','household_id','tour_id','trip_id'],
                           'prohibited_array_fields':['replicates','replicate_results']}}
    (run/'lock.json').write_text(json.dumps(lock,indent=2)+'\n')


def require_development_bundle(bundle: Path):
    if '/runs/dev/' not in str(bundle) or bundle.name != 'activitysim_bundle':
        raise ValueError('development input partition required')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('kind',choices=['synthetic','development'])
    p.add_argument('--run',type=Path,required=True)
    p.add_argument('--stock',type=Path,required=True)
    p.add_argument('--bundle',type=Path)
    a=p.parse_args(); run=a.run.resolve(); stock=a.stock.resolve()
    run.mkdir(parents=True,exist_ok=False)
    if a.kind=='synthetic':
        bundle=run/'synthetic-inputs'; synthetic(bundle,stock)
    else:
        if a.bundle is None: p.error('development requires --bundle')
        bundle=a.bundle.resolve()
        require_development_bundle(bundle)
    files=zip_bundle(bundle,run/'inputs.zip')
    (run/'input-manifest.json').write_text(json.dumps({'source_path':str(bundle),'role':a.kind,'files':files},indent=2)+'\n')
    (run/'environment.json').write_text(json.dumps(environment_manifest(),indent=2)+'\n')
    freeze(run,run/'inputs.zip',stock,'walk-transfer-'+a.kind+'-20261023')
    print(run/'lock.json')

if __name__=='__main__': main()
