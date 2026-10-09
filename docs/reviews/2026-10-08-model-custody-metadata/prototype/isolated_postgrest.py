"""Own a bounded PostgREST container exposing only a disposable proof schema."""
from contextlib import contextmanager
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import time
import uuid
import requests
from urllib.parse import urlsplit, urlunsplit
from verify_journal_recovery import CONTAINER


def encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def token(secret, role, subject=None):
    header = encoded(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    claims = {'role': role, 'exp': int(time.time()) + 300}
    if subject is not None:
        claims['sub'] = str(uuid.UUID(subject))
    payload = encoded(json.dumps(claims).encode())
    message = header + '.' + payload
    return message + '.' + encoded(hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest())


@contextmanager
def gateway(schema, *, database=None, subjects=()):
    if database is not None and not re.fullmatch(r'openplan_(?:attempt_(?:upgrade|cli)|assessment_upgrade)_[0-9a-f]{32}', database):
        raise ValueError('Only owned attempt proof databases may be exposed')
    if not (schema == 'public' and database is not None) and not re.fullmatch('http_recovery_[0-9a-f]{32}', schema):
        raise ValueError('Only owned HTTP proof schemas may be exposed')
    rest = CONTAINER.replace('supabase_db_', 'supabase_rest_', 1)
    source = json.loads(subprocess.check_output(['docker', 'inspect', rest], text=True))[0]
    networks = list(source['NetworkSettings']['Networks'])
    if len(networks) != 1:
        raise ValueError('Restore-target REST network is ambiguous')
    source_env = dict(item.split('=', 1) for item in source['Config']['Env'] if '=' in item)
    secret = secrets.token_urlsafe(48)
    settings = {'PGRST_DB_URI': source_env['PGRST_DB_URI'], 'PGRST_DB_SCHEMAS': schema,
                'PGRST_DB_CONFIG': 'false', 'PGRST_DB_EXTRA_SEARCH_PATH': '',
                'PGRST_DB_POOL': '1', 'PGRST_DB_ANON_ROLE': 'anon',
                'PGRST_JWT_SECRET': secret, 'PGRST_SERVER_PORT': '3000', 'PGRST_LOG_LEVEL': 'crit'}
    if database is not None:
        uri = urlsplit(settings['PGRST_DB_URI'])
        settings['PGRST_DB_URI'] = urlunsplit(uri._replace(path='/' + database))
    name = 'openplan-postgrest-proof-' + uuid.uuid4().hex
    command = ['docker', 'run', '--detach', '--rm', '--name', name, '--network', networks[0],
               '--publish', '127.0.0.1::3000', '--memory', '128m', '--memory-swap', '128m', '--pids-limit', '128', '--cpus', '0.5']
    for key in settings:
        command.extend(['--env', key])
    # Values travel in the child environment, not command arguments or output.
    command.append(source['Config']['Image'])
    try:
        subprocess.run(command, env={**os.environ, **settings}, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
        state = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
        binding = state['NetworkSettings']['Ports']['3000/tcp'][0]
        if binding['HostIp'] != '127.0.0.1':
            raise RuntimeError('Proof gateway was not bound to loopback')
        url = 'http://127.0.0.1:' + binding['HostPort']
        service_token = token(secret, 'service_role')
        ready = False
        for _ in range(60):
            try:
                with requests.get(url, headers={'Authorization': 'Bearer ' + service_token}, timeout=1) as response:
                    ready = response.status_code == 200
            except requests.RequestException:
                pass
            if ready:
                break
            time.sleep(0.1)
        if not ready:
            raise RuntimeError('Owned PostgREST did not become ready')
        yield {'url': url, 'service_token': service_token, 'anon_token': token(secret, 'anon'), 'image': source['Config']['Image'], 'authenticated_tokens': {subject: token(secret, 'authenticated', subject) for subject in subjects}}
    finally:
        subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        remaining = subprocess.check_output(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$'], text=True).strip()
        if remaining:
            raise RuntimeError('Owned PostgREST container survived cleanup')
