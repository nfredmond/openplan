"""Check current application access and a separate engine attestation per draft.

This adapter permits only an original init or upload. It cannot grant processing
commit, reconcile an uncertain effect or create an atomic remote revocation fence.
"""
import copy

from application_dispatch_reader import Reader
from draft_custody import original_plan
from engine_effects import commands, engine_identity, same


class Authority:
    def __init__(self, reader, engine, attest):
        if not isinstance(reader, Reader) or not callable(attest):
            raise ValueError('Private reader and explicit engine attestation are required')
        self.reader = reader;self.engine = engine_identity(engine);self.attest = attest

    def __call__(self, plan, operation, command, *, deadline):
        """Verify saved scope before querying current access and engine identity."""
        if deadline is None:
            raise ValueError('Private draft authority requires its actual shared deadline')
        deadline = self.reader._deadline(deadline)
        plan = original_plan(plan)
        expected = commands(plan)
        if not isinstance(operation, str) or operation == 'commit' or operation not in expected or not same(command, expected[operation]):
            raise ValueError('Only the exact original draft command can be authorized')
        if not same(plan['engine'], self.engine):
            raise ValueError('Private draft engine differs from the configured original')
        binding = plan['binding']
        if not isinstance(binding, dict) or set(binding) != {'requestId', 'jobReference', 'originalRequest', 'originalAdmission', 'originalContext'} or not isinstance(binding['requestId'], str) or not binding['requestId'].strip():
            raise ValueError('Private draft original binding is required')
        request_id = binding['requestId']
        dispatch = self.reader.dispatch
        saved = dispatch.load(request_id, deadline=deadline)
        entry = dispatch._check(request_id, deadline)
        original = {'requestId': request_id, 'jobReference': entry.job_reference,
            'originalRequest': entry.request, 'originalAdmission': entry.admission,
            'originalContext': saved['context']}
        if not same(binding, original):
            raise ValueError('Private draft scope differs from the saved application original')
        current = self.reader.observe(request_id, deadline=deadline)
        if current['authorizedNow'] is not True:
            return False
        attested = self.attest(copy.deepcopy(self.engine), deadline,
            owned=lambda: dispatch.runtime._owned)
        dispatch._check(request_id, deadline)
        if type(attested) is not bool:
            raise ValueError('Private draft engine attestation must return a boolean')
        return attested is True
