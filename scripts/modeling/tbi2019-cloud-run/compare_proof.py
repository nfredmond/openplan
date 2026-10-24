"""Check both container arms against their retained unchunked references."""
import json
from pathlib import Path
import sys
import pandas as pd

P=Path(__file__).resolve().parent
sys.path.insert(0,str(P.parent))
from activitysim_choice_parity import compare_choices, IDENTITIES
from activitysim_chunk_parity import digest

root=Path(sys.argv[1])
refs=json.loads((P/'retained-parity.json').read_text())['references']
valid=list((root/'retrieved/results').glob('parity-*/terminal.json'))
assert len(valid)==1
folder=valid[0].parent;state=json.loads(valid[0].read_text());assert state['status']=='completed'
results={}
for arm in ['current','semcog']:
    ref=Path(refs[arm]['path']);candidate=folder/arm
    assert {p.name:digest(p) for p in ref.glob('final_*.csv')}==refs[arm]['hashes']
    tables=compare_choices(ref,candidate)
    for name in IDENTITIES:
        frames=[pd.read_csv(d/f'final_{name}.csv',float_precision='round_trip') for d in [ref,candidate]]
        assert frames[0].dtypes.equals(frames[1].dtypes),name+' dtype differs'
    results[arm]={'status':'passed_choice_parity','dtypes_identical':True,'tables':tables}
for label,expected in [('wrong-hash','archive hash or byte length mismatch'),('bad-member','member hash mismatch')]:
    paths=list((root/'retrieved/results').glob(label+'-*/terminal.json'));assert len(paths)==1
    fail=json.loads(paths[0].read_text());assert fail['status']=='failed' and fail['step']=='archive_verification'
    assert expected in fail['error'];assert not list(paths[0].parent.glob('*/engine.log'))
results['controls']={'wrong_archive_hash':'refused_before_model','corrupt_member':'refused_before_model'}
(root/'parity-comparison.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({a:{'status':r['status'],'rows':{t['table']:t['rows'] for t in r['tables']},
                     'tolerated_cells':sum(len(t['tolerated_auxiliary_differences']) for t in r['tables'])}
                  for a,r in results.items() if a!='controls'},indent=2))
