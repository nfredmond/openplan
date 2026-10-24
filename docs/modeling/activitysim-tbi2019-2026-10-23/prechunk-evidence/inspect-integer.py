"""Describe the rejected integer setting using modeled exports and checkpoint dtypes."""
import numpy as np
import pandas as pd
from prepare import E, m, OLD_R
from activitysim_choice_parity import IDENTITIES

reference = OLD_R/'r2-2000-current-reference'
candidate = m.R/'integer-2000-current'
results = []
for table, key in IDENTITIES.items():
    name = 'final_'+table+'.csv'
    a, b = [pd.read_csv(root/name, float_precision='round_trip').set_index(key).sort_index() for root in [reference,candidate]]
    item = {'table':name,'reference_rows':len(a),'candidate_rows':len(b),
            'reference_sha256':m.digest(reference/name),'candidate_sha256':m.digest(candidate/name),
            'same_ids':a.index.equals(b.index),'same_columns':list(a.columns)==list(b.columns)}
    common = a.index.intersection(b.index)
    fields = {}
    for col in a.columns.intersection(b.columns):
        left, right = a.loc[common,col], b.loc[common,col]
        differences = ~(left.eq(right) | (left.isna() & right.isna()))
        if differences.any():
            first = differences.index[differences][0]
            fields[col] = {'differing_cells':int(differences.sum()), 'first_id':str(first),
                           'first_reference':str(left.loc[first]), 'first_candidate':str(right.loc[first])}
    item['different_columns'] = fields
    results.append(item)
checkpoints = {}
for table, stage in [('land_use','initialize_landuse'),('accessibility','compute_accessibility')]:
    checkpoints[table] = {}
    for label, root in [('reference',reference),('candidate',candidate)]:
        path = root/'pipeline.parquetpipeline'/table/(stage+'.parquet')
        df = pd.read_parquet(path)
        checkpoints[table][label] = {'sha256':m.digest(path),'dtypes':{str(c):str(t) for c,t in df.dtypes.items()}}
decay = np.array([0.12345679], dtype=np.float32)
promotion = {dtype:{'dtype':str((np.array([12345],dtype=dtype)*decay).dtype),
                    'value':float((np.array([12345],dtype=dtype)*decay)[0])} for dtype in ['int64','int16']}
m.save('integer-failure-analysis.json', {'status':'rejected_exact_parity','tables':results,
    'checkpoint_dtypes':checkpoints,'synthetic_promotion_example':promotion,
    'semcog_probe':'not_run_after_current_exact_failure','full_integer_arms':'not_admitted',
    'outcomes_accessed':False,
    'interpretation':'Narrowing integers can change mixed arithmetic promotion with float32 skims even when downcast_float is false. The checkpoint float dtypes and exported differences are observed; the small multiplication is a mechanism example, not an engine rerun.'})
