"""Compare retained completed outputs with the actual named export identities."""
import json,sys
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import compare_tables,chunk_evidence,digest
E=Path(__file__).resolve().parent;R=Path('data/_screening_cache/tbi2019-convergence')
record={'status':'pending','arm':'current','mode':'training','full_runs_authorized_by_parity':False,
        'models_replayed':False,'comparator_sha256':digest(Path('scripts/modeling/activitysim_chunk_parity.py')),
        'prior_instrument_failure_sha256':digest(E/'parity-result.identity-assumption.json'),
        'actual_chunking':chunk_evidence((E/'parity-current-training.stdout.log').read_text()),
        'final_files':{mode:{p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in (R/('parity-current-'+mode)).glob('final_*.csv')} for mode in ['disabled','training']}}
(E/'comparison-closure.json').write_text(json.dumps(record,indent=2)+'\n')
try:
 record['tables']=compare_tables(R/'parity-current-disabled',R/'parity-current-training')
 record['status']='passed_current_training_value_parity'
except AssertionError as exc:
 record.update(status='failed_exact_parity',error=str(exc))
(E/'parity-result.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k!='final_files'},indent=2))
sys.exit(2 if record['status']=='failed_exact_parity' else 0)
