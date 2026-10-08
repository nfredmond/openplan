"""Inspect pending model commands or recover one exact saved receipt.

This command does not resume models, create a new request, or infer completion.
The normal stage dispatchers have not adopted the retained-command client yet.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import model_command_client as client
import model_command_journal as journal


def _checked_records(directory, base_url, deployment_id, request_id=None):
    bound = client.destination(base_url, deployment_id)
    records = journal.read_existing(directory, bound, request_id)
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
             'stage_id': saved['command']['arguments']['stage_id']}
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--journal', required=True, type=Path)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--deployment-id', required=True)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--list-pending', action='store_true')
    action.add_argument('--request-id')
    args = parser.parse_args(argv)
    try:
        if args.list_pending:
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
