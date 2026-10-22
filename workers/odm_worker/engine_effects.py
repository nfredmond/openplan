"""Disconnected original engine plans and at-most-once local command intents.

No HTTP request runs here. A first-issue flag is not authority, sequencing or
verified engine custody. Uncertain effects need actual backend reconciliation.
Cooperative writers, private local files and retained image slots are required.
"""
import base64
import hashlib
import json
import math
import re
import time
import uuid
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from admission_journal import encoded, private, synchronize
from retained_source import absolute, check_time, json_bytes, prepare, publish, read_json, writer
import derived_zip

FORMAT = 'openplan.odm-engine-plan.v1'
ZIP_FORMAT = 'openplan.odm-engine-zip-plan.v1'
INTENT = 'openplan.odm-engine-intent.v1'
REPLY = 'openplan.odm-engine-reply.v1'
RESPONSE_LIMIT = 1024 * 1024


def checksum(value):
    return hashlib.sha256(value).hexdigest()


def same(left, right):
    return encoded(left, canonical=True) == encoded(right, canonical=True)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def zip_custody(manifest):
    """Validate ordered derived-slot descriptors without attesting their bytes."""
    archive = manifest.get('archive')
    hashes = (manifest.get('sourceManifestSha256'), manifest.get('planSha256'))
    if manifest.get('format') != derived_zip.MANIFEST or any(not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value) for value in hashes) or not isinstance(archive, dict) or set(archive) != {'bytes', 'sha256'} or type(archive['bytes']) is not int or archive['bytes'] < 0 or not isinstance(archive['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', archive['sha256']):
        raise ValueError('ZIP derived-image lineage is required')
    rows = manifest.get('sources')
    if not isinstance(rows, list) or not rows:
        raise ValueError('ZIP derived-image slots are required')
    names = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {'slot', 'objectRelativePath', 'filename', 'archiveMember', 'bytes', 'sha256'} or type(row['slot']) is not int or row['slot'] != index or row['objectRelativePath'] != f'objects/image-{index:05d}.bin' or type(row['bytes']) is not int or row['bytes'] < 0 or not isinstance(row['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['sha256']):
            raise ValueError('ZIP derived-image slot mapping differs')
        member = row['archiveMember']
        if not isinstance(member, str) or not member or len(member) > 1024 or '\\' in member or any(ord(char) < 32 or ord(char) == 127 for char in member) or PurePosixPath(member).is_absolute() or str(PurePosixPath(member)) != member or any(part in ('.', '..') for part in member.split('/')) or PurePosixPath(member).suffix.lower() not in derived_zip.IMAGE_EXTENSIONS or row['filename'] != f'image-{index:05d}'+PurePosixPath(member).suffix.lower():
            raise ValueError('ZIP derived-image member or filename differs')
        names.append(member)
    if names != sorted(set(names)):
        raise ValueError('ZIP derived-image member order differs')
    return {'retainedManifestSha256': hashes[0], 'derivedPlanSha256': hashes[1], 'archive': archive}


def engine_identity(value):
    fields = {'instanceId', 'endpoint', 'api', 'version', 'imageId', 'configurationSha256', 'credentialReference'}
    if not isinstance(value, dict) or set(value) != fields or not all(nonempty(value[key]) for key in fields):
        raise ValueError('Exact engine identity and credential reference are required')
    endpoint = urlsplit(value['endpoint'])
    if endpoint.scheme not in ('http', 'https') or not endpoint.hostname or endpoint.username is not None or endpoint.password is not None or endpoint.query or endpoint.fragment or value['endpoint'].endswith('/'):
        raise ValueError('Engine endpoint must not carry credentials or query state')
    if value['api'] != 'nodeodm-2.2.4-draft' or value['version'] != '2.2.4' or not re.fullmatch('sha256:[0-9a-f]{64}', value['imageId']) or not re.fullmatch('[0-9a-f]{64}', value['configurationSha256']):
        raise ValueError('Engine protocol or immutable digest is unsupported')
    return json.loads(encoded(value, canonical=True))


def make_plan(receipt, engine, task_uuid, name, options, filenames):
    manifest = receipt['manifest']
    source_type = manifest['binding']['originalRequest']['imagery']['type']
    if source_type not in ('photo_manifest', 'zip_url') or source_type == 'zip_url' and manifest.get('format') != derived_zip.MANIFEST:
        raise ValueError('ZIP source requires original derived-image custody')
    custody = zip_custody(manifest) if source_type == 'zip_url' else None
    if custody is not None and filenames != [row['filename'] for row in manifest['sources']]:
        raise ValueError('ZIP original derived filenames must be preserved')
    if not isinstance(task_uuid, str) or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', task_uuid) or str(uuid.UUID(task_uuid)) != task_uuid:
        raise ValueError('Original engine task UUID must be canonical')
    if not nonempty(name) or len(name) > 512:
        raise ValueError('Original engine task name is invalid')
    if not isinstance(options, list) or any(not isinstance(row, dict) or set(row) != {'name', 'value'} or not nonempty(row['name']) or type(row['value']) not in (str, int, float, bool) for row in options) or len({row['name'] for row in options}) != len(options):
        raise ValueError('Explicit ordered engine options are required')
    if not isinstance(filenames, list) or len(filenames) != len(manifest['sources']) or any(not isinstance(item, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,179}\\.(jpg|jpeg|png|tif|tiff)', item) for item in filenames) or len(set(filenames)) != len(filenames):
        raise ValueError('Exact ordered upload filenames are required')
    uploads = [{**row, 'filename': filename} for row, filename in zip(manifest['sources'], filenames)]
    plan = {'format': ZIP_FORMAT if custody is not None else FORMAT, 'binding': manifest['binding'],
        'sourceManifestSha256': receipt['manifestSha256'], 'engine': engine_identity(engine),
        'taskUuid': task_uuid, 'name': name, 'options': options, 'uploads': uploads}
    if custody is not None:
        plan['sourceCustody'] = custody
    return json.loads(encoded(plan, canonical=True))


def commands(plan):
    task = plan['taskUuid']
    result = {'init': {'method': 'POST', 'path': '/task/new/init', 'headers': {'set-uuid': task},
        'form': {'name': plan['name'], 'options': encoded(plan['options'])}}}
    for row in plan['uploads']:
        result['upload:'+str(row['slot'])] = {'method': 'POST', 'path': '/task/new/upload/'+task,
            'multipart': {'field': 'images', **row}}
    result['commit'] = {'method': 'POST', 'path': '/task/new/commit/'+task}
    return result


def parsed_reply(plan, operation, status, body):
    if type(status) is not int or status != 200 or not isinstance(body, bytes) or len(body) > RESPONSE_LIMIT:
        raise ValueError('Engine reply status, byte type or bound is invalid')
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Engine reply has duplicate JSON keys')
            result[key] = value
        return result
    def constant(_value):
        raise ValueError('Engine reply contains nonfinite JSON')
    value = json.loads(body.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)
    # Finite lexical numbers can still overflow to infinity during parsing.
    encoded(value, canonical=True)
    if not isinstance(value, dict) or 'error' in value or (value.get('uuid') != plan['taskUuid'] if operation in ('init', 'commit') else value.get('success') is not True):
        raise ValueError('Engine reply does not establish original command acknowledgment')
    return value


class Effects:
    """Recheck original source bytes before each private journal operation."""
    def __init__(self, root, *, source_arguments, engine, task_uuid, name, options, filenames, timeout=2, derived_arguments=None, deadline=None):
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Engine journal timeout must be positive and finite')
        self.root = absolute(root)
        source_pack = absolute(source_arguments['destination'])
        if self.root == source_pack or self.root in source_pack.parents or source_pack in self.root.parents:
            raise ValueError('Engine journal and retained source roots must not overlap')
        self.timeout = timeout
        self.deadline = deadline
        self._end()
        self.derived_arguments = None
        if derived_arguments is not None:
            required = {'destination', 'max_expanded_bytes'}
            if not isinstance(derived_arguments, dict) or not required <= set(derived_arguments) or set(derived_arguments) - required - {'max_entries', 'max_directory_bytes'}:
                raise ValueError('Exact ZIP derivation arguments are required')
            self.derived_arguments = dict(derived_arguments)
            derived_pack = absolute(self.derived_arguments['destination'])
            self.derived_arguments['destination'] = derived_pack
            if self.root == derived_pack or self.root in derived_pack.parents or derived_pack in self.root.parents:
                raise ValueError('Engine journal and derived image roots must not overlap')
        self.source_arguments = dict(source_arguments)
        self.source_arguments['context'] = json.loads(encoded(source_arguments['context'], canonical=True))
        self.source_arguments['sources'] = list(source_arguments['sources'])
        receipt = self._source_receipt()
        self.plan = make_plan(receipt, engine, task_uuid, name, options, filenames)
        self.plan_bytes = json_bytes(self.plan)
        self.plan_hash = checksum(self.plan_bytes)
        self.command_map = commands(self.plan)
        private(self.root.parent, True)
        try:
            self.root.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(self.root.parent)
        private(self.root, True)
        with writer(self.root, self._end()):
            saved = self.root/'plan.json'
            if not saved.exists() and not saved.is_symlink() and any(path.name != 'writer.lock' and not path.name.startswith('.partial-') for path in self.root.iterdir()):
                raise ValueError('Engine effect records have no original plan')
            publish(self.root, 'plan.json', self.plan_bytes)
            self._check()

    def _end(self, deadline=None):
        """Clamp each validation to its caller's original finite budget."""
        end = time.monotonic()+self.timeout
        for supplied in (self.deadline, deadline):
            if supplied is not None:
                if type(supplied) not in (int, float) or not math.isfinite(supplied):
                    raise ValueError('Engine journal shared deadline must be finite')
                end = min(end, supplied)
        check_time(end)
        return end

    def _source_receipt(self, deadline=None):
        """Revalidate actual raw and derived bytes before journal publication."""
        end = self._end(deadline)
        remaining = end-time.monotonic()
        original_timeout = self.source_arguments.get('timeout', self.timeout)
        if type(original_timeout) not in (int, float) or not math.isfinite(original_timeout) or original_timeout <= 0:
            raise ValueError('Engine source validation timeout must be positive and finite')
        check_time(end)
        arguments = {**self.source_arguments, 'timeout': min(original_timeout, remaining)}
        if self.derived_arguments is not None:
            return derived_zip.prepare(arguments, **self.derived_arguments, timeout=remaining)
        return prepare(**arguments)

    def _check(self, deadline=None):
        end = self._end(deadline)
        if not same(read_json(self.root, 'plan.json'), self.plan):
            raise ValueError('Saved engine plan differs from original identity')
        receipt = self._source_receipt(end)
        if receipt['manifestSha256'] != self.plan['sourceManifestSha256']:
            raise ValueError('Actual retained engine source identity differs')
        names = {'plan.json', 'writer.lock'}
        for operation, command in self.command_map.items():
            check_time(end)
            intent_name, reply_name = self._names(operation)
            names.update((intent_name, reply_name))
            intent_path = self.root/intent_name;reply_path = self.root/reply_name
            if intent_path.exists() or intent_path.is_symlink():
                if not same(read_json(self.root, intent_name), self._intent(operation, command)):
                    raise ValueError('Saved engine command intent differs')
            elif reply_path.exists() or reply_path.is_symlink():
                raise ValueError('Saved engine reply has no original intent')
            if reply_path.exists() or reply_path.is_symlink():
                stored = read_json(self.root, reply_name)
                if not isinstance(stored, dict) or not isinstance(stored.get('bodyBase64'), str):
                    raise ValueError('Saved engine reply encoding differs')
                body = base64.b64decode(stored['bodyBase64'], validate=True)
                if not same(stored, self._reply(operation, stored.get('status'), body)):
                    raise ValueError('Saved engine reply identity differs')
        if any(path.name not in names and not path.name.startswith('.partial-') for path in self.root.iterdir()):
            raise ValueError('Engine journal contains unknown effect records')
        check_time(end)

    def _names(self, operation):
        if operation not in self.command_map:
            raise ValueError('Original engine command is unsupported')
        index = list(self.command_map).index(operation)
        prefix = f'command-{index:05d}'
        return prefix+'.intent.json', prefix+'.reply.json'

    def _intent(self, operation, command):
        return {'format': INTENT, 'planSha256': self.plan_hash, 'operation': operation,
                'command': command, 'commandSha256': checksum(json_bytes(command))}

    def _reply(self, operation, status, body):
        value = parsed_reply(self.plan, operation, status, body)
        return {'format': REPLY, 'planSha256': self.plan_hash, 'operation': operation,
                'commandSha256': checksum(json_bytes(self.command_map[operation])),
                'status': status, 'bodyBase64': base64.b64encode(body).decode('ascii'),
                'bodyBytes': len(body), 'bodySha256': checksum(body), 'parsed': value,
                'engineCustodyVerification': 'unassessed'}

    def issue(self, operation):
        """Record an exact command once. Existing intents never issue again."""
        with writer(self.root, self._end()):
            self._check()
            name, _reply_name = self._names(operation)
            existed = (self.root/name).exists() or (self.root/name).is_symlink()
            intent = self._intent(operation, self.command_map[operation])
            publish(self.root, name, json_bytes(intent))
            return json.loads(encoded(intent, canonical=True)), not existed

    def save_reply(self, operation, status, body):
        """Save checked exact reply bytes. This does not verify engine custody."""
        with writer(self.root, self._end()):
            self._check()
            intent_name, reply_name = self._names(operation)
            if not (self.root/intent_name).exists():
                raise ValueError('Engine reply requires a durably issued intent')
            reply = self._reply(operation, status, body)
            publish(self.root, reply_name, json_bytes(reply))
            return json.loads(encoded(reply, canonical=True))

    def snapshot(self, *, deadline=None):
        """Expose exact issued/unresolved states without treating absence as retry."""
        end = self._end(deadline)
        with writer(self.root, end):
            self._check(end)
            result = []
            for operation in self.command_map:
                intent_name, reply_name = self._names(operation)
                result.append({'operation': operation,
                    'state': 'acknowledged' if (self.root/reply_name).exists() else 'unresolved' if (self.root/intent_name).exists() else 'unissued',
                    'engineCustodyVerification': 'unassessed'})
            return {'planSha256': self.plan_hash, 'commands': result}
