"""Inspect pending model commands or recover one exact saved receipt.

This command does not resume models, create a new request, or infer completion.
Selected normal worker writes and calculations retain journals. Listing or
recovering these records does not establish current ownership or resume a stage.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import model_command_client as client
import model_command_journal as journal


def _checked_records(directory, base_url, deployment_id, request_id=None, *, include_resolved=False):
    bound = client.destination(base_url, deployment_id)
    records = journal.read_existing(directory, bound, request_id, include_resolved=include_resolved)
    for saved in records:
        command = saved['command']
        client.validate_command(command)
        if command['destination'] != bound or (request_id is not None and command['request_id'] != request_id):
            raise ValueError('Saved command does not match the selected request and deployment')
    return records


def pending_summaries(directory, *, base_url, deployment_id):
    """Expose command identities without credentials, paths or scientific payloads."""
    return [{'request_id': saved['command']['request_id'], 'operation': saved['command']['operation'],
             'run_id': saved['command']['arguments']['run_id'],
             'stage_id': saved['command']['arguments'].get('stage_id'),
             **({'track': saved['command']['arguments']['track']} if saved['command']['operation'] in ('publish_legacy_model_evidence', 'record_legacy_model_assessment') else {})}
            for saved in _checked_records(directory, base_url, deployment_id)]


def recover_request(directory, request_id, *, base_url, deployment_id, service_key, post=None):
    """Retry the original saved command; unresolved delivery stays in the journal."""
    client._uuid(request_id)
    records = _checked_records(directory, base_url, deployment_id, request_id)
    if len(records) != 1:
        raise ValueError('No exact saved request exists for this deployment')
    command = records[0]['command']
    return client.deliver(directory, command, base_url=base_url, deployment_id=deployment_id,
                          service_key=service_key, post=post)


def command_summaries(directory, *, base_url, deployment_id):
    """Inventory local requests and checked receipts without transport or payloads."""
    summaries = []
    for saved in _checked_records(directory, base_url, deployment_id, include_resolved=True):
        command = saved['command']
        response = saved['response']
        if saved['resolved']:
            client.checked_receipt(command, response)
        summaries.append({
            'request_id': command['request_id'], 'operation': command['operation'],
            'run_id': command['arguments']['run_id'], 'stage_id': command['arguments'].get('stage_id'),
            'delivery': 'receipt_retained' if saved['resolved'] else 'unconfirmed',
            'request_sha256': hashlib.sha256(journal.canonical(command).encode('utf-8')).hexdigest(),
            'receipt_sha256': hashlib.sha256(journal.canonical(response).encode('utf-8')).hexdigest() if saved['resolved'] else None,
        })
    return summaries


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--journal', required=True, type=Path)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--deployment-id', required=True)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--list-pending', action='store_true')
    action.add_argument('--list-commands', action='store_true')
    action.add_argument('--list-computations', action='store_true')
    action.add_argument('--request-id')
    args = parser.parse_args(argv)
    try:
        if args.list_commands:
            print(json.dumps({'commands': command_summaries(
                args.journal, base_url=args.base_url, deployment_id=args.deployment_id),
                'server_state_checked': False, 'ownership_checked': False, 'model_resumed': False}))
        elif args.list_computations:
            import model_stage_computation
            print(json.dumps({'computations': model_stage_computation.summaries(
                args.journal, base_url=args.base_url, deployment_id=args.deployment_id)}))
        elif args.list_pending:
            print(json.dumps({'pending': pending_summaries(args.journal, base_url=args.base_url, deployment_id=args.deployment_id)}))
        else:
            recover_request(args.journal, args.request_id, base_url=args.base_url,
                            deployment_id=args.deployment_id, service_key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY', ''))
            print(json.dumps({'request_id': args.request_id, 'outcome': 'command_receipt_retained', 'model_resumed': False}))
    except client.DeliveryUnconfirmed:
        print(json.dumps({'outcome': 'delivery_unconfirmed', 'model_resumed': False}))
        return 2
    except (ValueError, TypeError, KeyError, sqlite3.Error, OSError):
        print(json.dumps({'outcome': 'request_refused', 'model_resumed': False}))
        return 3
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
