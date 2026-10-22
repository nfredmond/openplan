"""Keep supplied task replies in an original private engine root.

Records retain reported facts and exact bytes. They grant no transport, retry,
publication, engine adoption or processing-quality permission. Writers must
cooperate; this is not a live-authority or adversarial same-UID fence.
"""
import base64
import copy
import hashlib
import json
import math
import re
import time

from admission_journal import private
from draft_custody import original_plan
from engine_effects import RESPONSE_LIMIT, same
from retained_source import absolute, check_time, json_bytes, publish, reader, read_json, writer
from task_observation import observe

RECORD_LIMIT = 4 * RESPONSE_LIMIT + 65536


def finite_number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


class Observations:
    def __init__(self, root, plan, *, records_root, timeout=2):
        if not finite_number(timeout) or timeout <= 0:
            raise ValueError('Task observation timeout must be positive and finite')
        self.root = absolute(root)
        private(self.root, True)
        self.records_root = absolute(records_root)
        private(self.records_root, True)
        if self.records_root == self.root or self.root in self.records_root.parents or self.records_root in self.root.parents:
            raise ValueError('Task observation records must be separate from engine commands')
        self.plan = original_plan(copy.deepcopy(plan))
        self.timeout = timeout
        try:
            self._check_plan(allow_empty=True)
        except ValueError as error:
            # Wait for an existing writer without provisioning an empty ledger.
            if str(error) != 'Retained task observation ledger plan is missing' or not (self.records_root / 'writer.lock').exists():
                raise
            with writer(self.records_root, time.monotonic() + self.timeout):
                self._check_plan(allow_empty=True)

    def _check_original(self):
        private(self.root, True)
        if not same(read_json(self.root, 'plan.json'), self.plan):
            raise ValueError('Retained task observation original plan differs')

    def _check_plan(self, *, allow_empty=False):
        self._check_original()
        private(self.records_root, True)
        ledger = self.records_root / 'plan.json'
        if ledger.exists() or ledger.is_symlink():
            if not same(read_json(self.records_root, 'plan.json'), self.plan):
                raise ValueError('Retained task observation ledger plan differs')
        elif not allow_empty or any(p.name != 'writer.lock' for p in self.records_root.iterdir()):
            raise ValueError('Retained task observation ledger plan is missing')

    def _deadline(self, supplied):
        own = time.monotonic() + self.timeout
        if supplied is not None:
            if not finite_number(supplied):
                raise ValueError('Task observation shared deadline must be finite')
            own = min(own, supplied)
        check_time(own)
        return own

    def record(self, status, body, *, deadline=None):
        """Publish one exact checked reply; replay never overwrites older bytes."""
        deadline = self._deadline(deadline)
        self._check_original()
        result = observe(self.plan, status, body)
        payload = json_bytes(result)
        if len(payload) > RECORD_LIMIT:
            raise ValueError('Retained task observation exceeds its record bound')
        check_time(deadline)
        folder = self.records_root
        private(folder, True)
        with writer(folder, deadline):
            self._check_plan(allow_empty=True)
            check_time(deadline)
            publish(folder, 'plan.json', json_bytes(self.plan))
            publish(folder, result['bodySha256'] + '.json', payload, json_limit=RECORD_LIMIT)
            check_time(deadline)
        return copy.deepcopy(result)

    def load(self, digest, *, deadline=None):
        """Recheck saved interpretations against their original plan and body."""
        deadline = self._deadline(deadline)
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('Retained task observation digest differs')
        self._check_plan()
        folder = self.records_root
        private(folder, True)
        with reader(folder, digest + '.json') as (stream, info):
            if info.st_size > RECORD_LIMIT:
                raise ValueError('Retained task observation exceeds its record bound')
            payload = stream.read(RECORD_LIMIT + 1)
        check_time(deadline)
        saved = json.loads(payload)
        if json_bytes(saved) != payload:
            raise ValueError('Retained task observation encoding differs')
        try:
            body = base64.b64decode(saved['bodyBase64'], validate=True)
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError('Retained task observation body differs') from error
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError('Retained task observation body digest differs')
        expected = observe(self.plan, 200, body)
        if not same(saved, expected):
            raise ValueError('Retained task observation interpretation differs')
        self._check_plan()
        check_time(deadline)
        return copy.deepcopy(expected)
