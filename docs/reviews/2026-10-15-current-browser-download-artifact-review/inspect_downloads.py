"""Bounded offline inspection of frozen browser downloads, without app imports.

Run with python3 -B. Originals open read-only. Mutations affect private copies.
Output contains hashes and aggregate findings, never fixture actor identifiers.
"""
from pathlib import Path
import hashlib
import json
import math
import shutil
import sqlite3
import struct
import re
from contextlib import closing
import zipfile
import xml.etree.ElementTree as ET

DOWNLOADS = Path('/home/nathaniel/.local/state/openplan/current-project-preview-browser-fallback-20261015/downloads')
PRIVATE = Path('/home/nathaniel/.local/state/openplan/current-browser-download-artifact-review-20261015')
FIXTURE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/browser-acceptance-02/fixtures-private.json')
PAIRS = {
    'legacy': ('legacy-jurisdiction.json', 'legacy-jurisdiction-three-shapes.gpkg'),
    'unresolved': ('unresolved-jurisdiction.json', 'unresolved-three-shapes.gpkg'),
    'two_declarations': ('two-unverified-jurisdictions.json', 'two-unverified-jurisdictions-three-shapes.gpkg'),
}
WORKBOOK = 'unresolved-portfolio.xlsx'
PINS = {
    'legacy-jurisdiction.json': '596ba6935c137ec15af31737ea7d74bc366fb2780a5dad1b69e5ca943983b89e',
    'legacy-jurisdiction-three-shapes.gpkg': '8d22afe023086ad2b61dc0983913093af52e9a18e9b9a8667018b88d16e69ae6',
    'unresolved-jurisdiction.json': '6da53cccf07f1e948da53a515edf73a0ff3e724ea9820348efb5e88b6b98825e',
    'unresolved-three-shapes.gpkg': '00558cd03fe652e2034fb4310b4ca9b48528aaf18dee196b7e0b4d702f144d28',
    WORKBOOK: '72c9837fe7dd89607a5c5b95eb9ae092c529db28007302b573e4b86cd42dec4e',
    'two-unverified-jurisdictions.json': 'ee22c88f2660bde4c49a663560194991ad088a8ab9cf63e490c485feaa5b66bf',
    'two-unverified-jurisdictions-three-shapes.gpkg': '06a135d2ef54fb1f56cb4466060a5395ee67fff34fa608b71745b9d967f467c1',
}
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HEADERS = ['Project name', 'OpenPlan project ID', 'Description', 'Estimated cost', 'Cost currency', 'Cost price year', 'Project type', 'Status', 'Delivery phase', 'Source-location text', 'Place source', 'Place kind', 'Place reference', 'Country code', 'Subdivision code', 'Cost source document ID', 'Cost recorded at', 'Created at', 'Updated at']
POINT = [-122.2711, 37.8044]
LINE = [[-122.28, 37.80], [-122.2711, 37.8044], [-122.26, 37.82]]


def require(ok, reason):
    if not ok:
        raise AssertionError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    # These payloads use ASCII keys and ordinary numbers, so Python's sorted
    # compact JSON agrees with the pinned JS canonicalizer for these bytes.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def connect(path):
    # Originals remain read-only. Integrity runs on an in-memory backup because
    # installed SQLite 3.46.1 omits CHECK diagnostics on read-only connections.
    c = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    return closing(c)


