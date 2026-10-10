"""Retained TUS uploads with immutable destinations and bounded byte verification.

The caller owns source and state directories and establishes publication authority.
This module never changes an object name or enables replacement after uncertainty.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import unquote, urljoin, urlsplit
import uuid

import requests
from model_storage_readback import object_url, verify_object, ObjectReadbackUnconfirmed

CHUNK_BYTES = 6 * 1024 * 1024


class UploadUnconfirmed(RuntimeError):
    pass


def _save(directory, state):
    name = '.upload-' + uuid.uuid4().hex
    descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    with os.fdopen(descriptor, 'w') as writer:
        json.dump(state, writer, sort_keys=True, separators=(',', ':'))
        writer.flush()
        os.fsync(writer.fileno())
    os.replace(name, 'upload.json', src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)


def _location(endpoint, value):
    if not isinstance(value, str) or not value:
        raise UploadUnconfirmed('Upload URL missing')
    location = urljoin(endpoint + '/', value)
    actual, expected = urlsplit(location), urlsplit(endpoint)
    if ((actual.scheme, actual.netloc) != (expected.scheme, expected.netloc)
            or actual.username or actual.password or actual.query or actual.fragment
            or not actual.path.startswith(expected.path + '/')
            or any(part in ('.', '..') for part in unquote(actual.path).split('/'))):
        raise UploadUnconfirmed('Upload URL leaves configured endpoint')
    return location


def _number(headers, key):
    value = headers.get(key, '')
    if not isinstance(value, str) or not re.fullmatch('[0-9]+', value):
        raise UploadUnconfirmed('Upload offset or length missing')
    return int(value)


def _response(response, statuses):
    if response.status_code not in statuses or response.headers.get('Tus-Resumable') != '1.0.0':
        raise UploadUnconfirmed('Upload protocol response unconfirmed')


def upload_file(*, source, state_dir, base_url, service_key, bucket, object_path,
                sha256, size_bytes, content_type='application/octet-stream', request=None):
    """Resume one retained object; success requires a complete remote byte readback.

    Unknown PATCH outcomes stop this call. A later call checks HEAD before sending
    more bytes. Creation sends no source data; a lost creation reply may leave an
    empty server session, which a later call replaces with a new empty session.
    Expired known sessions remain explicit failures, never silent restarts.
    """
    object_url(base_url, bucket, object_path)
    if not isinstance(sha256, str) or not re.fullmatch('[0-9a-f]{64}', sha256) or type(size_bytes) is not int or size_bytes < 0:
        raise ValueError('Exact expected source hash and size required')
    if not isinstance(service_key, str) or not service_key or not isinstance(content_type, str) or not content_type:
        raise ValueError('Upload credential and content type required')
    endpoint = base_url.rstrip('/') + '/storage/v1/upload/resumable'
    intent = {'base_url': base_url.rstrip('/'), 'bucket': bucket, 'object_path': object_path,
              'sha256': sha256, 'size_bytes': size_bytes, 'content_type': content_type}
    state_dir = Path(state_dir)
    state_dir.mkdir(mode=0o700, exist_ok=True)
    directory = os.open(state_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock = source_fd = None
    request = request or requests.request
    try:
        lock = os.open('upload.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            state_fd = os.open('upload.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        except FileNotFoundError:
            state = {'schema':'openplan.source-upload.v1', 'intent':intent, 'upload_url':None, 'offset':0, 'status':'prepared'}
            _save(directory, state)
        else:
            with os.fdopen(state_fd) as reader: state = json.load(reader)
            if state.get('schema') != 'openplan.source-upload.v1' or state.get('intent') != intent:
                raise UploadUnconfirmed('Retained upload identity differs')
            if type(state.get('offset')) is not int or not 0 <= state['offset'] <= size_bytes or state.get('status') not in ('prepared','uploading','verified'):
                raise UploadUnconfirmed('Retained upload progress invalid')
        source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(source_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size != size_bytes:
            raise UploadUnconfirmed('Source must be a private file of expected size')
        digest, read_size = hashlib.sha256(), 0
        while chunk := os.read(source_fd, min(1024 * 1024, size_bytes - read_size + 1)):
            read_size += len(chunk)
            if read_size > size_bytes: raise UploadUnconfirmed('Source grew during verification')
            digest.update(chunk)
        if digest.hexdigest() != sha256:
            raise UploadUnconfirmed('Source hash differs')
        def unchanged():
            after = os.fstat(source_fd)
            if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns,before.st_nlink) != (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns,after.st_nlink):
                raise UploadUnconfirmed('Source changed during upload')
        unchanged()
        def verified():
            return verify_object(base_url=base_url, service_key=service_key, bucket=bucket, object_path=object_path,
                sha256=sha256, size_bytes=size_bytes, get=lambda url, **kwargs: request('GET', url, **kwargs))
        headers = {'apikey':service_key, 'Authorization':'Bearer '+service_key, 'Tus-Resumable':'1.0.0', 'x-upsert':'false'}
        def send(method, url, extra=None, data=None):
            return request(method, url, headers={**headers, **(extra or {})}, data=data,
                           timeout=(15,60), allow_redirects=False, stream=True)
        if not verified():
            if state['status'] == 'verified':
                raise UploadUnconfirmed('Previously verified object is missing')
            if state['upload_url'] is None:
                metadata = {'bucketName':bucket, 'objectName':object_path, 'contentType':content_type}
                encoded = ','.join(key+' '+base64.b64encode(value.encode()).decode() for key,value in metadata.items())
                with send('POST', endpoint, {'Upload-Length':str(size_bytes), 'Upload-Metadata':encoded}, b'') as response:
                    _response(response, (201,))
                    state['upload_url'] = _location(endpoint, response.headers.get('Location'))
                    state['status'] = 'uploading'
                    _save(directory, state)
            location = _location(endpoint, state['upload_url'])
            with send('HEAD', location) as response:
                _response(response, (200,204))
                offset = _number(response.headers, 'Upload-Offset')
                if _number(response.headers, 'Upload-Length') != size_bytes or not state['offset'] <= offset <= size_bytes:
                    raise UploadUnconfirmed('Server upload offset or length differs')
            state['offset'] = offset
            _save(directory, state)
            while offset < size_bytes:
                os.lseek(source_fd, offset, os.SEEK_SET)
                chunk = os.read(source_fd, min(CHUNK_BYTES, size_bytes-offset))
                unchanged()
                if not chunk: raise UploadUnconfirmed('Source ended before upload completed')
                with send('PATCH', location, {'Upload-Offset':str(offset), 'Content-Type':'application/offset+octet-stream'}, chunk) as response:
                    _response(response, (204,))
                    if _number(response.headers, 'Upload-Offset') != offset + len(chunk):
                        raise UploadUnconfirmed('Server did not acknowledge exact uploaded bytes')
                offset += len(chunk)
                state['offset'] = offset
                _save(directory, state)
            if not verified(): raise UploadUnconfirmed('Completed upload object is missing')
        unchanged()
        state.update(status='verified', offset=size_bytes)
        _save(directory, state)
        return 'storage://' + bucket + '/' + object_path
    except (requests.RequestException, ObjectReadbackUnconfirmed) as error:
        raise UploadUnconfirmed('Upload requires reconciliation') from error
    finally:
        if source_fd is not None: os.close(source_fd)
        if lock is not None: os.close(lock)
        os.close(directory)
