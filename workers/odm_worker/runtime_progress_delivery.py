"""Retain exact progress callbacks before an explicitly supplied transport.

This adapter does not issue artifact links or terminal callbacks. Repeating an
uncertain POST relies on the application's exact-payload replay contract. The
caller must supply a supervised, authenticated transport; this is not enabled
by the worker entry point.
"""
import base64
from datetime import datetime
import hashlib
import json
import math
import re
import time

from admission_journal import private, synchronize
import contract
from application_dispatch_reader import Reader
from retained_output_archive import clear_unpublished
from retained_source import json_bytes, publish, read_json, writer
from runtime_dispatch_custody import strict_object

FORMAT = 'openplan.odm-progress-delivery.v1'
BODY_LIMIT = 16 * 1024
REPLY_LIMIT = 64 * 1024
STATUSES = set(contract.CALLBACK_STATUSES) - {'succeeded', 'failed', 'canceled'}
FIELDS = {'schemaVersion', 'requestId', 'callbackId', 'jobReference', 'status', 'occurredAt'}


def parse(raw, limit):
    if type(raw) is not bytes or not 0 < len(raw) <= limit:
        raise ValueError('Progress delivery JSON byte count differs')
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=strict_object,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
        json_bytes(value)
        return value
    except (UnicodeError, ValueError, RecursionError):
        raise ValueError('Progress delivery JSON differs') from None


def checksum(raw):
    return hashlib.sha256(raw).hexdigest()


