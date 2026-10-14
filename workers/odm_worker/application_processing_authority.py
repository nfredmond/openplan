"""Check access for one exact saved processing commit, separately from drafts.

This observation is not an atomic remote revocation fence, durable approval or
permission to deliver callbacks or publish artifacts.
"""
import copy
import hashlib

from admission_journal import private
from application_dispatch_reader import Reader
from draft_custody import original_plan
from engine_effects import commands, engine_identity, same
from retained_source import json_bytes, read_json


class Authority:
    def __init__(self, reader, engine, attest):
        if not isinstance(reader, Reader) or not callable(attest):
            raise ValueError('Private reader and explicit processing engine attestation are required')
        self.reader = reader
        self.engine = engine_identity(engine)
        self.attest = attest

    def __call__(self, plan, operation, command, *, deadline):
        """Check the saved original, current actor and engine before permission."""
        if deadline is None:
            raise ValueError('Processing authority requires its actual shared deadline')
        deadline = self.reader._deadline(deadline)
        plan = original_plan(plan)
        if operation != 'commit' or not same(command, commands(plan)['commit']):
            raise ValueError('Only the exact original processing commit can be authorized')
        if not same(plan['engine'], self.engine):
            raise ValueError('Processing engine differs from the configured original')
        binding = plan['binding']
        if not isinstance(binding, dict) or set(binding) != {'requestId', 'jobReference', 'originalRequest', 'originalAdmission', 'originalContext'} or not isinstance(binding['requestId'], str) or not binding['requestId'].strip():
            raise ValueError('Processing original application binding is required')
        request_id = binding['requestId']
        dispatch = self.reader.dispatch
        saved = dispatch.load(request_id, deadline=deadline)
        entry = dispatch._check(request_id, deadline)
        expected = {'requestId': request_id, 'jobReference': entry.job_reference,
            'originalRequest': entry.request, 'originalAdmission': entry.admission,
            'originalContext': saved['context']}
        if not same(binding, expected):
            raise ValueError('Processing scope differs from the saved application original')
        root = dispatch.runtime.root / ('preparation-' + hashlib.sha256(request_id.encode()).hexdigest())
        private(root, True)
        if not same(original_plan(read_json(root / 'engine', 'plan.json')), plan):
            raise ValueError('Processing plan differs from the saved original engine plan')
        prepared = read_json(root, 'prepared.json')
        preparation = read_json(root, 'plan.json')
        if (not isinstance(prepared, dict) or not isinstance(preparation, dict)
                or prepared.get('enginePlanSha256') != hashlib.sha256(json_bytes(plan)).hexdigest()
                or prepared.get('planSha256') != hashlib.sha256(json_bytes(preparation)).hexdigest()
                or prepared.get('taskUuid') != plan['taskUuid']
                or preparation.get('taskUuid') != plan['taskUuid']
                or prepared.get('sourceManifestSha256') != plan['sourceManifestSha256']):
            raise ValueError('Processing plan differs from its prepared runtime record')
        dispatch._check(request_id, deadline)
        if self.reader.observe(request_id, deadline=deadline)['authorizedNow'] is not True:
            return False
        attested = self.attest(copy.deepcopy(self.engine), deadline,
            owned=lambda: dispatch.runtime._owned)
        dispatch._check(request_id, deadline)
        if type(attested) is not bool:
            raise ValueError('Processing engine attestation must return a boolean')
        if attested is not True:
            return False
        current = self.reader.observe(request_id, deadline=deadline)
        dispatch._check(request_id, deadline)
        return current['authorizedNow'] is True
