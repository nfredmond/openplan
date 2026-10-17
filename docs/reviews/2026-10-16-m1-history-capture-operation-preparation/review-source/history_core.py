"""Byte comparisons only. Production oracle approval is absent in this packet."""
import hashlib
import json

TOC_SHA256 = '802b17ac728118d4245b5aa61ca6ccf92045157a12a508f0eb46e8be08e0d9a1'
SELECTION = (b'645; 1259 6078981 TABLE supabase_migrations schema_migrations postgres\n'
             b'13880; 0 6078981 TABLE DATA supabase_migrations schema_migrations postgres\n')
SELECTION_SHA256 = '1d734465ad89f4d6cbdac4392bef29d748ae2e2e71c004440496869a131c52ab'
HERE_LITERAL = '/home/nathaniel/.local/state/openplan/land-use-context-native-preparation-20261016/history-consumer-source-preparation-r1'
FIXED_ARGV = ('/lib64/ld-linux-x86-64.so.2', '--inhibit-cache', '--library-path',
              '/home/nathaniel/.local/state/openplan/land-use-context-native-preparation-20261016/artifact-request-r1/libraries',
              '/home/nathaniel/.local/state/openplan/m1-artifact-tool-acquisition-20261016/trial02/pg_restore',
              '--use-list=' + HERE_LITERAL + '/reviewed-history.list', '--file=-',
              '--restrict-key=OpenPlanM1HistoryInspection20261016',
              '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump')
KEY = b'OpenPlanM1HistoryInspection20261016'
MAX_RAW = 67108864
TEMPLATE_LIMIT = 16384
FRAME_KEYS = ('prelude', 'tableOwner', 'bridge', 'copyHeader', 'suffix')
# No ROOT receipt/hash exists. No setter, environment input or tag can supply it.
PRODUCTION_ORACLE_APPROVAL = None


class HistoryRefusal(RuntimeError):
    pass


class HistoryUnassessed(RuntimeError):
    pass


def require(value, message):
    if not value:
        raise HistoryRefusal(message)


def validate_selection(payload, saved_toc):
    valid = (type(payload) is bytes and type(saved_toc) is bytes
             and len(saved_toc) == 706854 and hashlib.sha256(saved_toc).hexdigest() == TOC_SHA256
             and payload == SELECTION and len(payload) == 146
             and hashlib.sha256(payload).hexdigest() == SELECTION_SHA256)
    if valid:
        lines = saved_toc.splitlines()
        wanted = SELECTION.splitlines()
        found = [line for line in lines if line.startswith((b'645;', b'13880;'))]
        valid = found == wanted and lines[3314] == wanted[0] and lines[3698] == wanted[1]
    require(valid, 'history-selection-contract')
    return {'selection': 'ELIGIBLE', 'bytes': len(payload)}


def validate_argv(argv):
    valid = type(argv) in (tuple, list) and tuple(argv) == FIXED_ARGV
    require(valid, 'history-argv-contract')
    return {'argv': 'ELIGIBLE', 'dispatch': False}


def _eligible(fixture, body_bytes=None):
    return {'authority': 'SUPPLIED_FIXTURE_ONLY' if fixture else 'REVIEWED_CAPTURE_ORACLE',
            'accepted': not fixture, 'envelope': 'SUPPLIED_ELIGIBLE' if fixture else 'ELIGIBLE',
            'history': 'UNASSESSED', 'bodyBytes': body_bytes, 'bodyDecoded': False}