class Delivery:
    record_format = FORMAT

    def __init__(self, reader, transport, credential_reference, *, timeout=120,
                 cancelled=lambda: False, max_attempts=10000):
        if not isinstance(reader, Reader) or not callable(transport) or not callable(cancelled):
            raise ValueError('Progress delivery needs original dispatch and explicit transport adapters')
        if not isinstance(credential_reference, str) or not credential_reference.strip() or len(credential_reference) > 256:
            raise ValueError('Progress delivery needs an operator credential reference')
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Progress delivery needs a finite positive deadline')
        if type(max_attempts) is not int or not 1 <= max_attempts <= 100000:
            raise ValueError('Progress delivery needs bounded attempt retention')
        self.reader = reader
        self.transport = transport
        self.credential_reference = credential_reference
        self.timeout = timeout
        self.cancelled = cancelled
        self.max_attempts = max_attempts

    def _check(self, request_id, deadline):
        entry = self.reader.dispatch._check(request_id, deadline)
        decision = self.cancelled()
        if type(decision) is not bool:
            raise ValueError('Progress delivery cancellation must be a boolean')
        if decision:
            raise InterruptedError('Progress delivery cancelled')
        return entry

    def _access(self, request_id, deadline):
        self._check(request_id, deadline)
        if self.reader.observe(request_id, deadline=deadline)['authorizedNow'] is not True:
            raise PermissionError('Progress delivery current application access refused')
        self._check(request_id, deadline)

    def folder(self, request_id, event_key):
        if not isinstance(event_key, str) or not event_key.strip() or len(event_key) > 256:
            raise ValueError('Progress delivery needs an original event key')
        return self.reader.dispatch.runtime.root / ('progress-delivery-'+checksum(request_id.encode())+'-'+checksum(event_key.encode()))

    def _command(self, request_id, event_key, raw, deadline):
        entry = self._check(request_id, deadline)
        original = self.reader.dispatch.load(request_id, deadline=deadline)
        value = parse(raw, BODY_LIMIT)
        if not isinstance(value, dict) or not FIELDS <= value.keys() or value.keys() - FIELDS - {'progress', 'message'}:
            raise ValueError('Progress delivery callback projection differs')
        if value['schemaVersion'] != entry.request['schemaVersion'] or value['requestId'] != request_id or value['jobReference'] != entry.job_reference or not isinstance(value['status'], str) or value['status'] not in STATUSES:
            raise ValueError('Progress delivery original callback scope differs')
        if not isinstance(value['callbackId'], str) or len(value['callbackId'].encode('utf-16-le'))//2 < 8:
            raise ValueError('Progress delivery callback identity differs')
        occurred = value['occurredAt']
        if not isinstance(occurred, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', occurred):
            raise ValueError('Progress delivery original occurrence time differs')
        try:
            datetime.fromisoformat(occurred.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError('Progress delivery original occurrence time differs') from None
        if 'progress' in value and (type(value['progress']) not in (int, float) or not math.isfinite(value['progress']) or not 0 <= value['progress'] <= 100):
            raise ValueError('Progress delivery progress differs')
        if 'message' in value and (not isinstance(value['message'], str) or len(value['message'].encode('utf-16-le'))//2 > 2048):
            raise ValueError('Progress delivery message differs')
        return {'format': self.record_format, 'binding': {
            'installationId': self.reader.dispatch.runtime.installation['installationId'],
            'targetId': self.reader.dispatch.target, 'requestId': request_id,
            'eventKey': event_key, 'jobReference': entry.job_reference,
            'originalStartContext': entry.started_context,
            'originalApplicationJob': original['applicationJob'],
            'originalDispatchSha256': original['payloadSha256']},
            'callbackUrl': entry.request['callbackUrl'],
            'credentialReference': self.credential_reference,
            'bodyText': raw.decode('utf-8'), 'bodyBytes': len(raw),
            'bodySha256': checksum(raw), 'callbackId': value['callbackId'],
            'status': value['status'], 'publicationPermission': False}

    def _load(self, request_id, event_key, root, deadline):
        saved = read_json(root, 'command.json')
        if not isinstance(saved, dict) or not isinstance(saved.get('bodyText'), str):
            raise ValueError('Progress delivery original command differs')
        expected = self._command(request_id, event_key, saved['bodyText'].encode(), deadline)
        if json_bytes(saved) != json_bytes(expected):
            raise ValueError('Progress delivery original command differs')
        return saved

    def prepare(self, request_id, event_key, raw):
        """Save the complete original command before any external POST is possible."""
        deadline = time.monotonic()+self.timeout
        root = self.folder(request_id, event_key)
        command = self._command(request_id, event_key, raw, deadline)
        self._access(request_id, deadline)
        try:
            root.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root.parent)
        private(root, True)
        with writer(root, deadline):
            clear_unpublished(root)
            if not (root/'command.json').exists() and any(path.name != 'writer.lock' for path in root.iterdir()):
                raise ValueError('Progress delivery records require their original command')
            publish(root, 'command.json', json_bytes(command))
            self._access(request_id, deadline)
            return self._load(request_id, event_key, root, deadline)

    @staticmethod
    def _result(reply, command=None):
        status = reply['status']
        if 400 <= status < 500:
            return 'refused'
        if 200 <= status < 300:
            try:
                body = parse(base64.b64decode(reply['bodyBase64'], validate=True), REPLY_LIMIT)
            except ValueError:
                return 'retry_pending'
            if isinstance(body, dict) and body.get('ok') is True:
                return 'acknowledged'
        return 'retry_pending'

    def _before_transport(self, command, deadline):
        """Allow specialized delivery bounds before retaining a new intent."""
        self._check(command['binding']['requestId'], deadline)

    def advance(self, request_id, event_key, *, expected_command_sha256=None):
        """Make one owned attempt, or return an already retained receiver outcome."""
        if expected_command_sha256 is not None and (not isinstance(expected_command_sha256,str)
                or re.fullmatch('[0-9a-f]{64}',expected_command_sha256) is None):
            raise ValueError('Progress delivery expected original command hash differs')
        deadline = time.monotonic()+self.timeout
        self._access(request_id, deadline)
        root = self.folder(request_id, event_key)
        private(root, True)
        with writer(root, deadline):
            command = self._load(request_id, event_key, root, deadline)
            command_hash = checksum(json_bytes(command))
            if expected_command_sha256 is not None and command_hash!=expected_command_sha256:
                raise ValueError('Progress delivery original command changed before attempt')
            attempts = sorted(path.name for path in root.iterdir() if path.name.startswith('attempt-'))
            if attempts != [f'attempt-{index:06d}.json' for index in range(len(attempts))]:
                raise ValueError('Progress delivery attempt sequence differs')
            replies = {path.name for path in root.iterdir() if path.name.startswith('reply-')}
            if not replies <= {f'reply-{index:06d}.json' for index in range(len(attempts))}:
                raise ValueError('Progress delivery reply requires its original attempt')
            for index, name in enumerate(attempts):
                intent = read_json(root, name)
                if json_bytes(intent) != json_bytes({'format': self.record_format, 'commandSha256': command_hash, 'attempt': index}):
                    raise ValueError('Progress delivery attempt binding differs')
                reply_name = f'reply-{index:06d}.json'
                if (root/reply_name).exists() or (root/reply_name).is_symlink():
                    reply = read_json(root, reply_name)
                    self._validate_reply(reply, command_hash, index)
                    state = self._result(reply, command)
                    if state != 'retry_pending':
                        self._access(request_id, deadline)
                        return {'state': state, 'attempt': index, 'commandSha256': command_hash,
                            'receiverReply': reply, 'publicationPermission': False}
            if len(attempts) >= self.max_attempts:
                raise ValueError('Progress delivery attempt retention limit reached')
            index = len(attempts)
            self._access(request_id, deadline)
            self._before_transport(command, deadline)
            publish(root, f'attempt-{index:06d}.json', json_bytes({
                'format': self.record_format, 'commandSha256': command_hash, 'attempt': index}))
            self._access(request_id, deadline)
            status, body = self.transport(command['callbackUrl'], command['credentialReference'],
                command['bodyText'].encode('utf-8'), deadline,
                owned=lambda: self.reader.dispatch.runtime._owned)
            self._check(request_id, deadline)
            if type(body) is not bytes or len(body) > REPLY_LIMIT:
                raise ValueError('Progress delivery receiver reply exceeds its bound')
            reply = {'format': self.record_format, 'commandSha256': command_hash, 'attempt': index,
                'status': status, 'bodyBase64': base64.b64encode(body).decode()}
            self._validate_reply(reply, command_hash, index)
            publish(root, f'reply-{index:06d}.json', json_bytes(reply))
            self._access(request_id, deadline)
            return {'state': self._result(reply, command), 'attempt': index, 'commandSha256': command_hash,
                'receiverReply': reply, 'publicationPermission': False}

    @classmethod
    def _validate_reply(cls, reply, command_hash, index):
        if not isinstance(reply, dict) or set(reply) != {'format', 'commandSha256', 'attempt', 'status', 'bodyBase64'} or reply['format'] != cls.record_format or reply['commandSha256'] != command_hash or type(reply['attempt']) is not int or reply['attempt'] != index or type(reply['status']) is not int or not 100 <= reply['status'] <= 599 or not isinstance(reply['bodyBase64'], str):
            raise ValueError('Progress delivery receiver reply binding differs')
        try:
            body = base64.b64decode(reply['bodyBase64'], validate=True)
        except ValueError:
            raise ValueError('Progress delivery receiver reply bytes differ') from None
        if len(body) > REPLY_LIMIT:
            raise ValueError('Progress delivery receiver reply exceeds its bound')

    def historical_receiver_receipt(self,request_id,event_key):
        """Read retained receiver facts without authorizing another callback."""
        deadline=time.monotonic()+self.timeout
        self._check(request_id,deadline)
        root=self.folder(request_id,event_key)
        private(root,True)
        with writer(root,deadline):
            command=self._load(request_id,event_key,root,deadline)
            command_hash=checksum(json_bytes(command))
            attempts=sorted(path.name for path in root.iterdir() if path.name.startswith('attempt-'))
            if attempts!=[f'attempt-{index:06d}.json' for index in range(len(attempts))]:
                raise ValueError('Progress historical attempt sequence differs')
            replies={path.name for path in root.iterdir() if path.name.startswith('reply-')}
            if not replies<={f'reply-{index:06d}.json' for index in range(len(attempts))}:
                raise ValueError('Progress historical reply requires its original attempt')
            selected=None
            for index,name in enumerate(attempts):
                intent=read_json(root,name)
                if json_bytes(intent)!=json_bytes({'format':self.record_format,
                        'commandSha256':command_hash,'attempt':index}):
                    raise ValueError('Progress historical attempt binding differs')
                reply_name=f'reply-{index:06d}.json'
                if reply_name in replies:
                    reply=read_json(root,reply_name)
                    self._validate_reply(reply,command_hash,index)
                    state=self._result(reply,command)
                    if selected is None or selected['historicalReceiverOutcome']=='retry_pending':
                        selected={'historicalReceiverOutcome':state,'attempt':index,'receiverReply':reply}
            self._check(request_id,deadline)
            return {**(selected or {'historicalReceiverOutcome':'no_retained_reply'}),
                'commandSha256':command_hash,'currentAccess':'unassessed',
                'transportPermission':False,'publicationPermission':False,
                'applicationAcceptanceVerification':'unassessed'}
