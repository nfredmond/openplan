"""Make the supported fresh OSM producer deterministic before persistence.

This hook owns only newly generated native mode-membership strings. Imported
networks, retained sources and graph/receipt identity readers stay byte-exact.
Importing this module does not import the optional assignment engine.
"""
from functools import wraps
import hashlib
import importlib
import importlib.metadata
from pathlib import Path
import string
import sys
from types import CodeType, FunctionType


ENGINE_VERSION = '1.6.2'
BUILDER_MODULE = 'aequilibrae.project.network.osm.osm_builder'
BUILDER_SHA256 = '2d68ed654a0a53b75aa89b6c016c5095505f3771071493a78cf0972f181ff8ad'
METHOD = '_OSMBuilder__establish_modes_for_all_links'
_installed: dict[type, tuple[FunctionType, FunctionType]] = {}


def _supported_module():
    """Refuse other producer bytes before installing or using the private hook."""
    try:
        version = importlib.metadata.version('aequilibrae')
    except importlib.metadata.PackageNotFoundError as exc:
        raise ValueError('Fresh OSM mode producer requires the supported engine') from exc
    if version != ENGINE_VERSION:
        raise ValueError('Fresh OSM mode producer unsupported engine version')
    module = importlib.import_module(BUILDER_MODULE)
    path = Path(module.__file__)
    source = path.read_bytes()
    if hashlib.sha256(source).hexdigest() != BUILDER_SHA256:
        raise ValueError('Fresh OSM mode producer unsupported builder source')
    return module, path, source


def _native_method(module, path: Path, source: bytes, method) -> None:
    """Bind the callable as well as its file, refusing earlier method patches."""
    # Compilation inspects the pinned source without executing another module.
    # It also catches a replacement that copies the native function's name.
    compiled = compile(source, str(path), 'exec', dont_inherit=True, optimize=sys.flags.optimize)
    classes = [item for item in compiled.co_consts if isinstance(item, CodeType) and item.co_name == 'OSMBuilder']
    methods = ([item for item in classes[0].co_consts
                if isinstance(item, CodeType) and item.co_name == '__establish_modes_for_all_links']
               if len(classes) == 1 else [])
    if (len(methods) != 1 or not isinstance(method, FunctionType)
            or method.__code__ != methods[0] or method.__globals__ is not module.__dict__
            or method.__module__ != BUILDER_MODULE or method.__defaults__ is not None
            or method.__kwdefaults__ is not None or method.__closure__ is not None
            or hasattr(method, '__wrapped__')):
        raise ValueError('Fresh OSM mode producer unexpected native method replacement')


def _registered_modes(connection) -> frozenset[str]:
    rows = connection.execute('SELECT mode_id FROM modes ORDER BY mode_id').fetchall()
    codes = [row[0] for row in rows]
    if (not codes or any(not isinstance(code, str) or len(code) != 1
                         or code not in string.ascii_letters for code in codes)
            or len(set(codes)) != len(codes)):
        raise ValueError('Fresh OSM mode producer requires unique registered single-letter ASCII IDs')
    return frozenset(codes)


def _ordered_modes(value, registered: frozenset[str]) -> str:
    """Order valid emitted membership, without dropping or inventing a code."""
    if (not isinstance(value, str) or not value or len(set(value)) != len(value)
            or any(code not in registered for code in value)):
        raise ValueError('Fresh OSM mode producer emitted invalid or unregistered membership')
    return ''.join(sorted(value))


def install() -> None:
    """Install once on the supported native producer, only on fresh OSM paths."""
    module, path, source = _supported_module()
    builder = module.OSMBuilder
    current = builder.__dict__.get(METHOD)
    if builder in _installed:
        original, wrapper = _installed[builder]
        if current is not wrapper:
            raise ValueError('Fresh OSM mode producer installed method was replaced')
        _native_method(module, path, source, original)
        return
    _native_method(module, path, source, current)
    original = current

    @wraps(original)
    def deterministic_modes(self, connection, frame):
        checked, checked_path, checked_source = _supported_module()
        if (checked.OSMBuilder is not builder or type(self) is not builder
                or builder.__dict__.get(METHOD) is not deterministic_modes):
            raise ValueError('Fresh OSM mode producer builder or installed method changed')
        _native_method(checked, checked_path, checked_source, original)
        registered = _registered_modes(connection)
        generated = original(self, connection, frame)
        if list(generated.columns).count('modes') != 1:
            raise ValueError('Fresh OSM mode producer emitted no unique modes column')
        # Native generation legitimately deduplicates overlapping parameter
        # membership. Validate its emitted strings, not those repeated inputs.
        result = generated.copy()
        result['modes'] = generated['modes'].map(lambda value: _ordered_modes(value, registered))
        return result

    _installed[builder] = (original, deterministic_modes)
    setattr(builder, METHOD, deterministic_modes)
