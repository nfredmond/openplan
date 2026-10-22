"""Opt-in original HTTP admissions with held uncertain pipeline starts.

Local terminal records do not establish callback delivery or source/engine
custody. This candidate does not connect retained source or engine-stage journals.
"""
from contextlib import contextmanager
import hashlib
import json
import re
import threading
import time
import uuid

from admission_journal import Journal, encoded, private
import contract
from retained_source import absolute, json_bytes, publish, read_json, writer

FORMAT = 'openplan.odm-runtime-installation.v1'
OUTCOME = 'openplan.odm-local-pipeline-outcome.v1'
TERMINAL = ('succeeded', 'failed', 'canceled')


class Runtime:
    def __init__(self, root, installation_id, *, max_queued, pipeline, timeout=2):
        if not isinstance(installation_id, str) or not installation_id.strip() or len(installation_id) > 256:
            raise ValueError('Explicit ODM installation identity is required')
        if type(max_queued) is not int or max_queued < 0:
            raise ValueError('ODM runtime pending capacity is invalid')
        if not callable(pipeline):
            raise ValueError('ODM runtime pipeline is required')
        self.root = absolute(root);private(self.root, True)
        initial = Journal(self.root/'admissions', timeout=timeout)
        self.timeout = timeout;self.max_queued = max_queued;self.pipeline = pipeline
        self.installation = {'format': FORMAT, 'installationId': installation_id,
                             'authorityVerification': 'unassessed'}
        with writer(self.root, time.monotonic()+timeout):
            seal = self.root/'runtime-installation.json'
            if seal.exists() or seal.is_symlink():
                publish(self.root, seal.name, json_bytes(self.installation))
            else:
                if any(path.name not in ('writer.lock', 'admissions') and not path.name.startswith('.partial-') for path in self.root.iterdir()):
                    raise ValueError('ODM runtime records require their original installation seal')
                accepted, started = initial.accepted(), initial.started()
                if accepted or started:
                    raise ValueError('ODM admissions require their original installation seal')
                publish(self.root, seal.name, json_bytes(self.installation))
        self.journal = Journal(self.root/'admissions', timeout=timeout, require_existing=True)
        self.journal.accepted()
        self.context = {'installationId': installation_id, 'originalRuntimeId': str(uuid.uuid4()),
                        'sourceAuthorityVerification': 'unassessed', 'engineCustodyVerification': 'unassessed'}
        self._owned = False;self._execution = threading.Lock()

    def _check(self):
        if encoded(read_json(self.root, 'runtime-installation.json'), canonical=True) != encoded(self.installation, canonical=True):
            raise ValueError('Saved ODM installation identity differs')

    @contextmanager
    def owner(self):
        """Hold one cooperative runtime owner for the entire worker lifetime."""
        with writer(self.root, time.monotonic()+self.timeout):
            self._check();self._owned = True
            try: yield self
            finally: self._owned = False

    def submit(self, request):
        self._check()
        def factory(value):
            reference = 'odm-'+uuid.uuid4().hex[:20]
            return reference, contract.build_callback(value['schemaVersion'], value['requestId'], reference, 'accepted')
        return self.journal.admit(request, factory, max_queued=self.max_queued)

    @staticmethod
    def _name(entry):
        return 'pipeline-outcome-'+hashlib.sha256(entry.request['requestId'].encode()).hexdigest()+'.json'

    @staticmethod
    def _binding(entry):
        return {'requestId': entry.request['requestId'], 'jobReference': entry.job_reference,
                'requestSha256': hashlib.sha256(encoded(entry.request, canonical=True).encode()).hexdigest(),
                'originalStartContext': entry.started_context}

    @staticmethod
    def _terminal(state, observed):
        if observed is None: return None
        if not isinstance(observed, dict) or set(observed) != {'taskUuid', 'statusCode'} or not isinstance(observed['taskUuid'], str) or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', observed['taskUuid']) or type(observed['statusCode']) is not int or observed['statusCode'] not in (30, 40, 50) or state == 'succeeded' and observed['statusCode'] != 40 or state == 'canceled' and observed['statusCode'] != 50:
            raise ValueError('ODM reported terminal observation differs')
        return json.loads(encoded(observed, canonical=True))

    def _outcome(self, entry):
        path = self.root/self._name(entry)
        if not path.exists() and not path.is_symlink(): return None
        value = read_json(self.root, path.name)
        expected = {'format': OUTCOME, 'binding': self._binding(entry), 'state': value.get('state') if isinstance(value, dict) else None,
                    'reportedEngineTerminal': value.get('reportedEngineTerminal') if isinstance(value, dict) else None,
                    'callbackDeliveryVerification': 'unassessed', 'sourceCustodyVerification': 'unassessed',
                    'engineCustodyVerification': 'unassessed'}
        if not isinstance(value, dict) or value.get('state') not in TERMINAL or encoded(value, canonical=True) != encoded(expected, canonical=True):
            raise ValueError('Original ODM local terminal record differs')
        self._terminal(value['state'], value['reportedEngineTerminal'])
        return value

    def status(self):
        self._check()
        with self.journal.connection() as connection:
            rows = connection.execute('SELECT request_id FROM admissions ORDER BY rowid').fetchall()
            entries = [self.journal.read(connection, row[0]) for row in rows]
        outcomes = [self._outcome(row) for row in entries if row.phase == 'started']
        return {'accepted': sum(row.phase == 'accepted' for row in entries), 'heldStarted': sum(row is None or row['reportedEngineTerminal'] is None for row in outcomes),
                'localTerminal': sum(row is not None for row in outcomes),
                'sourceCustodyVerification': 'unassessed', 'engineCustodyVerification': 'unassessed',
                'callbackDeliveryVerification': 'unassessed'}

    def run_one(self):
        """Start one accepted entry once; uncertain prior starts hold the queue."""
        if not self._owned:
            raise ValueError('ODM runtime execution requires its lifetime owner')
        if not self._execution.acquire(blocking=False): return False
        try:
            self._check()
            outcomes = [self._outcome(row) for row in self.journal.started()]
            if any(row is None or row['reportedEngineTerminal'] is None for row in outcomes): return False
            with self.journal.connection() as connection:
                row = connection.execute("SELECT request_id FROM admissions WHERE phase='accepted' ORDER BY rowid LIMIT 1").fetchone()
                pending = self.journal.read(connection, row[0]) if row is not None else None
            if pending is None: return False
            entry, first = self.journal.start(pending.request['requestId'], pending.job_reference, self.context)
            if first is not True: return False
            original_binding = self._binding(entry)
            job = {'request': json.loads(encoded(entry.request)), 'job_reference': entry.job_reference,
                   'accepted_callback': json.loads(encoded(entry.admission)), 'state': 'accepted'}
            self.pipeline(job)
            if job['job_reference'] != entry.job_reference or encoded(job['request'], canonical=True) != encoded(entry.request, canonical=True):
                raise ValueError('Pipeline changed original ODM identity')
            if job['state'] in TERMINAL:
                result = {'format': OUTCOME, 'binding': original_binding, 'state': job['state'],
                          'reportedEngineTerminal': self._terminal(job['state'], job.get('reportedEngineTerminal')),
                          'callbackDeliveryVerification': 'unassessed', 'sourceCustodyVerification': 'unassessed',
                          'engineCustodyVerification': 'unassessed'}
                publish(self.root, self._name(entry), json_bytes(result))
            return True
        finally: self._execution.release()
