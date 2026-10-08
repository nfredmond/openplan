"""Invocation-scoped managed stage writes, without legacy PATCH fallback."""
from contextlib import closing, contextmanager
from contextvars import ContextVar
from pathlib import Path
import json
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
        self.files = None
        self._working_project = None
        self._working_package = None
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
        if self.files is not None:
            try:
                self.files.verify()
            except BaseException:
                self.stopped = True
                raise

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

    def workspace(self, root, run_id):
        self.require_open()
        try:
            if run_id != self.context.run_id:
                raise ValueError('Attempt workspace crosses run scope')
            from model_attempt_workspace import AttemptWorkspace
            if self.files is None:
                self.files = AttemptWorkspace(root, self.context)
            elif Path(root).resolve() != self.files.root:
                raise ValueError('Attempt workspace root changed within invocation')
            self.files.verify()
            return self.files.path
        except BaseException:
            self.stopped = True
            raise

    def retain_package(self, directory):
        """Retain this attempt's completed package before a successor can copy it."""
        import model_package_inputs
        self.require_open()
        try:
            if self.files is None or not Path(directory).resolve(strict=True).is_relative_to(self.files.path):
                raise ValueError('Package retention requires an owned attempt source')
            retained = model_package_inputs.retain(directory, self.files.path / 'package_inputs')
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_package_inputs',
                'file_url': 'local://' + retained['manifest_path'],
                'file_size_bytes': retained['manifest_size_bytes'], 'content_hash': retained['manifest_sha256'],
                'metadata_json': {'schema': 'openplan.package-inputs.v1',
                                  'scientific_acceptance': 'unassessed', 'database_consistency': 'unassessed'},
            }, logical_name='package-inputs')
            return retained
        except BaseException:
            self.stopped = True
            raise

    def retain_assignment_outputs(self, directory):
        """Retain this attempt's completed assignment outputs before a successor can copy it."""
        import model_package_inputs
        self.require_open()
        try:
            if self.files is None or not Path(directory).resolve(strict=True).is_relative_to(self.files.path):
                raise ValueError('Output retention requires an owned attempt source')
            retained = model_package_inputs.retain(directory, self.files.path / 'assignment_outputs')
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_assignment_outputs',
                'file_url': 'local://' + retained['manifest_path'],
                'file_size_bytes': retained['manifest_size_bytes'], 'content_hash': retained['manifest_sha256'],
                'metadata_json': {'schema': 'openplan.assignment-outputs.v1', 'inventory_schema': 'openplan.package-inputs.v1',
                                  'scientific_acceptance': 'unassessed', 'database_consistency': 'unassessed'},
            }, logical_name='assignment-outputs')
            return retained
        except BaseException:
            self.stopped = True
            raise

    def retain_project(self, directory):
        """Register owned project bytes and checks without authorizing execution.

        Engine closure and cross-database consistency remain separate evidence.
        """
        import model_project_inputs
        self.require_open()
        try:
            if self.files is None or not Path(directory).resolve(strict=True).is_relative_to(self.files.path):
                raise ValueError('Project retention requires an owned attempt source')
            retained = model_project_inputs.retain(directory, self.files.path / 'project_inputs')
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_project_inputs',
                'file_url': 'local://' + retained['manifest_path'],
                'file_size_bytes': retained['manifest_size_bytes'], 'content_hash': retained['manifest_sha256'],
                'metadata_json': {'schema': 'openplan.project-inputs.v1',
                                  'inventory_schema': 'openplan.package-inputs.v1',
                                  'database_checks': retained['database_checks'],
                                  'database_consistency': retained['database_consistency'],
                                  'cross_database_consistency': 'unassessed',
                                  'engine_closure': 'unassessed', 'execution_ready': False,
                                  'scientific_acceptance': 'unassessed'},
            }, logical_name='project-inputs')
            return retained
        except BaseException:
            self.stopped = True
            raise

    def prepare_project_working_copy(self, record):
        """Make an exclusive mutable copy while retaining original consumed inputs.

        The registered manifest describes initial bytes, not later engine state.
        Preparing files does not authorize execution or confirm engine closure.
        """
        import model_project_inputs
        self.require_open()
        try:
            if self.files is None:
                raise ValueError('Project preparation requires an owned attempt')
            expected = self.files.path / 'predecessor_project' / 'manifest.json'
            if record.get('manifest_path') != str(expected) or expected.resolve(strict=True) != expected:
                raise ValueError('Project preparation requires the owned consumed project')
            retained = model_project_inputs.consume(record, self.files.path / 'project_working')
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_project_working_copy',
                'file_url': 'local://' + retained['manifest_path'],
                'file_size_bytes': retained['manifest_size_bytes'], 'content_hash': retained['manifest_sha256'],
                'metadata_json': {'schema': 'openplan.project-working-copy.v1',
                                  'role': 'initial_working_inventory', 'files_mutable': True,
                                  'input_manifest_sha256': record['manifest_sha256'],
                                  'producer': record['producer'],
                                  'database_checks': retained['database_checks'],
                                  'engine_closure': 'unassessed', 'execution_ready': False,
                                  'scientific_acceptance': 'unassessed'},
            }, logical_name='project-working-copy')
            project_path = Path(retained['package_directory'])
            self._working_project = (project_path, self.files._identity(project_path.stat()))
            return {'project_directory': retained['package_directory'],
                    'initial_manifest_path': retained['manifest_path'],
                    'initial_manifest_sha256': retained['manifest_sha256'],
                    'input_manifest_sha256': record['manifest_sha256'],
                    'producer': record['producer'], 'execution_ready': False}
        except BaseException:
            self.stopped = True
            raise

    def prepare_package_working_copy(self, record):
        """Make an exclusive mutable copy while retaining original consumed inputs.

        The registered manifest describes initial bytes, not later engine state.
        Preparing files does not authorize execution or confirm engine closure.
        """
        import model_package_inputs
        self.require_open()
        try:
            if self.files is None:
                raise ValueError('Package preparation requires an owned attempt')
            expected = self.files.path / 'predecessor_package' / 'manifest.json'
            if record.get('manifest_path') != str(expected) or expected.resolve(strict=True) != expected:
                raise ValueError('Package preparation requires the owned consumed package')
            retained = model_package_inputs.consume(record, self.files.path / 'package_working')
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_package_working_copy',
                'file_url': 'local://' + retained['manifest_path'],
                'file_size_bytes': retained['manifest_size_bytes'], 'content_hash': retained['manifest_sha256'],
                'metadata_json': {'schema': 'openplan.package-working-copy.v1',
                                  'role': 'initial_working_inventory', 'files_mutable': True,
                                  'input_manifest_sha256': record['manifest_sha256'],
                                  'producer': record['producer'],
                                  'execution_ready': False,
                                  'scientific_acceptance': 'unassessed'},
            }, logical_name='package-working-copy')
            package_path = Path(retained['package_directory'])
            self._working_package = (package_path, self.files._identity(package_path.stat()))
            return {'package_directory': retained['package_directory'],
                    'initial_manifest_path': retained['manifest_path'],
                    'initial_manifest_sha256': retained['manifest_sha256'],
                    'input_manifest_sha256': record['manifest_sha256'],
                    'producer': record['producer'], 'execution_ready': False}
        except BaseException:
            self.stopped = True
            raise

    def project_directory(self, work_dir):
        """Resolve only this invocation's confirmed, independently prepared copy."""
        self.require_open()
        try:
            if self.files is None or Path(work_dir) != self.files.path or self._working_project is None:
                raise ValueError('Managed project requires a confirmed working copy in this attempt')
            path, identity = self._working_project
            if path.resolve(strict=True) != path or self.files._identity(path.stat()) != identity:
                raise ValueError('Managed working project directory changed')
            return str(path)
        except BaseException:
            self.stopped = True
            raise

    def package_directory(self, work_dir):
        """Resolve only this invocation's confirmed, independently prepared copy."""
        self.require_open()
        try:
            if self.files is None or Path(work_dir) != self.files.path or self._working_package is None:
                raise ValueError('Managed package requires a confirmed working copy in this attempt')
            path, identity = self._working_package
            if path.resolve(strict=True) != path or self.files._identity(path.stat()) != identity:
                raise ValueError('Managed working package directory changed')
            return str(path)
        except BaseException:
            self.stopped = True
            raise

    def retain_input_mapping(self, mapping):
        """Record a partial derived mapping without authorizing computation."""
        self.require_open()
        try:
            if self.files is None or not isinstance(mapping, dict) or mapping.get('execution_ready') is not False:
                raise ValueError('Input mapping requires an owned attempt and explicit incomplete status')
            retained = self.files.retain_input_mapping(mapping)
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_input_mapping', 'file_url': 'local://' + retained['path'],
                'content_hash': retained['sha256'], 'file_size_bytes': retained['size_bytes'],
                'metadata_json': {'schema': 'openplan.input-mapping.v1', 'execution_ready': False,
                                  'mapped_fields': mapping['mapped_fields'], 'inputs': mapping['inputs']},
            }, logical_name='input-mapping')
            return retained
        except BaseException:
            self.stopped = True
            raise

    def publish_state(self, directory, state):
        self.require_open()
        try:
            if self.files is None or Path(directory) != self.files.path:
                raise ValueError('State publication requires the owned attempt directory')
            self.files.publish_state(state)
            retained = self.files.retain_state(state)
            self.files.verify()
            self.record_artifact({
                'run_id': self.context.run_id, 'stage_id': self.context.stage_id,
                'artifact_type': 'model_predecessor_state',
                'file_url': 'local://' + retained['path'],
                'file_size_bytes': retained['size_bytes'], 'content_hash': retained['sha256'],
                'metadata_json': {'schema': 'openplan.predecessor-state.v1',
                                  'role': 'execution_state', 'paths_relocated': False,
                                  'package_inventory_included': False},
            }, logical_name='predecessor-state')
        except BaseException:
            self.stopped = True
            raise

    def record_artifact(self, payload: dict, *, workspace_id=None, logical_name=None):
        return self._record_output('write_model_attempt_artifact', payload,
                                   workspace_id=workspace_id, logical_name=logical_name)

    def record_kpi(self, payload: dict, *, workspace_id=None, stage_id=None):
        return self._record_output('write_model_attempt_kpi', payload,
                                   workspace_id=workspace_id, stage_id=stage_id)

    def _record_output(self, operation, payload, *, workspace_id=None, stage_id=None, logical_name=None):
        """Bind an immutable output slot to this attempt, never to its contents."""
        self.require_open()
        ctx = self.context
        try:
            payload = json.loads(journal.canonical(payload))
            if payload.get('run_id') != ctx.run_id or payload.get('stage_id', ctx.stage_id) != ctx.stage_id:
                raise ValueError('Managed output crosses invocation scope')
            if workspace_id is not None and workspace_id != ctx.workspace_id:
                raise ValueError('Managed output crosses workspace scope')
            if stage_id is not None and stage_id != ctx.stage_id:
                raise ValueError('Managed output crosses stage scope')
            payload.pop('run_id')
            payload.pop('stage_id', None)
            if operation == 'write_model_attempt_artifact':
                name = logical_name if logical_name is not None else payload.get('id')
                if name is None:
                    name = journal.canonical({'type': payload.get('artifact_type'), 'reference': payload.get('file_url')})
            else:
                payload = {'kpi_category': 'accessibility', 'unit': '', 'geometry_ref': None,
                           'breakdown_json': {}, **payload}
                name = journal.canonical({'category': payload['kpi_category'], 'name': payload.get('kpi_name')})
            if not isinstance(name, str) or not name.strip():
                raise ValueError('Managed output requires a stable name')
            identity = journal.canonical({'destination': ctx.destination, 'operation': operation, 'name': name})
            command = {'request_id': str(uuid.uuid5(uuid.UUID(ctx.attempt_id), identity)),
                       'destination': ctx.destination, 'operation': operation,
                       'arguments': {'run_id': ctx.run_id, 'stage_id': ctx.stage_id,
                                     'attempt_id': ctx.attempt_id, 'payload': payload}}
            return client.deliver(self.directory, command, base_url=self.base_url,
                deployment_id=self.deployment_id, service_key=self.service_key, post=self.post)
        except BaseException:
            self.stopped = True
            raise
