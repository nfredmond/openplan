"""Compare captured NodeODM draft bytes. Never authorize another engine effect.

The caller must establish snapshot integrity and original engine ownership.
This library does not stop writers, attest an installation or change journals.
"""
import hashlib
import json
import math
import os
import re
import time

from admission_journal import private
from engine_effects import FORMAT, ZIP_FORMAT, commands, make_plan, same
import derived_zip
from retained_source import absolute, check_time, digest, finite_limit, json_bytes, reader

METADATA_LIMIT = 1024 * 1024


def original_plan(plan):
    fields = {'format', 'binding', 'sourceManifestSha256', 'engine', 'taskUuid', 'name', 'options', 'uploads'}
    zipped = isinstance(plan, dict) and plan.get('format') == ZIP_FORMAT
    if zipped: fields.add('sourceCustody')
    if not isinstance(plan, dict) or set(plan) != fields or plan['format'] not in (FORMAT, ZIP_FORMAT) or not isinstance(plan['sourceManifestSha256'], str) or not re.fullmatch('[0-9a-f]{64}', plan['sourceManifestSha256']):
        raise ValueError('Original engine plan shape or source identity differs')
    uploads = plan['uploads']
    if not isinstance(uploads, list) or not uploads:
        raise ValueError('Original engine upload mapping is required')
    for index, row in enumerate(uploads):
        row_fields = {'slot', 'objectRelativePath', 'bytes', 'sha256', 'filename'} | ({'archiveMember'} if zipped else set())
        prefix = 'image' if zipped else 'source'
        if not isinstance(row, dict) or set(row) != row_fields or type(row['slot']) is not int or row['slot'] != index or row['objectRelativePath'] != f'objects/{prefix}-{index:05d}.bin' or type(row['bytes']) is not int or row['bytes'] < 0 or not isinstance(row['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', row['sha256']):
            raise ValueError('Original engine upload record differs')
    try:
        receipt = {'manifest': {'binding': plan['binding'], 'sources': [
            {key: value for key, value in row.items() if zipped or key != 'filename'} for row in uploads]},
            'manifestSha256': plan['sourceManifestSha256']}
        if zipped:
            custody = plan['sourceCustody']
            if not isinstance(custody, dict) or set(custody) != {'retainedManifestSha256', 'derivedPlanSha256', 'archive'}:
                raise ValueError('Original ZIP source custody shape differs')
            if plan['binding']['originalRequest']['imagery']['type'] != 'zip_url':
                raise ValueError('Original ZIP plan requires ZIP imagery')
            receipt['manifest'].update(format=derived_zip.MANIFEST,
                sourceManifestSha256=custody['retainedManifestSha256'],
                planSha256=custody['derivedPlanSha256'], archive=custody['archive'])
        reconstructed = make_plan(receipt, plan['engine'], plan['taskUuid'], plan['name'],
                                  plan['options'], [row['filename'] for row in uploads])
    except (KeyError, TypeError) as error:
        raise ValueError('Original engine plan binding is unsupported') from error
    if not same(plan, reconstructed):
        raise ValueError('Original engine plan identity differs')
    return reconstructed


def metadata(root, name):
    with reader(root, name) as (stream, before):
        if before.st_size > METADATA_LIMIT:
            raise ValueError('Captured draft metadata exceeds its bound')
        raw = stream.read(METADATA_LIMIT+1)
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Captured draft metadata repeats a JSON key')
            result[key] = value
        return result
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs)
    return value, {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def filenames(root, limit, deadline):
    names = set()
    with os.scandir(root) as entries:
        for entry in entries:
            check_time(deadline)
            names.add(entry.name)
            if len(names) > limit:
                raise ValueError('Captured draft has too many files or duplicates')
    return names


def inspect(root, plan, *, max_bytes, timeout=30):
    """Report matching captured bytes or inconclusive absence, without repair."""
    finite_limit(max_bytes)
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Draft inspection timeout must be positive and finite')
    deadline = time.monotonic()+timeout
    plan = original_plan(plan)
    if sum(row['bytes'] for row in plan['uploads']) > max_bytes:
        raise ValueError('Original planned images exceed inspection byte budget')
    root = absolute(root);private(root, True)
    result = {'planSha256': hashlib.sha256(json_bytes(plan)).hexdigest(), 'taskUuid': plan['taskUuid'],
              'scope': 'captured_draft_bytes', 'engineIdentityVerification': 'unassessed',
              'sourceProvenanceVerification': 'unassessed', 'transportPermission': False,
              'metadata': None, 'matchingUploads': [], 'missingUploads': []}
    temporary = root/'tmp'
    if temporary.exists() or temporary.is_symlink():
        private(temporary, True)
    draft = temporary/plan['taskUuid']
    if not draft.exists() and not draft.is_symlink():
        result.update(state='inconclusive', reason='draft_absent', missingUploads=[row['slot'] for row in plan['uploads']])
        check_time(deadline)
        return result
    private(draft, True)
    names = filenames(draft, len(plan['uploads'])+1, deadline)
    expected = {row['filename'] for row in plan['uploads']} | {'body.json'}
    if not names <= expected:
        raise ValueError('Captured draft contains mixed or duplicate files')
    if 'body.json' in names:
        value, observed = metadata(draft, 'body.json')
        if not same(value, commands(plan)['init']['form']):
            raise ValueError('Captured draft metadata differs from original initialization')
        result['metadata'] = observed
    remaining = max_bytes
    for row in plan['uploads']:
        check_time(deadline)
        if row['filename'] not in names:
            result['missingUploads'].append(row['slot'])
            continue
        observed = digest(draft, row['filename'], remaining, deadline)
        remaining -= observed['bytes']
        if observed != {key: row[key] for key in ('bytes', 'sha256')}:
            raise ValueError('Captured draft upload differs from original bytes')
        result['matchingUploads'].append({'slot': row['slot'], 'filename': row['filename'], **observed})
    # Missing body.json can follow a commit. No task absence or missing file
    # establishes that another external request would be safe to repeat.
    result['state'] = 'inconclusive' if result['metadata'] is None else 'partial_matching_draft' if result['missingUploads'] else 'complete_matching_draft'
    result['reason'] = 'metadata_missing' if result['metadata'] is None else 'planned_uploads_missing' if result['missingUploads'] else 'captured_metadata_and_bytes_match'
    if filenames(draft, len(plan['uploads'])+1, deadline) != names:
        raise ValueError('Captured draft filenames changed during inspection')
    check_time(deadline)
    return result
