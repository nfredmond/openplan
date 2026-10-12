"""Validate private application originals without granting engine permission."""
from datetime import datetime
import hashlib
import json
import math
import re
import time
import uuid

from runtime_dispatch_custody import Custody, MAX_BYTES, ROW_FIELDS, strict_object

FORMAT = 'openplan.odm-application-dispatch.v1'
FIELDS = {'format', 'installationId', 'targetId', 'applicationJob', 'payloadText',
          'payloadBytes', 'payloadSha256', 'authorizedNow', 'authorityObservedAt',
          'engineTransportPermission'}
WIRE_LIMIT = 6 * MAX_BYTES + 1024 * 1024


class Reader:
    def __init__(self, dispatch, transport, *, timeout=10):
        if not isinstance(dispatch, Custody) or not callable(transport):
            raise ValueError('Private dispatch custody and transport are required')
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Private dispatch read timeout must be positive and finite')
        self.dispatch = dispatch;self.transport = transport;self.timeout = min(timeout, dispatch.timeout)

    def _deadline(self, deadline):
        current = time.monotonic() + self.timeout
        if deadline is None:
            return current
        if type(deadline) not in (int, float) or not math.isfinite(deadline):
            raise ValueError('Private dispatch read deadline must be finite')
        return min(current, deadline)

    def _receipt(self, entry, raw):
        if type(raw) is not bytes or not 0 < len(raw) <= WIRE_LIMIT:
            raise ValueError('Private application dispatch receipt bytes differ')
        try:
            value = json.loads(raw.decode('utf-8'), object_pairs_hook=strict_object,
                parse_constant=lambda text: (_ for _ in ()).throw(ValueError('Nonfinite receipt JSON')))
        except (UnicodeError, ValueError, RecursionError):
            raise ValueError('Private application dispatch receipt JSON differs') from None
        if not isinstance(value, dict) or set(value) != FIELDS or value['format'] != FORMAT or value['installationId'] != self.dispatch.runtime.installation['installationId'] or value['targetId'] != self.dispatch.target or value['engineTransportPermission'] is not False or type(value['authorizedNow']) is not bool:
            raise ValueError('Private application dispatch receipt scope differs')
        observed = value['authorityObservedAt']
        if not isinstance(observed, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})', observed):
            raise ValueError('Private application dispatch observation time differs')
        try:
            datetime.fromisoformat(observed.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError('Private application dispatch observation time differs') from None
        row = value['applicationJob']
        if not isinstance(row, dict) or set(row) != ROW_FIELDS:
            raise ValueError('Private application dispatch job projection differs')
        for key in ('id', 'workspace_id', 'project_id', 'mission_id', 'created_by'):
            if key == 'project_id' and row[key] is None:
                continue
            try:
                if not isinstance(row[key], str) or str(uuid.UUID(row[key])) != row[key]:
                    raise ValueError('UUID differs')
            except ValueError:
                raise ValueError('Private application dispatch job identity differs') from None
        text = value['payloadText']
        try:
            payload = text.encode('utf-8') if isinstance(text, str) else None
        except UnicodeError:
            raise ValueError('Private application dispatch original bytes differ') from None
        if payload is None or not 0 < len(payload) <= MAX_BYTES or type(value['payloadBytes']) is not int or value['payloadBytes'] != len(payload) or value['payloadSha256'] != hashlib.sha256(payload).hexdigest():
            raise ValueError('Private application dispatch original bytes differ')
        # Reuse custody's full contract, admission and original eight-field binding.
        self.dispatch._record(entry, payload, row)
        return value

    def _read(self, request_id, deadline):
        entry = self.dispatch._check(request_id, deadline)
        arguments = {'p_request': request_id, 'p_installation': self.dispatch.runtime.installation['installationId'], 'p_target': self.dispatch.target}
        raw = self.transport(arguments, deadline, owned=lambda: self.dispatch.runtime._owned)
        self.dispatch._check(request_id, deadline)
        receipt = self._receipt(entry, raw)
        self.dispatch._check(request_id, deadline)
        return receipt

    def capture(self, entry, *, deadline=None):
        deadline = self._deadline(deadline)
        current = self.dispatch._check(entry.request['requestId'], deadline)
        if entry != current:
            raise ValueError('Private application dispatch original admission differs')
        receipt = self._read(entry.request['requestId'], deadline)
        if receipt['authorizedNow'] is not True:
            raise PermissionError('Private application dispatch actor is no longer authorized')
        return receipt['payloadText'].encode('utf-8'), receipt['applicationJob']

    def observe(self, request_id, *, deadline=None):
        deadline = self._deadline(deadline)
        saved = self.dispatch.load(request_id, deadline=deadline)
        current = self._read(request_id, deadline)
        if current['payloadText'] != saved['payloadText'] or current['applicationJob'] != saved['applicationJob'] or current['payloadSha256'] != saved['payloadSha256']:
            raise ValueError('Private application dispatch saved original differs')
        self.dispatch._check(request_id, deadline)
        return {'authorizedNow': current['authorizedNow'], 'authorityObservedAt': current['authorityObservedAt'],
                'payloadSha256': current['payloadSha256'], 'engineTransportPermission': False}
