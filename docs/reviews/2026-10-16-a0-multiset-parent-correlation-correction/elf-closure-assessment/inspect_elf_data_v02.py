"""Read fixed ELF files as binary data. Never execute loaders, tools or subjects."""
import hashlib
import json
import os
from pathlib import Path
import stat
import struct

PUBLIC = Path(__file__).resolve().parent
PRIVATE = Path('/home/nathaniel/.local/state/openplan/a0-multiset-parent-correlation-correction-20261016/elf-closure-assessment/parse02')
MANIFEST = PRIVATE.parent.parent / 'runner-preparation/runtime-manifest.json'
DEFAULTS = ('/usr/lib/x86_64-linux-gnu', '/usr/lib')
MAX_BYTES = 134217728


def demand(value, reason):
    if not value:
        raise ValueError(reason)


def blob(path):
    info = path.lstat()
    demand(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_BYTES, 'regular-file-bound:' + str(path))
    data = path.read_bytes()
    after = path.lstat()
    demand((info.st_size, info.st_mtime_ns, info.st_ino, info.st_dev) ==
           (after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev) and len(data) == info.st_size,
           'file-drift:' + str(path))
    pin = dict(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data),
               mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
    return data, pin


def once(name, value):
    path = PRIVATE / name
    data = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    directory = os.open(PRIVATE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def elf(path):
    data, pin = blob(path)
    demand(data[:4] == b'\x7fELF', 'not-elf:' + str(path))
    demand(len(data) >= 64 and data[4:7] == b'\x02\x01\x01', 'unsupported-elf-class-data-version')
    head = struct.unpack_from('<16sHHIQQQIHHHHHH', data)
    _, kind, machine, version, _, phoff, shoff, flags, size, phsize, phnum, shsize, shnum, _ = head
    demand(machine == 62 and version == 1 and kind in (2, 3) and size == 64,
           'unsupported-elf-machine-kind-header')
    demand(phsize == 56 and 0 < phnum < 1024 and phoff + phnum * phsize <= len(data), 'program-header-bound')
    ph = [struct.unpack_from('<IIQQQQQQ', data, phoff + i * phsize) for i in range(phnum)]
    demand(all(p[2] + p[5] <= len(data) for p in ph), 'segment-file-bound')
    loads = [p for p in ph if p[0] == 1]

    def at(address, length):
        offsets = {p[2] + address - p[3] for p in loads if p[3] <= address and address + length <= p[3] + p[5]}
        demand(len(offsets) == 1, 'ambiguous-or-unmapped-virtual-range')
        return offsets.pop()

    def unpack(fmt, offset):
        demand(0 <= offset and offset + struct.calcsize(fmt) <= len(data), 'binary-record-bound')
        return struct.unpack_from(fmt, data, offset)

    interps = [p for p in ph if p[0] == 3]
    demand(len(interps) <= 1, 'multiple-interpreters')
    interpreter = None
    if interps:
        p = interps[0]
        text = data[p[2]:p[2] + p[5]]
        demand(text.endswith(b'\0') and b'\0' not in text[:-1], 'interpreter-string-shape')
        interpreter = text[:-1].decode('ascii')
    dynamic = [p for p in ph if p[0] == 2]
    demand(len(dynamic) == 1, 'dynamic-segment-count')
    p = dynamic[0]
    demand(p[5] % 16 == 0 and p[5] // 16 <= 4096, 'dynamic-entry-bound')
    tags = {}
    ended = False
    for offset in range(p[2], p[2] + p[5], 16):
        tag, value = unpack('<qQ', offset)
        if tag == 0:
            ended = True
            break
        tags.setdefault(tag, []).append(value)
    demand(ended, 'missing-dynamic-null')

    def one(tag, default=None):
        rows = tags.get(tag, [])
        demand(len(rows) <= 1, 'duplicate-singleton-dynamic-tag')
        return rows[0] if rows else default

    straddr, strsize = one(5), one(10)
    demand(straddr is not None and type(strsize) is int and 0 < strsize <= 16777216, 'dynamic-string-table-bound')
    stroff = at(straddr, strsize)

    def string(offset):
        demand(0 <= offset < strsize, 'string-offset-bound')
        end = data.find(b'\0', stroff + offset, stroff + strsize)
        demand(end != -1, 'string-terminator-bound')
        return data[stroff + offset:end].decode('ascii')

    needed = [string(x) for x in tags.get(1, [])]
    demand(len(needed) <= 128 and len(set(needed)) == len(needed), 'needed-count-or-duplicate')
    requirements = []
    verneed, verneednum = one(0x6ffffffe), one(0x6fffffff, 0)
    demand((verneed is None) == (verneednum == 0) and verneednum <= 256, 'verneed-shape-bound')
    if verneed is not None:
        current = verneed
        for index in range(verneednum):
            version, count, file_offset, aux, next_offset = unpack('<HHIII', at(current, 16))
            demand(version == 1 and 0 < count <= 256, 'verneed-header')
            auxiliary = current + aux
            names = []
            for j in range(count):
                vhash, vflags, other, name, following = unpack('<IHHII', at(auxiliary, 16))
                names.append(dict(name=string(name), flags=vflags, index=other & 0x7fff, elfHash=vhash))
                demand((following == 0) == (j == count - 1), 'vernaux-chain')
                auxiliary += following
            requirements.append(dict(file=string(file_offset), versions=names))
            demand((next_offset == 0) == (index == verneednum - 1), 'verneed-chain')
            current += next_offset
    definitions = []
    verdef, verdefnum = one(0x6ffffffc), one(0x6ffffffd, 0)
    demand((verdef is None) == (verdefnum == 0) and verdefnum <= 1024, 'verdef-shape-bound')
    if verdef is not None:
        current = verdef
        for index in range(verdefnum):
            version, vflags, ndx, count, vhash, aux, next_offset = unpack('<HHHHIII', at(current, 20))
            demand(version == 1 and 0 < count <= 256, 'verdef-header')
            auxiliary = current + aux
            names = []
            for j in range(count):
                name, following = unpack('<II', at(auxiliary, 8))
                names.append(string(name))
                demand((following == 0) == (j == count - 1), 'verdaux-chain')
                auxiliary += following
            definitions.append(dict(name=names[0], parents=names[1:], index=ndx, flags=vflags, elfHash=vhash))
            demand((next_offset == 0) == (index == verdefnum - 1), 'verdef-chain')
            current += next_offset
    # Symbol metadata comes from bounded SHT_DYNSYM and SHT_GNU_versym sections.
    demand(shsize == 64 and 0 < shnum < 65535 and shoff + shsize * shnum <= len(data), 'section-header-bound')
    sections = [unpack('<IIQQQQIIQQ', shoff + i * shsize) for i in range(shnum)]
    symbols = []
    for index, section in enumerate(sections):
        if section[1] != 11:
            continue
        _, _, _, _, off, length, link, _, _, entsize = section
        demand(entsize == 24 and length % 24 == 0 and length // 24 <= 1000000 and off + length <= len(data), 'dynsym-bound')
        demand(link < shnum and sections[link][1] == 3, 'dynsym-string-link')
        strings = sections[link]
        string_data = data[strings[4]:strings[4] + strings[5]]
        versyms = [s for s in sections if s[1] == 0x6fffffff and s[6] == index]
        demand(len(versyms) <= 1, 'versym-count')
        if versyms:
            demand(versyms[0][5] == length // 24 * 2 and versyms[0][4] + versyms[0][5] <= len(data), 'versym-bound')
        for i in range(length // 24):
            name, info, other, section_index, value, ssize = unpack('<IBBHQQ', off + i * 24)
            demand(name < len(string_data), 'symbol-name-offset')
            end = string_data.find(b'\0', name)
            demand(end != -1, 'symbol-name-terminator')
            vindex = unpack('<H', versyms[0][4] + i * 2)[0] if versyms else 1
            symbols.append(dict(name=string_data[name:end].decode('ascii'), binding=info >> 4, type=info & 15,
                                visibility=other & 3, undefined=section_index == 0, versionIndex=vindex & 0x7fff,
                                versionHidden=bool(vindex & 0x8000)))
    return dict(path=str(path), pin=pin, machine=machine, elfType=kind, flags=flags, programHeaders=phnum,
                interpreter=interpreter, needed=needed, soname=string(one(14)) if one(14) is not None else None,
                rpath=string(one(15)) if one(15) is not None else None,
                runpath=string(one(29)) if one(29) is not None else None,
                auxiliary=[string(x) for x in tags.get(0x7ffffffd, [])],
                filters=[string(x) for x in tags.get(0x7fffffff, [])], flags1=one(0x6ffffffb, 0),
                versionRequirements=requirements, versionDefinitions=definitions, symbols=symbols)


def target(path):
    original = str(path)
    path = Path(os.path.normpath(path))
    steps = []
    seen = set()
    for _ in range(32):
        demand(str(path) not in seen, 'symlink-loop')
        seen.add(str(path))
        info = path.lstat()
        if not stat.S_ISLNK(info.st_mode):
            demand(stat.S_ISREG(info.st_mode), 'dependency-target-not-regular')
            return dict(requested=original, resolved=str(path), symlinks=steps, pin=blob(path)[1])
        link = os.readlink(path)
        steps.append(dict(path=str(path), target=link, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid))
        path = Path(os.path.normpath(link if link.startswith('/') else str(path.parent / link)))
        demand(any(path == Path(d) or Path(d) in path.parents for d in DEFAULTS), 'symlink-target-outside-fixed-directories')
    raise ValueError('symlink-depth')


def assess():
    manifest_data, manifest_pin = blob(MANIFEST)
    manifest = json.loads(manifest_data)
    declared = manifest['selectedFiles']
    existing_aliases = manifest['symlinks']
    for name, wanted in declared.items():
        demand(blob(Path(name))[1] == wanted, 'declared-pin:' + name)
    roots = []
    classifications = []
    for name in declared:
        data, _ = blob(Path(name))
        is_elf = data.startswith(b'\x7fELF')
        demand(not ('.so' in Path(name).name and not is_elf), 'selected-so-is-not-elf')
        elf_type = struct.unpack_from('<H', data, 16)[0] if is_elf else None
        demand(not is_elf or elf_type in (1, 2, 3), 'unknown-selected-elf-type')
        classifications.append(dict(path=name, elf=is_elf, elfType=elf_type,
                                    loadableRoot=is_elf and elf_type in (2, 3)))
        if is_elf and elf_type in (2, 3):
            roots.append(name)
    nodes, edges, resolutions, issues = {}, [], {}, []
    pending = list(roots)
    while pending:
        name = pending.pop(0)
        if name in nodes:
            continue
        node = elf(Path(name))
        nodes[name] = node
        if node['rpath'] or node['runpath'] or node['filters'] or node['auxiliary'] or node['flags1'] & 0x800:
            issues.append(dict(kind='UNREVIEWED_SEARCH_OR_AUXILIARY_CONTRACT', path=name,
                               rpath=node['rpath'], runpath=node['runpath'], auxiliary=node['auxiliary'], filters=node['filters']))
        requests = [(x, 'DT_NEEDED') for x in node['needed']]
        if node['interpreter']:
            demand(node['interpreter'] == '/lib64/ld-linux-x86-64.so.2', 'unexpected-interpreter')
            requests.append((node['interpreter'], 'PT_INTERP'))
        for needed, kind in requests:
            if kind == 'PT_INTERP':
                candidates = [Path('/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')]
                alias = '/lib64/ld-linux-x86-64.so.2'
            else:
                if not needed or '/' in needed or needed in ('.', '..'):
                    issues.append(dict(kind='ABSOLUTE_OR_PATH_NEEDED_REFUSAL', path=name, needed=needed))
                    continue
                candidates = [Path(d) / needed for d in DEFAULTS if os.path.lexists(Path(d) / needed)]
                alias = None
            found = [target(p) for p in candidates]
            # More than one pathname is allowed only when it resolves to the identical regular file.
            resolved = {x['resolved'] for x in found}
            if len(resolved) != 1:
                issues.append(dict(kind='UNRESOLVED' if not found else 'AMBIGUOUS', path=name, needed=needed, candidates=found))
                continue
            chosen = found[0]
            for item in found:
                resolutions[item['requested']] = item
            destination = chosen['resolved']
            demand(any(Path(d) in Path(destination).parents for d in DEFAULTS), 'resolved-outside-defaults')
            edges.append(dict(source=name, kind=kind, needed=needed, target=destination,
                              logicalAlias=alias or chosen['requested'], candidates=found))
            if destination not in nodes:
                pending.append(destination)
    version_checks = []
    symbol_checks = []
    for name, node in nodes.items():
        direct = {x['needed']:x['target'] for x in edges if x['source'] == name and x['kind'] == 'DT_NEEDED'}
        version_providers = {}
        for required in node['versionRequirements']:
            destination = direct.get(required['file'])
            if destination is None:
                issues.append(dict(kind='VERSION_PROVIDER_NOT_DIRECT_NEEDED', path=name, provider=required['file']))
                continue
            provider = nodes[destination]
            provided = {x['name']:x for x in provider['versionDefinitions']}
            for v in required['versions']:
                available = v['name'] in provided and provided[v['name']]['elfHash'] == v['elfHash']
                version_checks.append(dict(source=name, provider=destination, version=v['name'], requiredFlags=v['flags'], available=available))
                version_providers[v['index']] = (destination, v['name'])
                if not available:
                    issues.append(dict(kind='SYMBOL_VERSION_UNRESOLVED', path=name, provider=destination, version=v['name']))
        for symbol in node['symbols']:
            if not symbol['undefined'] or symbol['versionIndex'] <= 1:
                continue
            provider = version_providers.get(symbol['versionIndex'])
            if provider is None:
                issues.append(dict(kind='SYMBOL_VERSION_INDEX_UNRESOLVED', path=name, name=symbol['name'], index=symbol['versionIndex']))
                continue
            destination, version = provider
            version_index = {x['name']:x['index'] for x in nodes[destination]['versionDefinitions']}.get(version)
            matched = any(not s['undefined'] and s['name'] == symbol['name'] and s['versionIndex'] == version_index
                          and s['binding'] in (1, 2, 10) for s in nodes[destination]['symbols'])
            symbol_checks.append(dict(source=name, symbol=symbol['name'], provider=destination, version=version,
                                      weak=symbol['binding'] == 2, directProviderDefines=matched))
            if not matched:
                issues.append(dict(kind='VERSIONED_SYMBOL_NOT_EXPORTED_BY_DIRECT_PROVIDER', path=name,
                                   provider=destination, symbol=symbol['name'], version=version, weak=symbol['binding'] == 2))
    added_files = {name:node['pin'] for name,node in nodes.items() if name not in declared}
    added_links = {}
    for item in resolutions.values():
        for link in item['symlinks']:
            if link['path'] not in existing_aliases:
                added_links[link['path']] = {k:v for k,v in link.items() if k != 'path'}
            else:
                demand(existing_aliases[link['path']] == link['target'], 'existing-namespace-alias-conflict')
    missing_declared = [x for x in edges if x['kind'] == 'DT_NEEDED' and
                        (x['target'] not in declared or x['logicalAlias'] not in declared and x['logicalAlias'] not in existing_aliases)]
    # Keep symbols as metadata, not code or a dynamic-binding/ABI acceptance claim.
    compact_nodes = {name:{k:v for k,v in node.items() if k != 'symbols'} for name,node in nodes.items()}
    symbols = {name:node['symbols'] for name,node in nodes.items()}
    result = dict(stage='STATIC_BINARY_DATA_ELF_CLOSURE_NOT_RUNTIME_ACCEPTANCE', manifest=manifest_pin,
                  fixedDefaultDirectories=list(DEFAULTS), declaredRuntimeFiles=len(declared), declaredELFFiles=len(roots),
                  declaredExtensionELFs=sum('/lib-dynload/' in x for x in roots), declaredSystemELFs=sum('/lib/x86_64-linux-gnu/' in x for x in roots),
                  closureFiles=len(nodes), closureEdges=len(edges), additionalRegularFiles=added_files,
                  additionalSymlinks=added_links, additionalFileBytes=sum(x['bytes'] for x in added_files.values()),
                  declaredMissingEdges=missing_declared, issues=issues, completeForFixedStaticNeededGraph=not issues,
                  dynamicABIOrDlopenClosureAccepted=False, sourceClosureComplete=False, fixtureLaunchable=False,
                  proposedNoWrapperRequestGrant=True)
    once('ELF_NODES.json', compact_nodes)
    once('ELF_SYMBOLS.json', symbols)
    once('RESOLUTIONS.json', dict(edges=edges, requestedPaths=resolutions))
    once('VERSION_CHECKS.json', dict(versionNodes=version_checks, versionedUndefinedSymbols=symbol_checks))
    once('CLASSIFICATIONS.json', classifications)
    once('CLOSURE.json', result)
    return result


if __name__ == '__main__':
    os.umask(0o077)
    try:
        result = assess()
    except BaseException as error:
        once('PARSER_FAILURE.json', dict(stage='BINARY_METADATA_PARSER_FAILURE_NOT_SUBJECT',
                                        errorClass=type(error).__name__, message=str(error)))
        raise
    print(json.dumps({k:v for k,v in result.items() if k not in ('additionalRegularFiles','additionalSymlinks','declaredMissingEdges')}, sort_keys=True))
