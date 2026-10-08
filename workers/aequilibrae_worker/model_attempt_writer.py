"""Invocation-scoped managed stage writes, without legacy PATCH fallback."""
from contextlib import closing, contextmanager
from contextvars import ContextVar
from pathlib import Path
import sqlite3
import threading
import uuid

import model_command_client as client
import model_command_journal as journal
from model_attempt_invocation import AttemptContext, ReconciliationRequired

_CURRENT: ContextVar['AttemptWriter | None'] = ContextVar('model_attempt_writer', default=None)


def current():
    return _CURRENT.get()


@contextmanager
def bind(writer):
    """Keep ownership local to one handler and restore it on every exit."""
    if current() is not None:
        raise ReconciliationRequired('A managed invocation is already bound')
    writer.require_open()
    token = _CURRENT.set(writer)
    try:
        yield writer
    finally:
        _CURRENT.reset(token)


class AttemptWriter:
    def __init__(self, directory: Path, context: AttemptContext, *, base_url: str,
                 deployment_id: str, service_key: str, post=None, get=None):
        self.directory = Path(directory)
        self.context = context
        self.base_url = base_url
        self.deployment_id = deployment_id
        self.service_key = service_key
        self.post = post
        self.get = get
        self.thread_id = threading.get_ident()
        self.stopped = False
        self.state = None
        if context.destination != client.destination(base_url, deployment_id) or not service_key:
            raise ValueError('Managed writer requires its original installation and credential')
        saved = journal.read_existing(self.directory, context.destination, context.claim_request_id)
        if len(saved) != 1 or not saved[0]['resolved']:
            raise ReconciliationRequired('Managed writer requires a retained claim receipt')
        claim = saved[0]['command']
        client.validate_command(claim)
        receipt = client.checked_receipt(claim, saved[0]['response'])
        if (claim['operation'] != 'claim_model_stage_attempt' or receipt['outcome'] != 'claimed'
                or claim['arguments']['run_id'] != context.run_id
                or claim['arguments']['stage_id'] != context.stage_id
                or receipt['attempt_id'] != context.attempt_id):
            raise ReconciliationRequired('Managed writer context differs from retained claim')
        uri = (self.directory / 'model-commands.sqlite3').resolve().as_uri() + '?mode=ro'
        with closing(sqlite3.connect(uri, uri=True)) as connection:
            admitted = connection.execute('SELECT workspace_id,entered FROM execution_admissions WHERE request_id=?',
                                          (context.claim_request_id,)).fetchone()
        if admitted != (context.workspace_id, 1):
            raise ReconciliationRequired('Managed writer requires consumed execution admission')

    def require_open(self):
        if self.stopped or self.thread_id != threading.get_ident():
            raise ReconciliationRequired('Managed writer is stopped or belongs to another invocation thread')
        if journal.pending(self.directory, self.context.destination):
            self.stopped = True
            raise ReconciliationRequired('Pending model command requires reconciliation before later writes')

    def _read_state(self):
        """Read the claimed stage's actual log before expanding partial patches."""
        get = self.get
        if get is None:
            import requests
            get = requests.get
        ctx = self.context
        try:
            response = get(self.base_url.rstrip('/') + '/rest/v1/model_run_stages',
                headers={'apikey': self.service_key, 'Authorization': 'Bearer ' + self.service_key},
                params={'id': 'eq.' + ctx.stage_id, 'run_id': 'eq.' + ctx.run_id,
                        'model_runs.workspace_id': 'eq.' + ctx.workspace_id,
                        'select': 'id,run_id,status,attempt_managed,active_attempt_id,log_tail,error_message,model_runs!inner(id,workspace_id,status,attempt_managed)'},
                timeout=(5, 30), allow_redirects=False)
        except Exception:
            raise client.OwnershipUnconfirmed('Managed stage read did not confirm current state') from None
        try:
            rows = response.json() if response.status_code == 200 else None
            if not isinstance(rows, list) or len(rows) != 1:
                raise ValueError('Missing unique stage')
            stage = rows[0]
            run = stage['model_runs']
            if (stage['id'] != ctx.stage_id or stage['run_id'] != ctx.run_id
                    or stage['active_attempt_id'] != ctx.attempt_id or stage['attempt_managed'] is not True
                    or stage['status'] != 'running' or run['id'] != ctx.run_id
                    or run['workspace_id'] != ctx.workspace_id or run['status'] != 'running'
                    or run['attempt_managed'] is not True or stage['error_message'] is not None):
                raise ValueError('Claimed state differs')
            log = stage['log_tail']
            if log is not None and (not isinstance(log, str) or len(log) > 20000):
                raise ValueError('Invalid existing stage log')
            return {'status': 'running', 'log_tail': log, 'error': None}
        except (ValueError, KeyError, TypeError, AttributeError):
            raise client.OwnershipUnconfirmed('Managed stage read is incomplete or no longer owned') from None
        finally:
            response.close()

    def patch_stage(self, stage_id: str, payload: dict) -> dict:
        self.require_open()
        if stage_id != self.context.stage_id:
            raise ValueError('Managed stage write crosses invocation scope')
        if not isinstance(payload, dict) or not payload or set(payload) - {'status', 'log_tail', 'error_message', 'completed_at'}:
            raise ValueError('Unsupported managed stage patch')
        try:
            if self.state is None:
                self.state = self._read_state()
            state = {**self.state}
            for source, target in [('status', 'status'), ('log_tail', 'log_tail'), ('error_message', 'error')]:
                if source in payload:
                    state[target] = payload[source]
            # Legacy callers supply their wall clock. Validate it, but the
            # database records the authoritative completion time in its receipt.
            if 'completed_at' in payload:
                client._timestamp(payload['completed_at'])
                if state['status'] == 'running':
                    raise ValueError('Running stage cannot carry completion')
            ctx = self.context
            command = {'request_id': str(uuid.uuid4()), 'destination': ctx.destination,
                       'operation': 'write_model_stage_attempt',
                       'arguments': {'run_id': ctx.run_id, 'stage_id': ctx.stage_id,
                                     'attempt_id': ctx.attempt_id, **state}}
            receipt = client.deliver(self.directory, command, base_url=self.base_url,
                deployment_id=self.deployment_id, service_key=self.service_key, post=self.post)
        except BaseException:
            self.stopped = True
            raise
        self.state = state
        self.stopped = state['status'] != 'running'
        return receipt

    def patch_run(self, run_id: str, payload: dict):
        raise ReconciliationRequired('Managed parent transitions belong to the stage command transaction')
