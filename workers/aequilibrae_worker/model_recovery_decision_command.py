"""Validate an explicitly reviewed abandonment request, never create authority.

The service caller must derive actor identity and authorization separately.
This command does not inspect processes, signal them, or resume computation.
"""
from datetime import datetime
from uuid import UUID
import model_command_journal as journal

FIELDS={'workspace_id','run_id','actor_id','expected_state','reason','evidence'}


def identity(value):
    if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError('Recovery requires canonical identities')


def timestamp(value):
    if not isinstance(value,str):raise ValueError('Recovery requires observation timestamps')
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() is None:raise ValueError('Recovery timestamps require a timezone')


def validate(command):
    args=command['arguments']
    if set(args)!=FIELDS:raise ValueError('Invalid recovery command fields')
    for value in (command['request_id'],args['workspace_id'],args['run_id'],args['actor_id']):identity(value)
    if not isinstance(args['reason'],str) or not args['reason'].strip() or len(args['reason'])>2000:raise ValueError('Recovery reason required')
    if not isinstance(args['evidence'],dict) or len(journal.canonical(args['evidence']).encode('utf-8'))>65536:raise ValueError('Recovery evidence must be a bounded object')
    state=args['expected_state']
    if not isinstance(state,dict) or set(state)!={'run_id','workspace_id','model_id','status','updated_at','attempt_managed','stages'}:raise ValueError('Exact reviewed state required')
    if state['run_id']!=args['run_id'] or state['workspace_id']!=args['workspace_id'] or state['status'] not in ('queued','running') or type(state['attempt_managed']) is not bool:raise ValueError('Reviewed run scope or state differs')
    identity(state['model_id']);timestamp(state['updated_at'])
    if not isinstance(state['stages'],list) or not state['stages']:raise ValueError('Reviewed stage set required')
    seen=set()
    for stage in state['stages']:
        if not isinstance(stage,dict) or set(stage)!={'id','status','updated_at','active_attempt_id','attempt_managed'}:raise ValueError('Exact reviewed stage required')
        identity(stage['id']);timestamp(stage['updated_at'])
        if stage['id'] in seen:raise ValueError('Duplicate reviewed stage')
        seen.add(stage['id'])
        if stage['active_attempt_id'] is not None:identity(stage['active_attempt_id'])
        if type(stage['attempt_managed']) is not bool or stage['status'] not in ('queued','running','succeeded','failed','cancelled','skipped'):raise ValueError('Invalid reviewed stage state')


def request_payload(command):
    args=command['arguments']
    return {key:args[key] for key in ('workspace_id','run_id','actor_id','expected_state','reason')} | {'reported_evidence':args['evidence']}


def check_receipt(command,receipt):
    args=command['arguments']
    expected={'request_id':command['request_id'],**{key:args[key] for key in ('workspace_id','run_id','actor_id')},
              'outcome':'execution_abandoned','run_status':'cancelled','process_termination_verified':False,
              'continuation_authorized':False,'model_resumed':False,'reported_evidence_verified':False,
              'request_payload':request_payload(command)}
    if not isinstance(receipt,dict) or journal.canonical(receipt)!=journal.canonical(expected):raise ValueError('Recovery receipt differs from reviewed request')
    return receipt