def _oracle_contract(oracle, blob, fixture):
    if type(oracle) is not dict or type(blob) is not bytes or len(blob) > 65536:
        return False
    if set(oracle) != {'authority', 'reviewReceiptSHA256', 'scope', 'columnShape', 'frameLiterals', 'searchPathHex'}:
        return False
    columns = oracle['columnShape']
    frames = oracle['frameLiterals']
    if (type(columns) is not list or not 1 <= len(columns) <= 64
            or not all(type(x) is str and 0 < len(x) <= 256 for x in columns)
            or type(frames) is not dict or set(frames) != set(FRAME_KEYS)):
        return False
    if not all(type(x) is str and 0 < len(x) <= TEMPLATE_LIMIT * 2 for x in frames.values()):
        return False
    try:
        decoded = {k: bytes.fromhex(v) for k, v in frames.items()}
        search = bytes.fromhex(oracle['searchPathHex'])
    except (ValueError, TypeError):
        return False
    if not all(0 < len(x) <= TEMPLATE_LIMIT for x in decoded.values()) or not 0 < len(search) <= 1024:
        return False
    if (b"SET client_encoding = 'UTF8';\n" not in decoded['prelude']
            or b'SET standard_conforming_strings = on;\n' not in decoded['prelude']
            or search not in decoded['prelude'] or b'\\restrict ' + KEY + b'\n' not in decoded['prelude']
            or b'\\unrestrict ' + KEY + b'\n' not in decoded['suffix']):
        return False
    if fixture:
        return (oracle['authority'] == 'SUPPLIED_FIXTURE_ONLY'
                and oracle['scope'] == 'SUPPLIED_FIXTURE_ONLY' and oracle['reviewReceiptSHA256'] is None)
    # Future activation needs a separately reviewed SOURCE change, not JSON authority.
    approval = PRODUCTION_ORACLE_APPROVAL
    return (approval is not None and oracle['authority'] == 'REVIEWED_CAPTURE_ORACLE'
            and hashlib.sha256(blob).hexdigest() == approval['oracleSHA256']
            and oracle['reviewReceiptSHA256'] == approval['rootReviewReceiptSHA256']
            and oracle['scope'] == approval['scope'])


def _ending(stream, start, suffix, total):
    """Find framing only, without interpreting opaque COPY bytes."""
    marker = b'\\.\n\n\n'
    if not 0 <= start <= total <= MAX_RAW:
        return False, None
    stream.seek(start)
    carry = b''
    position = start
    while position < total:
        block = stream.read(min(65536, total - position))
        if not block:
            return False, None
        window = carry + block
        origin = position - len(carry)
        offset = 0
        while True:
            found = window.find(marker, offset)
            if found < 0:
                break
            absolute = origin + found
            if absolute >= start and (absolute == start or (found > 0 and window[found - 1:found] == b'\n')):
                stream.seek(absolute + len(marker))
                ending = stream.read(len(suffix) + 1)
                return ending == suffix and absolute + len(marker) + len(suffix) == total, absolute - start
            offset = found + 1
        carry = window[-6:]
        position += len(block)
    return False, None


def _assess(stream, oracle_bytes, fixture):
    oracle = None
    if oracle_bytes is not None:
        try:
            if type(oracle_bytes) is not bytes or len(oracle_bytes) > 65536:
                raise ValueError('oracle encoding/size')
            oracle = json.loads(oracle_bytes)
        except (ValueError, UnicodeError, TypeError) as error:
            raise HistoryRefusal('history-oracle-contract') from error
    missing = oracle is None or (type(oracle) is dict and
              (not oracle.get('columnShape') or not oracle.get('frameLiterals')))
    if missing:  # M1 oracle-presence fence, before any stream access.
        raise HistoryUnassessed('history-oracle-absent')
    valid = _oracle_contract(oracle, oracle_bytes, fixture)
    require(valid, 'history-oracle-contract')
    frames = {k: bytes.fromhex(oracle['frameLiterals'][k]) for k in FRAME_KEYS}
    stream.seek(0, 2)
    total = stream.tell()
    stream.seek(0)
    actual = {k: stream.read(len(frames[k])) for k in FRAME_KEYS[:-1]}
    start = sum(len(frames[k]) for k in FRAME_KEYS[:-1])
    valid, body_bytes = _ending(stream, start, frames['suffix'], total)
    require(valid, 'history-completion-contract')
    valid = actual['prelude'] == frames['prelude'] and actual['bridge'] == frames['bridge']
    require(valid, 'history-frame-contract')
    valid = actual['tableOwner'] == frames['tableOwner']
    require(valid, 'history-table-owner-contract')
    valid = actual['copyHeader'] == frames['copyHeader']
    require(valid, 'history-copy-header-contract')
    return _eligible(fixture, body_bytes)


def assess_production(stream, oracle_bytes):
    return _assess(stream, oracle_bytes, False)


def assess_fixture(stream, oracle_bytes):
    return _assess(stream, oracle_bytes, True)
