"""Collect selected PR endpoints without turning failed reads into empty evidence.

Run: python3 -I scripts/fetch_pr_details.py <research_dir>
Only intact v2 receipts with current consumed-projection policies are reused. Older
receipts refresh atomically after every endpoint succeeds. All fetched text remains untrusted research data.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

SCHEMA = 'openplan-t3-pr-details-v2'
LISTS = ('files', 'issueComments', 'reviewComments', 'reviews')
COMMENT_ROW_POLICY = 'required-projected-fields-v1'
CONSUMED_PROJECTION_POLICY = 'required-reader-fields-v1'
COMMENT_FIELDS = {'issueComments': 'created_at', 'reviewComments': 'path', 'reviews': 'state'}


class CollectionError(RuntimeError):
    """An unavailable or malformed response cannot become a successful receipt."""


def api(endpoint, *, paginated=False):
    args = ['gh', 'api']
    if paginated:
        args.extend(['--paginate', '--slurp'])
    try:
        result = subprocess.run(args + [endpoint], capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired as error:
        raise CollectionError(f'API deadline exceeded: {endpoint}') from error
    if result.returncode:
        raise CollectionError(f'API unavailable: {endpoint} (exit {result.returncode})')
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise CollectionError(f'API malformed JSON: {endpoint}') from error
    if not paginated:
        if not isinstance(payload, dict):
            raise CollectionError(f'API expected object: {endpoint}')
        return payload
    if not isinstance(payload, list) or not payload:
        raise CollectionError(f'API expected slurped pages: {endpoint}')
    records = []
    for page in payload:
        if not isinstance(page, list) or any(not isinstance(item, dict) for item in page):
            raise CollectionError(f'API malformed page: {endpoint}')
        records.extend(page)
    return records


def digest(record):
    content = {key: value for key, value in record.items() if key != 'receiptSha256'}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate_comment(item, name, number, *, projected=False):
    # Require the reader's text projection, not the entire GitHub object. The
    # pinned schema and stricter issue-body policy are recorded in the correction.
    if 'body' not in item or not isinstance(item['body'], str):
        raise CollectionError(f'API malformed comment body: {number}/{name}')
    if 'user' not in item:
        raise CollectionError(f'API malformed comment author: {number}/{name}')
    author = item['user']
    invalid_author = (not isinstance(author, str) if projected else
                      not isinstance(author, dict) or not isinstance(author.get('login'), str))
    if author is not None and invalid_author:
        raise CollectionError(f'API malformed comment author: {number}/{name}')
    field = COMMENT_FIELDS[name]
    if field not in item or not isinstance(item[field], str):
        raise CollectionError(f'API malformed comment {field}: {number}/{name}')


def validate_file(item, number):
    # Both actual readers index these fields; digest also negates additions.
    if not isinstance(item.get('filename'), str) or not item['filename']:
        raise CollectionError(f'API malformed file name: {number}')
    if 'status' not in item or not isinstance(item['status'], str):
        raise CollectionError(f'API malformed file status: {number}')
    for field in ('additions', 'deletions'):
        if type(item.get(field)) is not int:
            raise CollectionError(f'API malformed file {field}: {number}')


def validate_pr_projection(pr, number):
    # Check the reader-consumed PR projection, not unrelated upstream fields.
    if (not isinstance(pr, dict) or not isinstance(pr.get('title'), str)
            or pr.get('state') not in ('open', 'closed')):
        raise CollectionError(f'API malformed PR projection identity: {number}')
    for field in ('additions', 'deletions', 'changed_files'):
        if type(pr.get(field)) is not int:
            raise CollectionError(f'API malformed PR {field}: {number}')
    if pr['changed_files'] < 0:
        raise CollectionError(f'API malformed PR changed_files: {number}')
    if 'merge_commit_sha' not in pr or (pr['merge_commit_sha'] is not None
                                       and not isinstance(pr['merge_commit_sha'], str)):
        raise CollectionError(f'API malformed PR merge_commit_sha: {number}')


def valid_cache(record, number):
    if (not isinstance(record, dict) or record.get('schema') != SCHEMA
            or type(record.get('number')) is not int or record.get('number') != number):
        return False
    collection = record.get('collection')
    if (not isinstance(collection, dict) or collection.get('complete') is not True
            or collection.get('commentRowPolicy') != COMMENT_ROW_POLICY
            or collection.get('consumedProjectionPolicy') != CONSUMED_PROJECTION_POLICY):
        return False
    counts = collection.get('endpointCounts')
    if not isinstance(counts, dict):
        return False
    for name in LISTS:
        rows = record.get(name)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            return False
        if type(counts.get(name)) is not int or counts[name] != len(rows):
            return False
    try:
        validate_pr_projection(record.get('pr'), number)
        for row in record['files']:
            validate_file(row, number)
        for name in LISTS[1:]:
            for row in record[name]:
                validate_comment(row, name, number, projected=True)
    except CollectionError:
        return False
    pr = record.get('pr')
    return (isinstance(pr, dict) and isinstance(pr.get('title'), str)
            and pr.get('state') in ('open', 'closed')
            and record.get('receiptSha256') == digest(record))


def collect(number):
    root = 'repos/pingdotgg/t3code'
    pr = api(f'{root}/pulls/{number}')
    if (type(pr.get('number')) is not int or pr['number'] != number
            or not isinstance(pr.get('title'), str) or pr.get('state') not in ('open', 'closed')
            or type(pr.get('changed_files')) is not int or pr['changed_files'] < 0):
        raise CollectionError(f'API malformed PR identity: {number}')
    endpoints = {
        'files': f'{root}/pulls/{number}/files?per_page=100',
        'issueComments': f'{root}/issues/{number}/comments?per_page=100',
        'reviewComments': f'{root}/pulls/{number}/comments?per_page=100',
        'reviews': f'{root}/pulls/{number}/reviews?per_page=100',
    }
    lists = {name: api(endpoint, paginated=True) for name, endpoint in endpoints.items()}
    validate_pr_projection(pr, number)
    for item in lists['files']:
        validate_file(item, number)
    for name in LISTS[1:]:
        for item in lists[name]:
            validate_comment(item, name, number)
    fields = ('title', 'state', 'merged_at', 'merge_commit_sha', 'additions', 'deletions',
              'changed_files', 'commits', 'created_at', 'closed_at', 'user', 'base', 'head')
    record = {'schema': SCHEMA, 'number': number, 'pr': {key: pr.get(key) for key in fields}}
    if isinstance(record['pr']['user'], dict):
        record['pr']['user'] = record['pr']['user'].get('login')
    for name in ('base', 'head'):
        if isinstance(record['pr'][name], dict):
            record['pr'][name] = record['pr'][name].get('sha')
    record['files'] = [{key: item.get(key) for key in ('filename', 'status', 'additions', 'deletions')}
                       for item in lists['files']]
    for name, extra, limit in [('issueComments', ('created_at',), 4000),
                               ('reviewComments', ('path',), 2500), ('reviews', ('state',), 2500)]:
        record[name] = [{'user': (item.get('user') or {}).get('login'),
                         'body': (item.get('body') or '')[:limit],
                         **{key: item.get(key) for key in extra}} for item in lists[name]]
    record['collection'] = {'complete': True, 'commentRowPolicy': COMMENT_ROW_POLICY,
                            'consumedProjectionPolicy': CONSUMED_PROJECTION_POLICY,
                            'fetchedAt': datetime.now(timezone.utc).isoformat(),
                            'endpointCounts': {name: len(rows) for name, rows in lists.items()},
                            'fileCountMatchesDeclared': len(lists['files']) == pr['changed_files']}
    record['receiptSha256'] = digest(record)
    return record


def publish(path, record):
    # Publish only after every endpoint succeeds. A failed refresh leaves the
    # historical cache untouched at the path downstream readers consume.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.pr-details-',
                                         suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(record, stream, indent=1, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(root):
    destination = root/'pr-details'
    destination.mkdir(exist_ok=True)
    selected = [line.split('\t')[0] for line in
                (root/'evidence/deep-review-selection.tsv').read_text().splitlines()[1:] if line]
    if any(not re.fullmatch(r'[1-9][0-9]*', value) for value in selected) or len(set(selected)) != len(selected):
        raise CollectionError('Selection must contain unique positive PR numbers')
    for value in selected:
        number = int(value)
        path = destination/f'{number}.json'
        if path.exists():
            try:
                cached = json.loads(path.read_text())
            except json.JSONDecodeError:
                cached = None
            if valid_cache(cached, number):
                continue
        record = collect(number)
        publish(path, record)
        print(number, record['pr']['changed_files'], len(record['issueComments']),
              len(record['reviewComments']), flush=True)


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]))
    except CollectionError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
