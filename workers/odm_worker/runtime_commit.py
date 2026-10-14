"""Issue one original processing commit after acknowledged original drafts.

The explicit adapters supply current authority and actual transport. Uncertain
effects stay held. A retained commit reply is not processing completion, quality,
callback delivery or permission to publish an artifact.
"""
import copy
import time

from admission_journal import private, synchronize
from engine_effects import same
from retained_source import check_time, json_bytes, publish, writer
from retained_task_observation import finite_number
from runtime_draft import Draft

FORMAT = 'openplan.odm-runtime-commit.v1'


class Commit:
    def __init__(self, draft, authorize, transport, *, timeout=10):
        if not isinstance(draft, Draft) or not callable(authorize) or not callable(transport):
            raise ValueError('Original draft and explicit processing adapters are required')
        if not finite_number(timeout) or timeout <= 0:
            raise ValueError('Original commit timeout must be positive and finite')
        self.draft = draft
        self.authorize = authorize
        self.transport = transport
        self.timeout = timeout

    @staticmethod
    def _result(effects, state):
        return {'format': FORMAT, 'state': state, 'taskUuid': effects.plan['taskUuid'],
            'enginePlanSha256': effects.plan_hash, 'authorityVerification': 'unassessed',
            'processingQualityVerification': 'unassessed',
            'callbackDeliveryVerification': 'unassessed',
            'callbackPermission': False, 'publicationPermission': False}

    def advance(self, request_id):
        """Keep one durable intent before a single owned original POST."""
        deadline = time.monotonic() + self.timeout
        effects, root = self.draft._effects(request_id, deadline)
        dispatch = root / 'processing-dispatch'
        try:
            dispatch.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(dispatch, True)
        runtime = self.draft.preparation.runtime
        with writer(dispatch, deadline):
            self.draft.preparation._entry(request_id)
            publish(dispatch, 'original-plan.json', json_bytes({'format': FORMAT,
                'enginePlanSha256': effects.plan_hash,
                'originalContext': effects.plan['binding']['originalContext']}))
            snapshot = effects.snapshot()
            pending = False
            for row in snapshot['commands']:
                if row['state'] != 'acknowledged':
                    pending = True
                elif pending:
                    raise ValueError('Original processing command order differs')
            if any(row['state'] == 'unresolved' for row in snapshot['commands']):
                return self._result(effects, 'held_uncertain')
            if any(row['state'] != 'acknowledged' for row in snapshot['commands'][:-1]):
                return self._result(effects, 'held_incomplete_draft')
            if snapshot['commands'][-1]['state'] == 'acknowledged':
                return self._result(effects, 'commit_reply_retained')
            command = effects.command_map['commit']
            allowed = self.authorize(copy.deepcopy(effects.plan), 'commit',
                copy.deepcopy(command), deadline=deadline)
            self.draft.preparation._entry(request_id)
            check_time(deadline)
            if allowed is not True:
                raise PermissionError('Explicit original processing permission was not confirmed')
            _intent, first = effects.issue('commit')
            self.draft.preparation._entry(request_id)
            check_time(deadline)
            if first is not True:
                return self._result(effects, 'held_uncertain')
            response = self.transport(copy.deepcopy(effects.plan), deadline,
                owned=lambda: runtime._owned)
            self.draft.preparation._entry(request_id)
            check_time(deadline)
            if type(response) is not tuple or len(response) != 2:
                raise ValueError('Original processing response shape differs')
            status, body = response
            effects.save_reply('commit', status, body)
            self.draft.preparation._entry(request_id)
            check_time(deadline)
            return self._result(effects, 'commit_reply_retained')

    def __call__(self, job):
        if not isinstance(job, dict) or not isinstance(job.get('request'), dict):
            raise ValueError('Original processing needs its original job request')
        entry = self.draft.preparation._entry(job['request'].get('requestId'))
        if not same(job['request'], entry.request):
            raise ValueError('Processing job request differs from its original')
        result = self.advance(entry.request['requestId'])
        job['commit'] = result
        job['state'] = 'processing_pending' if result['state'] == 'commit_reply_retained' else 'processing_held'