def decode_geometry(blob):
    require(blob[:3] == b'GP\x00', 'geometry: GeoPackage binary magic/version')
    flags = blob[3]
    require(flags & 0xF0 == 0, 'geometry: standard nonempty binary flags')
    endian = '<' if flags & 1 else '>'
    require(struct.unpack_from(endian + 'i', blob, 4)[0] == 4326, 'geometry: binary SRS')
    envelope = (flags >> 1) & 7
    require(envelope <= 4, 'geometry: envelope code')
    start = 8 + [0, 32, 48, 48, 64][envelope]

    def wkb(offset):
        require(blob[offset] in (0, 1), 'geometry: WKB byte order')
        order = '<' if blob[offset] == 1 else '>'
        kind = struct.unpack_from(order + 'I', blob, offset + 1)[0]
        offset += 5

        def count():
            nonlocal offset
            n = struct.unpack_from(order + 'I', blob, offset)[0]
            offset += 4
            return n

        def point():
            nonlocal offset
            xy = list(struct.unpack_from(order + 'dd', blob, offset))
            offset += 16
            require(all(math.isfinite(v) for v in xy) and -180 <= xy[0] <= 180 and -90 <= xy[1] <= 90, 'geometry: finite longitude/latitude')
            return xy

        if kind == 1:
            coords = point()
        elif kind == 2:
            coords = [point() for _ in range(count())]
            require(len(coords) >= 2, 'geometry: line vertex count')
        elif kind == 3:
            coords = [[point() for _ in range(count())] for _ in range(count())]
            require(coords and all(len(r) >= 4 and r[0] == r[-1] for r in coords), 'geometry: closed polygon rings')
        elif kind in (5, 6):
            coords = []
            for _ in range(count()):
                subtype, child, offset = wkb(offset)
                require(subtype == (2 if kind == 5 else 3), 'geometry: multi child type')
                coords.append(child)
        else:
            raise AssertionError('geometry: unsupported WKB type')
        return kind, coords, offset

    kind, coords, end = wkb(start)
    require(end == len(blob), 'geometry: no trailing/truncated WKB')
    return kind, coords


def flatten(coords):
    if isinstance(coords[0], (int, float)):
        return [coords]
    return [xy for child in coords for xy in flatten(child)]


