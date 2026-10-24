"""Audit retained model outputs after the stop without executing the engine."""
import csv,json,sys
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
from activitysim_choice_parity import compare_choices,ParityFailure,digest
E=Path(__file__).resolve().parent
root=Path('/home/nathaniel/.t3/worktrees/openplan/t3-8dddce31/data/_screening_cache/tbi2019-convergence')
try:
 compare_choices(root/'parity-current-disabled',root/'parity-current-training')
 raise RuntimeError('Expected retained choice failure missing')
except ParityFailure as exc:
 result={'status':'failed_choice_parity','models_replayed':False,'comparator_sha256':digest('scripts/modeling/activitysim_choice_parity.py'),'differences':exc.records,'tables':exc.tables}
 (E/'complete-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
 for table in result['tables']:print(table['table'],table['rows'],len(table['tolerated_auxiliary_differences']))
