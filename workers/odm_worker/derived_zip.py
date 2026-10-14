"""Retain ordered image-member bytes from the original retained private ZIP.

This candidate performs no download, decoding, engine effect or live authority
check. Cooperative local writers and filesystem durability remain assumptions.
"""
import hashlib
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import struct
import time
import uuid
import zipfile

from admission_journal import private, synchronize
from intake import IMAGE_EXTENSIONS
from retained_source import (CHUNK, absolute, check_time, digest, finite_limit,
    json_bytes, prepare as retain, publish, read_json, reader, writer)

PLAN = 'openplan.odm-derived-zip-plan.v1'
MANIFEST = 'openplan.odm-derived-zip-set.v1'


def directory(stream, size, max_entries, max_metadata, deadline):
    """Bound and count actual directory records before ZipFile allocates them."""
    check_time(deadline)
    start = max(0, size-65557);stream.seek(start);tail = stream.read(65557)
    offset = tail.rfind(b'PK\x05\x06')
    if offset < 0 or len(tail)-offset < 22:
        raise ValueError('Original ZIP footer is missing')
    sig, disk, first_disk, here, total, length, begin, comment = struct.unpack('<4s4H2LH',tail[offset:offset+22])
    end = start+offset
    if offset+22+comment != len(tail):
        raise ValueError('Original ZIP footer or comment is inconsistent')
    if disk != 0 or first_disk != 0 or here != total:
        raise ValueError('Spanning ZIP archives are unsupported')
    stream.seek(max(0,end-20));locator = stream.read(20)
    if len(locator)==20 and locator.startswith(b'PK\x06\x07'):
        _sig, locator_disk, zip64_offset, disks = struct.unpack('<4sLQL',locator)
        if locator_disk != 0 or disks != 1 or zip64_offset+56 > end-20:
            raise ValueError('Original ZIP64 locator is inconsistent')
        stream.seek(zip64_offset);raw = stream.read(56)
        if len(raw)!=56: raise ValueError('Original ZIP64 footer is incomplete')
        sig64, record_length, _made, _needed, disk64, first64, here64, total64, length64, begin64 = struct.unpack('<4sQ2H2L4Q',raw)
        if sig64 != b'PK\x06\x06' or record_length < 44 or record_length > 4096 or zip64_offset+12+record_length != end-20 or disk64 != 0 or first64 != 0 or here64 != total64:
            raise ValueError('Original ZIP64 footer is inconsistent')
        if any(old != sentinel and old != new for old, sentinel, new in ((total,65535,total64),(length,4294967295,length64),(begin,4294967295,begin64))):
            raise ValueError('Original ZIP64 declarations differ')
        total, length, begin, end = total64, length64, begin64, zip64_offset
    elif total == 65535 or length == 4294967295 or begin == 4294967295:
        raise ValueError('Original ZIP64 locator is missing')
    if length > max_metadata or total > max_entries:
        raise ValueError('Original ZIP directory exceeds its declared bounds')
    if begin+length != end or begin > size:
        raise ValueError('Original ZIP directory extent is inconsistent')
    stream.seek(begin);raw = stream.read(length)
    count, cursor = 0, 0
    while cursor < len(raw):
        check_time(deadline)
        if raw[cursor:cursor+4] != b'PK\x01\x02' or len(raw)-cursor < 46:
            raise ValueError('Original ZIP directory record is inconsistent')
        lengths = struct.unpack_from('<3H',raw,cursor+28)
        cursor += 46+sum(lengths);count += 1
        if cursor > len(raw) or count > max_entries:
            raise ValueError('Actual ZIP directory exceeds its declared bounds')
    if len(raw) != length or count != total:
        raise ValueError('Original ZIP directory record count differs')
    return count