def inspect_pair(directory, state):
    jname, gname = PAIRS[state]
    j = json.loads((directory / jname).read_text())
    payload = {k: v for k, v in j.items() if k != 'payloadSha256'}
    require(sha(canonical(payload).encode()) == j['payloadSha256'], 'jurisdiction: canonical payload checksum')
    require(j['schema'] == 'openplan.project-jurisdiction-readiness-export.v3' and j['scope'] == 'external_handoff', 'jurisdiction: external schema/scope')
    require(j['registryVersion'] == '2026-10-11.1' and j['registrySha256'] == '531dca87cc6621786d4cff27b0fb52dd5b99105c3a78c6307a9a35322201c158', 'jurisdiction: registry identity')
    if state == 'legacy':
        require(j['context'] is None and j['contextSource'] == 'legacy_study_place' and len(j['entries']) == 1, 'jurisdiction: legacy state')
        require(j['entries'][0]['declaration'] is None and j['entries'][0]['administrativeGuidance'] is None and 'Adopting authority and legal applicability remain unresolved.' in j['disclosure'], 'jurisdiction: legacy authority caveat')
    elif state == 'unresolved':
        require(j['contextSource'] == 'project_declaration' and j['context']['state'] == 'unresolved' and j['context']['entries'] == [] and j['entries'] == [], 'jurisdiction: explicit unresolved without legacy fallback')
    else:
        require(j['contextSource'] == 'project_declaration' and j['context']['state'] == 'declared' and len(j['context']['entries']) == len(j['entries']) == 2, 'jurisdiction: two declarations')
        for index, (entry, scope) in enumerate(zip(j['entries'], ['overlap', 'sovereign'])):
            declaration = entry['declaration']
            require(declaration == j['context']['entries'][index], 'jurisdiction: declaration parity')
            require(declaration == {'label': f'Synthetic {scope} QA fixture, no authority asserted', 'countryCode': 'US', 'subdivisionCode': None, 'kind': 'Engineering fixture declaration', 'reference': f'qa:synthetic-{scope}-20261015', 'scope': scope, 'identity': 'staff_declared'}, 'jurisdiction: explicit declaration identity')
            require(entry['administrativeGuidance'] is None and entry['assessmentScope'] == 'Unverified staff declaration; jurisdiction-specific support is unassessed', 'jurisdiction: unverified scope')
            assessment = entry['assessment']
            require(assessment['jurisdiction']['id'] is None and assessment['jurisdiction']['assessmentKind'] is None and assessment['reports'] and all(r['status'] == 'unassessed' for r in assessment['reports']), 'jurisdiction: no inferred authority or assessed support')
    with connect(directory / gname) as c:
        with closing(sqlite3.connect(':memory:')) as memory:
            c.backup(memory)
            require(memory.execute('pragma integrity_check').fetchall() == [('ok',)], 'sqlite: integrity')
        require(not c.execute('pragma foreign_key_check').fetchall(), 'metadata: foreign keys')
        require(c.execute('pragma application_id').fetchone()[0] == 0x47504B47 and c.execute('pragma user_version').fetchone()[0] == 10400, 'metadata: GeoPackage application/version')
        require(c.execute('select organization,organization_coordsys_id from gpkg_spatial_ref_sys where srs_id=4326').fetchone()[:] == ('EPSG', 4326), 'metadata: EPSG authority')
        cols = c.execute('select * from gpkg_geometry_columns').fetchall()
        require(len(cols) == 8 and all(r['srs_id'] == 4326 and r['z'] == r['m'] == 0 for r in cols), 'metadata: layer SRS/dimensionality')
        require(len(c.execute('select * from gpkg_contents').fetchall()) == 11, 'metadata: contents count')
        geometries = {}
        for r in cols:
            table = r['table_name']
            require(table in ['project_area', 'project_location', 'project_corridors', 'safety_crash_ksi', 'engagement_geometry', 'aequilibrae_links', 'activitysim_links', 'land_use_designations'], 'metadata: expected geometry layer')
            content = c.execute('select * from gpkg_contents where table_name=?', (table,)).fetchone()
            require(content is not None and content['data_type'] == 'features' and content['srs_id'] == 4326, 'metadata: feature registration')
            rows = c.execute(f'select geom from "{table}"').fetchall()
            require(len(rows) == (1 if table.startswith('project_') else 0), 'geometry: expected feature count')
            if rows:
                blob = rows[0][0]
                kind, coords = decode_geometry(blob)
                expected_type = {'project_area': ('GEOMETRY', (3, 6)), 'project_location': ('POINT', (1,)), 'project_corridors': ('LINESTRING', (2,))}[table]
                require(r['geometry_type_name'] == expected_type[0] and kind in expected_type[1], 'metadata: geometry type registration')
                xy = flatten(coords)
                bounds = [min(v[0] for v in xy), min(v[1] for v in xy), max(v[0] for v in xy), max(v[1] for v in xy)]
                require(bounds == [content[k] for k in ['min_x', 'min_y', 'max_x', 'max_y']], 'metadata: feature extent')
                if table == 'project_location':
                    require(coords == POINT, 'geometry: exact point longitude/latitude order')
                if table == 'project_corridors':
                    require(coords == LINE, 'geometry: exact line vertex order')
                geometries[table] = {'sha256': sha(blob), 'wkb_type': kind, 'vertices': len(xy), 'bounds': bounds}
        info = dict(c.execute('select * from project_info').fetchone())
        require(info['crs'] == 'EPSG:4326 (WGS 84 longitude/latitude)' and info['corridor_count'] == 1 and info['omitted_corridor_count'] == 0, 'metadata: manifest coverage')
        require(info['project_id'] == j['projectId'] and info['project_updated_at'] == j['projectRevision'], 'parity: project identity/revision')
        corridor = c.execute('select corridor_name,corridor_type,los_grade from project_corridors').fetchone()
        require(corridor[:] == ('Synthetic QA display line, not a model network', 'custom', None), 'geometry: synthetic line attributes')
        status = c.execute('select layer_key,status,record_count from openplan_layer_status').fetchall()
        require(len(status) == 8 and all((r['status'], r['record_count']) == (('included', 1) if r['layer_key'] in ['project_area', 'project_location', 'project_corridors'] else ('unavailable', None)) for r in status), 'metadata: unavailable distinct from zero')
        context = c.execute('select * from project_jurisdiction_context').fetchall()
        require(len(context) == 1, 'parity: one jurisdiction manifest')
        context = context[0]
        require(context['readiness_payload_json'] == canonical(j), 'parity: canonical JSON/GeoPackage payload')
        require(context['jurisdiction_context_json'] == canonical(j['context']), 'parity: canonical context')
        require(context['project_id'] == j['projectId'] and context['project_revision'] == j['projectRevision'] and context['payload_sha256'] == j['payloadSha256'] and context['readiness_schema'] == j['schema'] and context['registry_version'] == j['registryVersion'] and context['registry_sha256'] == j['registrySha256'], 'parity: jurisdiction manifest fields')
    return j, info, geometries


