"""Fresh-process replay of a journal captured after interrupted native assignment."""
import hashlib,json,sys
from pathlib import Path
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
import model_command_journal as journal
import model_command_client as client
import model_command_recovery as recovery

config=json.loads(Path(sys.argv[1]).read_text())
directory=Path(config['journal'])
bound=client.destination(config['base_url'],config['deployment_id'])
before=journal.read_existing(directory,bound,include_resolved=True)
selected=next(row for row in before if row['command']['request_id']==config['request_id'])
command=selected['command'];args=command['arguments']
assert command['operation']=='write_model_stage_attempt' and args['status']=='running'
assert 'Assignment iteration' in args['log_tail']
expected={'p_request_id':command['request_id'],'p_attempt_id':args['attempt_id'],'p_status':args['status'],'p_log_tail':args['log_tail'],'p_error':args['error']}
receipt={'request_id':command['request_id'],'stage_id':args['stage_id'],'attempt_id':args['attempt_id'],'status':'running','completed_at':None,'run_status':'running','run_completed_at':None}
calls=[]
def post(url,**kwargs):
    assert url==config['base_url'].rstrip('/')+'/rest/v1/rpc/write_model_stage_attempt'
    assert kwargs['json']==expected,'Replay changed original RPC arguments'
    calls.append(kwargs['json'])
    return Mock(status_code=200,json=Mock(return_value=receipt))

options={'base_url':config['base_url'],'deployment_id':config['deployment_id'],'service_key':'synthetic-not-a-key'}
wrong_target=Mock()
try:
    recovery.recover_request(directory,command['request_id'],**{**options,'deployment_id':'foreign'},post=wrong_target)
except ValueError:pass
else:raise AssertionError('Foreign deployment replay was accepted')
wrong_target.assert_not_called()
wrong_receipt_detected=False
if not selected['resolved']:
    wrong={**receipt,'attempt_id':'ffffffff-ffff-4fff-8fff-ffffffffffff'}
    try:
        recovery.recover_request(directory,command['request_id'],**options,post=Mock(return_value=Mock(status_code=200,json=Mock(return_value=wrong))))
    except client.DeliveryUnconfirmed:wrong_receipt_detected=True
    else:raise AssertionError('Foreign attempt receipt resolved native progress')
    assert len(journal.pending(directory,bound))==1
first=recovery.recover_request(directory,command['request_id'],**options,post=post)
second=recovery.recover_request(directory,command['request_id'],**options,post=post)
assert first==second==receipt
assert len(calls)==(0 if selected['resolved'] else 1),'Replay retransmitted a retained receipt'
after=journal.read_existing(directory,bound,include_resolved=True)
assert [row['command'] for row in before]==[row['command'] for row in after],'Replay altered command inventory'
assert not journal.pending(directory,bound)
assert 'main' not in sys.modules and 'aequilibrae' not in sys.modules
report={'request_sha256':hashlib.sha256(journal.canonical(command).encode()).hexdigest(),
        'initially_resolved':selected['resolved'],'successful_posts':len(calls),'wrong_receipt_detected':wrong_receipt_detected,
        'wrong_deployment_refused':True,'command_inventory_unchanged':True,'pending_after':0,'model_resumed':False,
        'limits':'Fresh recovery process and native-failure journal snapshot; mocked RPC receipts. No live database replay, model restart, ownership lease or execution authorization.'}
Path(config['report']).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