def members(archive, count, max_bytes, deadline):
    entries, seen = [], set()
    records = archive.infolist()
    if len(records) != count: raise ValueError('Loaded ZIP directory count differs')
    for info in records:
        check_time(deadline)
        name = info.orig_filename
        path = name[:-1] if info.is_dir() else name
        if not path or len(name)>1024 or '\\' in name or any(ord(char)<32 or ord(char)==127 for char in name) or PurePosixPath(path).is_absolute() or str(PurePosixPath(path)) != path or any(part in ('.','..') for part in path.split('/')) or name in seen:
            raise ValueError('Original ZIP member name is unsafe or repeated')
        seen.add(name)
        mode = info.external_attr >> 16
        if info.flag_bits & 1 or stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR) or (stat.S_IFMT(mode)==stat.S_IFDIR) != info.is_dir() and stat.S_IFMT(mode)!=0:
            raise ValueError('Encrypted or special ZIP members are unsupported')
        if info.is_dir(): continue
        suffix = PurePosixPath(path).suffix.lower()
        if suffix in IMAGE_EXTENSIONS: entries.append((info,suffix))
    entries.sort(key=lambda value:value[0].orig_filename)
    if not entries: raise ValueError('Original ZIP has no selected image members')
    if sum(info.file_size for info,_suffix in entries) > max_bytes:
        raise ValueError('Original ZIP images exceed expanded byte budget')
    return entries


def expanded(archive, info, limit, deadline, output=None):
    size, checksum = 0, hashlib.sha256()
    with archive.open(info) as stream:
        while chunk := stream.read(min(CHUNK,limit-size+1)):
            check_time(deadline);size += len(chunk)
            if size > limit: raise ValueError('Actual ZIP image exceeds expanded byte budget')
            checksum.update(chunk)
            if output is not None: output.write(chunk)
    if size != info.file_size: raise ValueError('Actual ZIP image size differs')
    return {'bytes':size,'sha256':checksum.hexdigest()}


