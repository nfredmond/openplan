"""Inspect retained modeled tables and checkpoints after the exact parity stop."""
import json
import math
from pathlib import Path

import pandas as pd

R=Path('/home/nathaniel/.local/state/openplan/tbi2019-multiprocess-20261024')
reference=Path(json.loads((R/'criterion-before-run.json').read_text())['references']['current']['path'])
candidate=R/'parity-current-r3'
KEYS={'accessibility':'zone_id','land_use':'zone_id','households':'household_id',
      'persons':'person_id','tours':'tour_id','trips':'trip_id','joint_tour_participants':'participant_id'}


def differences(a,b):
    different=~((a==b)|(a.isna()&b.isna()))
    cells=[]
    for column in a.columns[different.any()]:
        for key in a.index[different[column]]:
            av,bv=a.at[key,column],b.at[key,column]
            cell={'id':int(key),'field':column,'reference':av.item() if hasattr(av,'item') else av,
                  'candidate':bv.item() if hasattr(bv,'item') else bv}
            if isinstance(av,float) and isinstance(bv,float):
                cell.update(reference_hex=av.hex(),candidate_hex=bv.hex(),absolute_difference=abs(av-bv),
                    max_ulp_difference=abs(av-bv)/max(math.ulp(av),math.ulp(bv)))
            cells.append(cell)
    return {'different_cells':len(cells),'different_records':int(different.any(axis=1).sum()),'cells':cells}


def main():
    rows=[]
    for name,key in KEYS.items():
        a=pd.read_csv(reference/f'final_{name}.csv',float_precision='round_trip').set_index(key).sort_index()
        b=pd.read_csv(candidate/f'final_{name}.csv',float_precision='round_trip').set_index(key).sort_index()
        rows.append({'table':name,'rows':len(a),'columns':len(a.columns)+1,
            'identical_index':a.index.equals(b.index),'identical_columns':a.columns.equals(b.columns),
            'dtype_differences':{c:[str(a[c].dtype),str(b[c].dtype)] for c in a if a[c].dtype!=b[c].dtype},**differences(a,b)})
    (R/'all-table-differences.json').write_text(json.dumps(rows,indent=2)+'\n')
    checkpoints=[]
    for table,steps in {
        'tours':['non_mandatory_tour_scheduling','tour_mode_choice_simulate'],
        'trips':['trip_purpose','trip_destination','trip_purpose_and_destination'],
    }.items():
        for step in steps:
            a=pd.read_parquet(reference/f'pipeline.parquetpipeline/{table}/{step}.parquet').sort_index()
            b=pd.concat([pd.read_parquet(candidate/f'mp_households_{i}-pipeline.parquetpipeline/{table}/{step}.parquet') for i in range(4)]).sort_index()
            checkpoints.append({'table':table,'step':step,'rows':len(a),'identical_index':a.index.equals(b.index),
                'identical_columns':a.columns.equals(b.columns),**differences(a,b)})
    # The suffix remains unsliced, but coalescence changes row order before it starts.
    a=pd.read_parquet(reference/'pipeline.parquetpipeline/trips/trip_scheduling.parquet')
    b=pd.read_parquet(candidate/'pipeline.parquetpipeline/trips/trip_scheduling.parquet')
    checkpoints.append({'table':'trips','step':'trip_scheduling','rows':len(a),'same_row_order':a.index.equals(b.index),
        'trip_953782221_row_positions':[int(a.index.get_loc(953782221)),int(b.index.get_loc(953782221))],
        **differences(a.sort_index(),b.sort_index())})
    (R/'checkpoint-differences.json').write_text(json.dumps(checkpoints,indent=2)+'\n')
    print(json.dumps([{'table':x['table'],'step':x['step'],'different_cells':x['different_cells']} for x in checkpoints]))


if __name__=='__main__':
    main()
