"""Bounded verification of exact stored object bytes, shared by upload recovery."""
import hashlib
import json
import re
from urllib.parse import quote, urlsplit

import requests
from urllib3.exceptions import HTTPError as RawHTTPError

CHUNK_BYTES = 1024 * 1024


class ObjectReadbackUnconfirmed(RuntimeError):
    pass


def object_url(base_url, bucket, object_path):
    """Use an explicit configured server and encode each object path component."""
    parsed = urlsplit(base_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Explicit Storage server URL required')
    if not isinstance(bucket, str) or not re.fullmatch('[A-Za-z0-9_-]+', bucket):
        raise ValueError('Invalid Storage bucket')
    if not isinstance(object_path, str) or any(part in ('', '.', '..') for part in object_path.split('/')) or '\\' in object_path or '\x00' in object_path:
        raise ValueError('Invalid Storage object path')
    return base_url.rstrip('/') + '/storage/v1/object/authenticated/' + bucket + '/' + quote(object_path, safe='/')


def verify_object(*, base_url, service_key, bucket, object_path, sha256, size_bytes, get=None):
    """Return true for a verified object or false for HTTP 404; refuse uncertainty.

    A missing object can be uploaded by a separately authorized publisher. A
    refused read must not be interpreted as absence or permission to overwrite.
    This checks stored bytes only, not publication authority or scientific value.
    """
    if not isinstance(sha256, str) or not re.fullmatch('[0-9a-f]{64}', sha256):
        raise ValueError('Expected object hash required')
    if type(size_bytes) is not int or size_bytes < 0:
        raise ValueError('Expected object size required')
    if not isinstance(service_key, str) or not service_key:
        raise ValueError('Storage credential required')
    url = object_url(base_url, bucket, object_path)
    try:
        with (get or requests.get)(url, headers={'apikey': service_key, 'Authorization': 'Bearer ' + service_key,
                                                'Accept-Encoding': 'identity'},
                                   timeout=(15, 60), allow_redirects=False, stream=True) as response:
            if response.status_code == 404:
                return False
            if response.status_code == 400:
                # Native Storage retains this older HTTP envelope for NoSuchKey.
                if (response.headers.get('Content-Encoding', 'identity').lower() == 'identity'
                        and response.headers.get('Content-Type', '').split(';')[0].strip().lower() == 'application/json'):
                    body = response.raw.read(4097, decode_content=False)
                    if len(body) <= 4096:
                        try:
                            error = json.loads(body)
                        except (ValueError, UnicodeError):
                            error = None
                        if isinstance(error, dict) and error.get('code') == 'NoSuchKey' and str(error.get('statusCode')) == '404':
                            return False
            if response.status_code != 200:
                raise ObjectReadbackUnconfirmed('Object read status unconfirmed')
            if response.headers.get('Content-Encoding', 'identity').lower() != 'identity':
                raise ObjectReadbackUnconfirmed('Encoded object response refused')
            length = response.headers.get('Content-Length')
            if length is not None and (not re.fullmatch('[0-9]+', length) or int(length) != size_bytes):
                raise ObjectReadbackUnconfirmed('Object response length differs')
            digest, received = hashlib.sha256(), 0
            while chunk := response.raw.read(min(CHUNK_BYTES, size_bytes - received + 1), decode_content=False):
                received += len(chunk)
                if received > size_bytes:
                    raise ObjectReadbackUnconfirmed('Object response exceeds expected size')
                digest.update(chunk)
            if received != size_bytes or digest.hexdigest() != sha256:
                raise ObjectReadbackUnconfirmed('Object response bytes differ')
            return True
    except ObjectReadbackUnconfirmed:
        raise
    except (requests.RequestException, RawHTTPError, OSError, ValueError) as error:
        raise ObjectReadbackUnconfirmed('Object read interrupted') from error
