"""Inspect an uncertain original commit without acknowledging or repeating it.

Reported task progress and exact command acknowledgments remain separate. This
explicit bridge grants no callback, artifact, publication or quality permission.
"""
import copy
import time

from admission_journal import private
from engine_effects import same
from retained_source import check_time, read_json, writer
from runtime_commit import Commit, FORMAT as COMMIT_FORMAT
from runtime_observation import Observer

FORMAT = 'openplan.odm-uncertain-commit-inspection.v1'


class Inspection:
    def __init__(self, commit, observer):
        if not isinstance(commit, Commit) or not isinstance(observer, Observer):
            raise ValueError('Original commit and current task observer are required')
        self.commit = commit
        self.observer = observer
        self._scope()

    def _scope(self):
        if self.observer.reader.dispatch.runtime is not self.commit.draft.preparation.runtime:
            raise ValueError('Commit inspection requires the same owned runtime')

    @staticmethod
    def _result(effects, acknowledgment, observation=None):
        return {'format': FORMAT, 'taskUuid': effects.plan['taskUuid'],
            'enginePlanSha256': effects.plan_hash,
            'commitAcknowledgmentState': acknowledgment,
            'taskObservation': copy.deepcopy(observation),
            'commitRetryPermission': False, 'callbackPermission': False,
            'publicationPermission': False, 'processingQualityVerification': 'unassessed'}

    def inspect(self, request_id):
        """Read one current original task only when its issued commit lacks a reply."""
        deadline = time.monotonic() + self.commit.timeout
        self._scope()
        draft = self.commit.draft
        effects, root = draft._effects(request_id, deadline)
        snapshot = effects.snapshot(deadline=deadline)
        draft.preparation._entry(request_id)
        check_time(deadline)
        if any(row['state'] != 'acknowledged' for row in snapshot['commands'][:-1]):
            return self._result(effects, 'held_incomplete_draft')
        acknowledgment = snapshot['commands'][-1]['state']
        if acknowledgment != 'unresolved':
            return self._result(effects, acknowledgment)
        dispatch = root / 'processing-dispatch'
        private(dispatch, True)
        with writer(dispatch, deadline):
            draft.preparation._entry(request_id)
            expected = {'format': COMMIT_FORMAT, 'enginePlanSha256': effects.plan_hash,
                'originalContext': effects.plan['binding']['originalContext']}
            if not same(read_json(dispatch, 'original-plan.json'), expected):
                raise ValueError('Commit inspection original dispatch differs')
            current = effects.snapshot(deadline=deadline)
            acknowledgment = current['commands'][-1]['state']
            if acknowledgment != 'unresolved':
                return self._result(effects, acknowledgment)
            check_time(deadline)
            remaining = deadline - time.monotonic()
            observer = Observer(self.observer.reader, self.observer.resolve,
                self.observer.attest, timeout=min(self.observer.timeout, remaining))
            observation = observer.observe(request_id)
            draft.preparation._entry(request_id)
            check_time(deadline)
            task = observation['task']
            if task['originalPlanSha256'] != effects.plan_hash:
                raise ValueError('Commit inspection original observation differs')
            final = effects.snapshot(deadline=deadline)
            draft.preparation._entry(request_id)
            check_time(deadline)
            return self._result(effects, final['commands'][-1]['state'], observation)

    def __call__(self, job):
        if not isinstance(job, dict) or not isinstance(job.get('request'), dict):
            raise ValueError('Commit inspection requires its original job request')
        entry = self.commit.draft.preparation._entry(job['request'].get('requestId'))
        if not same(job['request'], entry.request):
            raise ValueError('Commit inspection job request differs from its original')
        job['commitInspection'] = self.inspect(entry.request['requestId'])
