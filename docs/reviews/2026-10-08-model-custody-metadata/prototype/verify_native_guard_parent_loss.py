"""Reuse the native interruption fixture with the independent guard's kill boundary.

The old channel-loss proof remains unchanged. A killed engine need not execute
its Python cleanup handler, and this proof must not claim a clean project close.
"""
from pathlib import Path
import os

path=Path(__file__).with_name('verify_native_parent_loss.py')
source=path.read_text()
old="""                failure=json.loads((work/'assignment-failure.json').read_text())
                assert failure=={'error_type':'WorkerStateWriteUnconfirmed','active_project':False},failure"""
new="""                failure_path=work/'assignment-failure.json'
                failure=json.loads(failure_path.read_text()) if failure_path.exists() else None
                if failure is not None:
                    assert failure=={'error_type':'WorkerStateWriteUnconfirmed','active_project':False},failure
                guard=json.loads((work/'engine_process/owner-guard-started.json').read_text())
                assert guard['guard']['schema']=='openplan.owner-guard.v1'
                assert guard['guard']['owner_pid']==parent.pid"""
assert source.count(old)==1
source=source.replace(old,new)
source=source.replace("'native-parent-loss-'+control+'.json'","'native-guard-parent-loss-'+control+'.json'")
old_limit='Actual supervisor SIGKILL at the declared startup or iteration boundary. Unreleased startup must not execute engine code; iteration loss closes the native project; gateway remains in outer process. No general parent-loss detection during computation, restart, durable reconciliation, UI decision, publication or scientific acceptance.'
new_limit='Actual supervisor SIGKILL at a confirmed native iteration with an independent owner guard. Scope emptiness and absent outputs do not prove a graceful project close. SQL gateway stays outside the owner. No arbitrary busy-native interruption, restart, durable reconciliation, UI decision, publication or scientific acceptance.'
assert source.count(old_limit)==1
source=source.replace(old_limit,new_limit)
if os.environ.get('OPENPLAN_NATIVE_PARENT_CONTROL','parent-loss') not in ('parent-loss','parent-loss-harmless','omit-parent-loss'):
    raise ValueError('This follow-up supports iteration guard and no-loss controls only')
exec(compile(source,str(path),'exec'),{'__file__':str(path),'__name__':'__main__'})