def prepare(source_arguments, *, destination, max_expanded_bytes, max_entries=10000,
            max_directory_bytes=16*1024*1024, timeout=120):
    """Recover missing image slots from the retained original archive only."""
    for limit in (max_expanded_bytes,max_entries,max_directory_bytes): finite_limit(limit)
    if type(timeout) not in (int,float) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Derived ZIP timeout must be positive and finite')
    deadline = time.monotonic()+timeout
    source_pack = absolute(source_arguments['destination']);destination = absolute(destination)
    if source_pack == destination or source_pack in destination.parents or destination in source_pack.parents:
        raise ValueError('Original ZIP source and derived roots must not overlap')
    source_arguments = {**source_arguments,'timeout':min(source_arguments.get('timeout',timeout),timeout)}
    receipt = retain(**source_arguments);original = receipt['manifest']
    if original['binding']['originalRequest']['imagery']['type'] != 'zip_url' or len(original['sources']) != 1:
        raise ValueError('One original retained ZIP source is required')
    row = original['sources'][0]
    private(destination.parent,True)
    try: destination.mkdir(mode=0o700)
    except FileExistsError: pass
    else: synchronize(destination.parent)
    private(destination,True)
    with writer(destination,deadline), reader(source_pack,row['objectRelativePath']) as (stream,before):
        if before.st_size != row['bytes']: raise ValueError('Original retained ZIP size differs')
        checksum = hashlib.sha256();stream.seek(0)
        while chunk := stream.read(CHUNK):
            check_time(deadline);checksum.update(chunk)
        if checksum.hexdigest() != row['sha256']:
            raise ValueError('Original retained ZIP hash differs')
        count = directory(stream,before.st_size,max_entries,max_directory_bytes,deadline)
        with zipfile.ZipFile(stream) as archive:
            selected = members(archive,count,max_expanded_bytes,deadline)
            records = [{'slot':index,'archiveMember':info.orig_filename,
                'filename':f'image-{index:05d}'+suffix,'objectRelativePath':f'objects/image-{index:05d}.bin',
                'bytes':info.file_size,'compression':info.compress_type,'crc32':info.CRC} for index,(info,suffix) in enumerate(selected)]
            identity = {'format':PLAN,'binding':original['binding'],'sourceManifestSha256':receipt['manifestSha256'],
                'archive':{key:row[key] for key in ('bytes','sha256')},'maxExpandedBytes':max_expanded_bytes,
                'maxEntries':max_entries,'maxDirectoryBytes':max_directory_bytes}
            plan_path = destination/'plan.json'
            if plan_path.exists() or plan_path.is_symlink():
                plan = read_json(destination,'plan.json')
                if not isinstance(plan,dict) or set(plan) != {*identity,'images'} or json_bytes({key:plan[key] for key in identity}) != json_bytes(identity):
                    raise ValueError('Saved derived ZIP identity differs')
                images = plan['images']
                if not isinstance(images,list) or len(images)!=len(records): raise ValueError('Saved derived ZIP mapping differs')
                for saved,expected in zip(images,records):
                    if not isinstance(saved,dict) or set(saved)!={*expected,'sha256'} or json_bytes({key:saved[key] for key in expected}) != json_bytes(expected) or not isinstance(saved['sha256'],str) or len(saved['sha256'])!=64 or any(char not in '0123456789abcdef' for char in saved['sha256']):
                        raise ValueError('Saved derived ZIP record differs')
            else:
                if (destination/'manifest.json').exists() or (destination/'manifest.json').is_symlink():
                    raise ValueError('Derived ZIP manifest has no original plan')
                remaining = max_expanded_bytes;images = []
                for record,(info,_suffix) in zip(records,selected):
                    actual = expanded(archive,info,remaining,deadline);remaining -= actual['bytes']
                    images.append({**record,**actual})
                plan = {**identity,'images':images};publish(destination,'plan.json',json_bytes(plan))
            objects = destination/'objects';objects.mkdir(mode=0o700,exist_ok=True);private(objects,True)
            required = sum(image['bytes'] for image in images if not (destination/image['objectRelativePath']).exists())
            if required and shutil.disk_usage(destination).free < required+2*len(json_bytes(plan))+CHUNK:
                raise ValueError('Insufficient free space for derived ZIP bytes')
            for image,(info,_suffix) in zip(images,selected):
                check_time(deadline);name = Path(image['objectRelativePath']).name;target = objects/name
                if not target.exists() and not target.is_symlink():
                    temporary = destination/('.partial-'+uuid.uuid4().hex)
                    with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as output:
                        actual = expanded(archive,info,image['bytes'],deadline,output);output.flush();os.fsync(output.fileno())
                    if actual != {key:image[key] for key in ('bytes','sha256')}:
                        raise ValueError('Original planned ZIP image bytes differ')
                    temporary.rename(target);synchronize(objects);synchronize(destination)
                if digest(objects,name,image['bytes'],deadline) != {key:image[key] for key in ('bytes','sha256')}:
                    raise ValueError('Retained derived ZIP image differs')
            names = set()
            with os.scandir(objects) as entries:
                for entry in entries:
                    check_time(deadline);names.add(entry.name)
                    if len(names)>len(images): raise ValueError('Retained derived ZIP object mapping differs')
            if names != {Path(image['objectRelativePath']).name for image in images}:
                raise ValueError('Retained derived ZIP object mapping differs')
            manifest = {'format':MANIFEST,'binding':original['binding'],'sourceManifestSha256':receipt['manifestSha256'],
                'archive':identity['archive'],'planSha256':hashlib.sha256(json_bytes(plan)).hexdigest(),
                'sources':[{key:image[key] for key in ('slot','objectRelativePath','filename','archiveMember','bytes','sha256')} for image in images],
                'state':'derived_retained_locally','authorityVerification':'unassessed','imageDecodingVerification':'unassessed'}
            publish(destination,'manifest.json',json_bytes(manifest));check_time(deadline)
            return {'manifestSha256':hashlib.sha256(json_bytes(manifest)).hexdigest(),'manifestBytes':len(json_bytes(manifest)),'manifest':manifest}