def workbook(directory, info):
    with zipfile.ZipFile(directory / WORKBOOK) as z:
        require(z.testzip() is None and len(z.namelist()) == len(set(z.namelist())), 'workbook: ZIP CRC/unique members')
        require(set(z.namelist()) == {'xl/_rels/workbook.xml.rels', 'xl/theme/theme1.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/metadata.xml', 'xl/workbook.xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', '[Content_Types].xml'}, 'workbook: expected ZIP members')
        parsed = {n: ET.fromstring(z.read(n)) for n in z.namelist()}
        require([e.get('name') for e in parsed['xl/workbook.xml'].findall('s:sheets/s:sheet', NS)] == ['Projects', 'Read me'], 'workbook: sheet schema')
        rels = {e.get('Id'):e.get('Target') for e in parsed['xl/_rels/workbook.xml.rels']}
        require(all(rels.get(e.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')) == f'worksheets/sheet{i}.xml' for i,e in enumerate(parsed['xl/workbook.xml'].findall('s:sheets/s:sheet', NS),1)), 'workbook: worksheet relationship targets')
        for n, root in parsed.items():
            require(not any(e.tag.split('}')[-1] in ['f', 'externalLink', 'externalReference'] for e in root.iter()), 'workbook: literal values only')
            require(not any(e.get('TargetMode') == 'External' for e in root.iter()), 'workbook: no external relationship')
        cells = []
        for i, dimension in [(1, 'A1:S2'), (2, 'A1:B24')]:
            root = parsed[f'xl/worksheets/sheet{i}.xml']
            require(root.find('s:dimension', NS).get('ref') == dimension, 'workbook: sheet dimensions')
            sheet = {}
            for cell in root.findall('.//s:sheetData/s:row/s:c', NS):
                require(cell.get('t') == 'str', 'workbook: string literal cell type')
                ref = cell.get('r')
                require(ref not in sheet, 'workbook: unique cell references')
                sheet[ref] = cell.findtext('s:v', default='', namespaces=NS)
            cells.append(sheet)
        project, readme = cells
        require([project[f'{chr(65+i)}1'] for i in range(19)] == HEADERS and len(project) == 38 and len(readme) == 46, 'workbook: header/cell schema')
        require(project['A2'] == info['project_name'] and project['B2'] == info['project_id'] and project['C2'] == info['project_summary'] and project['G2'] == info['plan_type'] and project['H2'] == info['project_status'] and project['I2'] == info['delivery_phase'] and project['R2'] == info['project_created_at'] and project['S2'] == info['project_updated_at'], 'workbook: same unresolved project lineage')
        require(all(project[k] == '' for k in ['D2', 'E2', 'F2', 'P2', 'Q2']), 'workbook: blank costs/provenance retained')
        require([project[k] for k in ['J2','K2','L2','M2','N2','O2']] == ['Oakland','tigerweb','city','0653000','US','CA'], 'workbook: place text/reference remains literal')
        require(readme['B4'] == info['workspace_id'] and readme['B5'] == '1' and readme['B6'] == 'Projects' and readme['B7'] == '1' and readme['B8'] == 'Units', 'workbook: manifest lineage/schema')
        limits = {
            'B9': 'Create only. Every row starts as Skip and must be explicitly reviewed.',
            'B10': 'Source-location text is retained for review but does not create a project boundary or map point.',
            'B11': 'Place identity, cost provenance, and timestamps are exported for inspection but are not imported as project fields.',
            'B12': 'This workbook contains literal values only. OpenPlan does not emit or recalculate formulas.',
        }
        require(all(readme[k] == v for k,v in limits.items()), 'workbook: declared import/geometry/reference/formula limits')
        require(readme['B1'] == 'version 1' and readme['B2'] == '2026-10-15T13:20:56.953Z', 'workbook: version/generated timestamp')
        require([readme[f'B{i}'] for i in range(15,25)] == HEADERS[:10], 'workbook: mapping instructions')
    return {'zip_members': 11, 'sheets': ['Projects','Read me'], 'dimensions': ['A1:S2','A1:B24'], 'string_cells': 84, 'formulas': 0, 'project_rows': 1, 'generated_at': readme['B2']}


def privacy(directory, secrets):
    for name in PINS:
        raw = (directory / name).read_bytes()
        strings = [raw]
        if name.endswith('.xlsx'):
            with zipfile.ZipFile(directory / name) as z:
                require(z.testzip() is None, 'workbook: ZIP CRC/unique members')
                strings.extend(z.read(n) for n in z.namelist())
        if name.endswith('.gpkg'):
            with connect(directory / name) as c:
                for table, definition in c.execute("select name,sql from sqlite_master where type='table'"):
                    strings.append(definition.encode())
                    for row in c.execute(f'select * from "{table}"'):
                        strings.extend(str(v).encode() for v in row if isinstance(v,str))
        corpus = b'\n'.join(strings)
        require(b'created_by' not in corpus.lower() and b'recordedby' not in corpus.lower(), 'privacy: internal actor field absent')
        require(not any(s.encode() in corpus for s in secrets), 'privacy: known fixture account identifier/credential absent')


def inspect(directory, secrets):
    privacy(directory, secrets)
    result = {}
    private_info = {}
    for state in PAIRS:
        j, info, geometries = inspect_pair(directory, state)
        private_info[state] = info
        result[state] = {'context_source': j['contextSource'], 'context_state': None if j['context'] is None else j['context']['state'], 'entries': len(j['entries']), 'project_revision': j['projectRevision'], 'payload_sha256': j['payloadSha256'], 'geometries': geometries}
    require(result['legacy']['geometries'] == result['unresolved']['geometries'] == result['two_declarations']['geometries'], 'geometry: unchanged geometry across snapshots')
    require(len({v['project_id'] for v in private_info.values()}) == 1 and len({v['workspace_id'] for v in private_info.values()}) == 1, 'parity: same project/workspace snapshots')
    result['workbook'] = workbook(directory, private_info['unresolved'])
    return result


def edit_sql(directory, sql, args=(), pair='unresolved'):
    with sqlite3.connect(directory / PAIRS[pair][1]) as c:
        c.execute(sql, args)


def edit_json(directory, change, pair='unresolved', rehash=False):
    p = directory / PAIRS[pair][0]
    j = json.loads(p.read_text())
    change(j)
    if rehash:
        j['payloadSha256'] = sha(canonical({k:v for k,v in j.items() if k != 'payloadSha256'}).encode())
    p.write_text(json.dumps(j, indent=3))


def edit_workbook(directory, old, new):
    p = directory / WORKBOOK
    with zipfile.ZipFile(p) as z:
        members = {n:z.read(n) for n in z.namelist()}
    matched = sum(v.count(old) for v in members.values())
    require(matched > 0, 'control: mutation target exists')
    with zipfile.ZipFile(p, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for n,v in members.items():
            z.writestr(n, v.replace(old,new))


def change_cell_type(directory):
    with zipfile.ZipFile(directory / WORKBOOK) as z:
        xml = z.read('xl/worksheets/sheet1.xml')
    tag = re.search(rb'<c\b[^>]*\br="M2"[^>]*>', xml).group()
    edit_workbook(directory, tag, tag.replace(b't="str"', b't="n"'))


def corrupt_zip_crc(directory):
    p = directory / WORKBOOK
    raw = bytearray(p.read_bytes())
    offset = raw.index(b'PK\x01\x02') + 16
    raw[offset] ^= 1
    p.write_bytes(raw)


def corrupt_integrity(directory):
    with sqlite3.connect(directory / PAIRS['unresolved'][1]) as c:
        c.execute('pragma ignore_check_constraints=on')
        c.execute("update openplan_layer_status set status='invalid' where layer_key='crash_ksi'")


def promote_declaration(directory):
    def change(j):
        j['context']['entries'][0]['identity'] = 'server_resolved'
        j['entries'][0]['declaration']['identity'] = 'server_resolved'
    edit_json(directory, change, pair='two_declarations', rehash=True)


def change_area(directory):
    with connect(directory / PAIRS['unresolved'][1]) as c:
        blob = c.execute('select geom from project_area').fetchone()[0]
    _, coords = decode_geometry(blob)
    xy = flatten(coords)
    bounds = [min(p[0] for p in xy), max(p[0] for p in xy), min(p[1] for p in xy), max(p[1] for p in xy)]
    for x, y in xy:
        old = struct.pack('<dd', x, y)
        if blob.count(old) == 1 and bounds[0] < x < bounds[1]-0.000001 and bounds[2] < y < bounds[3]:
            edit_sql(directory, 'update project_area set geom=?', (blob.replace(old, struct.pack('<dd', x+0.000001, y), 1),))
            return
    raise AssertionError('control: unique interior area vertex exists')


def main():
    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    before = {n:{'sha256':sha((DOWNLOADS/n).read_bytes()), 'bytes':(DOWNLOADS/n).stat().st_size} for n in PINS}
    require(all(before[n]['sha256'] == pin for n,pin in PINS.items()), 'custody: original artifact pins')
    fixture = json.loads(FIXTURE.read_text())
    # Values remain in process memory and never enter logs or public evidence.
    secrets = [account[k] for account in fixture['accounts'].values() for k in ['id','email','password','accessToken'] if isinstance(account.get(k),str) and account[k]]
    del fixture
    originals = inspect(DOWNLOADS, secrets)
    controls = []
    case = PRIVATE / 'control-copies'
    case.mkdir(mode=0o700, exist_ok=True)

    def restore():
        for n in PINS:
            shutil.copyfile(DOWNLOADS/n, case/n)
            (case/n).chmod(0o600)

    def trial(name, mutate, reason=None):
        restore()
        try:
            mutate(case)
            try:
                inspect(case, secrets)
                observed = 'SURVIVED'
            except AssertionError as error:
                observed = str(error)
            require(observed == ('SURVIVED' if reason is None else reason), 'control: unexpected outcome for ' + name + ': ' + observed)
            controls.append({'name':name, 'outcome':observed})
        finally:
            restore()
        require(all(sha((case/n).read_bytes()) == PINS[n] for n in PINS), 'control: copy restoration')

    trial('harmless JSON whitespace', lambda d: edit_json(d, lambda j: None))
    trial('canonical checksum tamper', lambda d: edit_json(d, lambda j: j.update(disclosure='changed')), 'jurisdiction: canonical payload checksum')
    trial('explicit unresolved becomes legacy', lambda d: edit_json(d, lambda j: j.update(contextSource='legacy_study_place'), rehash=True), 'jurisdiction: explicit unresolved without legacy fallback')
    trial('staff declaration consistently promoted', promote_declaration, 'jurisdiction: explicit declaration identity')
    trial('SQLite stored constraint corruption', corrupt_integrity, 'sqlite: integrity')
    trial('GeoPackage application id', lambda d: edit_sql(d,'pragma application_id=1'), 'metadata: GeoPackage application/version')
    trial('layer SRS changed', lambda d: edit_sql(d,"update gpkg_geometry_columns set srs_id=0 where table_name='project_location'"), 'metadata: layer SRS/dimensionality')
    trial('registered extent changed', lambda d: edit_sql(d,"update gpkg_contents set min_x=0 where table_name='project_location'"), 'metadata: feature extent')
    trial('point coordinate order reversed', lambda d: edit_sql(d,"update project_location set geom=?", (b'GP\x00\x01'+struct.pack('<i',4326)+b'\x01'+struct.pack('<I',1)+struct.pack('<dd',POINT[1],POINT[0]),)), 'geometry: finite longitude/latitude')
    trial('line vertices reversed', lambda d: edit_sql(d,"update project_corridors set geom=?", (b'GP\x00\x01'+struct.pack('<i',4326)+b'\x01'+struct.pack('<II',2,3)+b''.join(struct.pack('<dd',*xy) for xy in reversed(LINE)),)), 'geometry: exact line vertex order')
    trial('area coordinate changed in one snapshot', change_area, 'geometry: unchanged geometry across snapshots')
    trial('JSON/GeoPackage mismatch', lambda d: edit_sql(d,"update project_jurisdiction_context set readiness_payload_json='{}'"), 'parity: canonical JSON/GeoPackage payload')
    trial('unavailable becomes zero', lambda d: edit_sql(d,"update openplan_layer_status set record_count=0 where layer_key='crash_ksi'"), 'metadata: unavailable distinct from zero')
    trial('actor UUID inserted', lambda d: edit_json(d,lambda j:j.update(created_by=secrets[0])), 'privacy: internal actor field absent')
    trial('known fixture actor UUID inserted', lambda d: edit_json(d,lambda j:j.update(extra=secrets[0])), 'privacy: known fixture account identifier/credential absent')
    trial('known fixture email inserted', lambda d: edit_json(d,lambda j:j.update(extra=secrets[1])), 'privacy: known fixture account identifier/credential absent')
    trial('ZIP member CRC corrupted', corrupt_zip_crc, 'workbook: ZIP CRC/unique members')
    trial('worksheet relationship shifted', lambda d: edit_workbook(d,b'Target="worksheets/sheet1.xml"',b'Target="worksheets/sheet2.xml"'), 'workbook: worksheet relationship targets')
    trial('external relationship inserted', lambda d: edit_workbook(d,b'Target="theme/theme1.xml"',b'Target="theme/theme1.xml" TargetMode="External"'), 'workbook: no external relationship')
    trial('formula injected', lambda d: edit_workbook(d,b'<v>0653000</v>',b'<f>1+1</f><v>0653000</v>'), 'workbook: literal values only')
    trial('text cell changed to numeric', change_cell_type, 'workbook: string literal cell type')
    trial('header renamed', lambda d: edit_workbook(d,b'<v>Estimated cost</v>',b'<v>Other amount</v>'), 'workbook: header/cell schema')
    trial('workbook revision tampered', lambda d: edit_workbook(d,b'2026-10-15T13:20:12.214511+00:00',b'2026-10-15T13:20:12.214512+00:00'), 'workbook: same unresolved project lineage')
    trial('import limit removed', lambda d: edit_workbook(d,b'Create only. Every row starts as Skip and must be explicitly reviewed.',b'Import all rows automatically.'), 'workbook: declared import/geometry/reference/formula limits')
    restored = inspect(case, secrets)
    require(restored == originals, 'control: restored semantic baseline')
    after = {n:{'sha256':sha((DOWNLOADS/n).read_bytes()),'bytes':(DOWNLOADS/n).stat().st_size} for n in PINS}
    require(before == after, 'custody: original immutable before/after')
    output = {'artifacts_before':before, 'artifacts_after':after, 'originals_unchanged':True, 'findings':originals, 'controls':controls, 'copies_restored':True, 'fixture_account_sets_checked':3}
    (PRIVATE/'results.json').write_text(json.dumps(output,indent=2)+'\n')
    (PRIVATE/'results.json').chmod(0o600)
    print(json.dumps({'originals_unchanged':True,'matching_pairs':3,'controls':len(controls),'harmless_survived':1,'targeted_faults_detected':len(controls)-1,'copies_restored':True,'results':str(PRIVATE/'results.json')}))


if __name__ == '__main__':
    main()
