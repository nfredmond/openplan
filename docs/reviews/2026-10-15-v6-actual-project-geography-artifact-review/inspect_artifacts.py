"""Inspect only the frozen V6 handoffs. No application imports or service access.

Use python3 -B. Faults affect private copies and restore in finally. Public output
contains hashes, counts and diagnostics, never account values or project IDs.
"""
from contextlib import closing
from pathlib import Path
import hashlib
import json
import math
import shutil
import sqlite3
import struct

DOWNLOADS = Path('/home/nathaniel/.local/state/openplan/v6-project-geography-downloads-20261015')
PRIVATE = Path('/home/nathaniel/.local/state/openplan/v6-actual-project-geography-artifact-review-20261015')
FIXTURE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/browser-acceptance-02/fixtures-private.json')
ATTEST = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6/runtime-start-attestation.json')
PAIRS = {
    'legacy': ('legacy-jurisdiction.json', 'legacy-three-shapes.gpkg'),
    'unresolved': ('unresolved-jurisdiction.json', 'unresolved-three-shapes.gpkg'),
    'declared': ('declared-corrected-jurisdictions.json', 'declared-corrected-three-shapes.gpkg'),
}
PINS = {
    'inventory.json': '8c8e1519fbc707aa06b8d92726ead9359529805c22e8d4ee730c0995bc572cb7',
    'legacy-jurisdiction.json': '8faf159c9d4e7aa48a6f35a4b51b395cd8fbb39c71827a946eca4d6bc7fdebe0',
    'legacy-three-shapes.gpkg': '3b3721820a91cb75821dece212875ad6be8e9601fc909469e0dce18e866c7ec5',
    'unresolved-jurisdiction.json': '19c1d635c310d13eba1999bd9089e13d1dea5dde0b3eadd586c54fd65eb12d86',
    'unresolved-three-shapes.gpkg': '069eebf7b2315c1b39f9497ddb41022de9a4b6ca6395461744a8ede091552554',
    'declared-corrected-jurisdictions.json': 'a1e36c7f53dcac43363960ea562a5aaff873c537499d2778a52992fa67d66a9b',
    'declared-corrected-three-shapes.gpkg': '76b19db61830eed25008000bbbbf26b2e85e024ba4e459c98d9956462edc2ee2',
    'declared-jurisdictions.json': '5a223505d4fb67b0eb12f40226f858fa8278b06abf8d7955c9cc4a23ed8b6ab7',
}
REGISTRY_SHA = '531dca87cc6621786d4cff27b0fb52dd5b99105c3a78c6307a9a35322201c158'
AREA_SHA = 'e24c64d176c2a904a87fbad896bde8ce36cfaa3bde45761836ed1eb159505d52'
POINT = [-122.2711, 37.8044]
LINE = [[-122.28, 37.8], [-122.2711, 37.8044], [-122.26, 37.82]]
FEATURES = {
    'project_area': 'GEOMETRY', 'project_location': 'POINT',
    'project_corridors': 'LINESTRING', 'safety_crash_ksi': 'POINT',
    'engagement_geometry': 'GEOMETRY', 'aequilibrae_links': 'LINESTRING',
    'activitysim_links': 'LINESTRING', 'land_use_designations': 'GEOMETRY',
}
ATTRIBUTES = {'project_info', 'project_jurisdiction_context', 'openplan_layer_status'}


def require(condition, diagnostic):
    if not condition:
        raise AssertionError(diagnostic)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    # For these ASCII object keys and payload values, matches the pinned JS
    # localeCompare canonicalizer. This is not a general JS JSON implementation.
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def hashes(directory):
    return {n: {'bytes': (directory/n).stat().st_size, 'sha256': sha((directory/n).read_bytes())} for n in PINS}


def read_package(path):
    # A normal writable memory connection checks CHECK constraints. Read-only or
    # immutable file connections alone miss these diagnostics in SQLite 3.46.1.
    with closing(sqlite3.connect(f'file:{path}?mode=ro', uri=True)) as source:
        memory = sqlite3.connect(':memory:')
        source.backup(memory)
    memory.row_factory = sqlite3.Row
    require([r[0] for r in memory.execute('pragma integrity_check')] == ['ok'], 'sqlite: integrity')
    return closing(memory)


def geometry(blob):
    require(blob[:3] == b'GP\x00' and blob[3] & 0xf0 == 0, 'geometry: GeoPackage header')
    order = '<' if blob[3] & 1 else '>'
    require(struct.unpack_from(order+'i', blob, 4)[0] == 4326, 'geometry: header SRS')
    envelope = (blob[3] >> 1) & 7
    require(envelope <= 4, 'geometry: envelope code')
    start = 8 + [0, 32, 48, 48, 64][envelope]

    def wkb(offset):
        require(blob[offset] in (0, 1), 'geometry: WKB byte order')
        endian = '<' if blob[offset] else '>'
        kind = struct.unpack_from(endian+'I', blob, offset+1)[0]
        offset += 5

        def count():
            nonlocal offset
            n = struct.unpack_from(endian+'I', blob, offset)[0]
            offset += 4
            return n

        def point():
            nonlocal offset
            xy = list(struct.unpack_from(endian+'dd', blob, offset))
            offset += 16
            require(all(math.isfinite(v) for v in xy) and -180 <= xy[0] <= 180 and -90 <= xy[1] <= 90, 'geometry: finite lon lat')
            return xy

        if kind == 1:
            coords = point()
        elif kind == 2:
            coords = [point() for _ in range(count())]
            require(len(coords) >= 2, 'geometry: line vertices')
        elif kind == 3:
            coords = [[point() for _ in range(count())] for _ in range(count())]
            require(coords and all(len(r) >= 4 and r[0] == r[-1] for r in coords), 'geometry: closed rings')
        elif kind == 6:
            coords = []
            for _ in range(count()):
                child_kind, child, offset = wkb(offset)
                require(child_kind == 3, 'geometry: multipolygon children')
                coords.append(child)
        else:
            raise AssertionError('geometry: unsupported WKB')
        return kind, coords, offset

    kind, coords, end = wkb(start)
    require(end == len(blob), 'geometry: complete WKB')
    return kind, coords


def flatten(coords):
    return [coords] if isinstance(coords[0], (float, int)) else [xy for child in coords for xy in flatten(child)]


def jurisdiction(j, state):
    require(sha(canonical({k:v for k,v in j.items() if k != 'payloadSha256'}).encode()) == j['payloadSha256'], 'jurisdiction: canonical checksum')
    require((j['schema'], j['scope'], j['registryVersion'], j['registrySha256']) == ('openplan.project-jurisdiction-readiness-export.v3', 'external_handoff', '2026-10-11.1', REGISTRY_SHA), 'jurisdiction: schema registry scope')
    if state == 'legacy':
        require(j['context'] is None and j['contextSource'] == 'legacy_study_place' and len(j['entries']) == 1 and j['entries'][0]['declaration'] is None and j['entries'][0]['administrativeGuidance'] is None and j['entries'][0]['assessmentScope'] == 'legacy study-place context' and 'Adopting authority and legal applicability remain unresolved.' in j['disclosure'], 'jurisdiction: legacy study only')
    else:
        require(j['contextSource'] == 'project_declaration' and j['context']['schema'] == 'openplan.project-jurisdiction-context-export.v1', 'jurisdiction: explicit source')
        if state == 'unresolved':
            require(j['context']['state'] == 'unresolved' and j['context']['entries'] == [] and j['entries'] == [], 'jurisdiction: unresolved no fallback')
        else:
            require(j['context']['state'] == 'declared' and len(j['entries']) == len(j['context']['entries']) == 2, 'jurisdiction: declared count')
            for e, d, scope in zip(j['entries'], j['context']['entries'], ['sovereign', 'overlap']):
                expected = {'label': 'Synthetic '+('sovereign' if scope == 'sovereign' else 'overlapping')+' context, unverified', 'countryCode': 'US', 'subdivisionCode': 'US-CA', 'kind': 'synthetic '+scope+' fixture', 'reference': 'staff:qa-'+scope+'-v6', 'scope': scope, 'identity': 'staff_declared'}
                require(d == expected and e['declaration'] == d, 'jurisdiction: exact unverified declarations')
                a = e['assessment']
                unresolved = {'id': None, 'label': d['label'], 'country': None, 'subdivision': None, 'assessmentKind': None}
                require(e['administrativeGuidance'] is None and e['assessmentScope'] == 'Unverified staff declaration; jurisdiction-specific support is unassessed' and a['jurisdiction'] == unresolved and len(a['reports']) == 5 and all(r['status'] == 'unassessed' and r['jurisdiction'] == unresolved and not r['authorities'] and not r['adapterIds'] and not r['sources'] for r in a['reports']), 'jurisdiction: no authority promotion')
        require('Resolved identity does not establish adopting authority or legal applicability.' in j['disclosure'], 'jurisdiction: authority disclosure')
    for e in j['entries']:
        a = e['assessment']
        require(a['registryVersion'] == j['registryVersion'] and a['registrySha256'] == j['registrySha256'] and all(r['registryVersion'] == j['registryVersion'] and r['registrySha256'] == j['registrySha256'] for r in a['reports']), 'jurisdiction: nested registry parity')


def inspect_pair(directory, state, secrets):
    jname, gname = PAIRS[state]
    j = json.loads((directory/jname).read_text())
    jurisdiction(j, state)
    with read_package(directory/gname) as c:
        require(c.execute('pragma application_id').fetchone()[0] == 0x47504b47 and c.execute('pragma user_version').fetchone()[0] == 10400 and not c.execute('pragma foreign_key_check').fetchall(), 'metadata: application version foreign keys')
        tables = {r[0] for r in c.execute("select name from sqlite_master where type='table'")}
        require(tables == set(FEATURES) | ATTRIBUTES | {'gpkg_spatial_ref_sys', 'gpkg_contents', 'gpkg_geometry_columns'}, 'metadata: required tables')
        contents = {r['table_name']: dict(r) for r in c.execute('select * from gpkg_contents')}
        cols = {r['table_name']: dict(r) for r in c.execute('select * from gpkg_geometry_columns')}
        require(set(contents) == set(FEATURES) | ATTRIBUTES and set(cols) == set(FEATURES) and c.execute('select organization,organization_coordsys_id from gpkg_spatial_ref_sys where srs_id=4326').fetchone()[:] == ('EPSG', 4326), 'metadata: registrations EPSG')
        for t, kind in FEATURES.items():
            require((contents[t]['data_type'], contents[t]['srs_id'], cols[t]['column_name'], cols[t]['geometry_type_name'], cols[t]['srs_id'], cols[t]['z'], cols[t]['m']) == ('features', 4326, 'geom', kind, 4326, 0, 0), 'metadata: geometry registrations')
        require(all(contents[t]['data_type'] == 'attributes' and contents[t]['srs_id'] is None for t in ATTRIBUTES), 'metadata: attribute registrations')
        require(all(c.execute(f'select count(*) from "{t}"').fetchone()[0] == 1 for t in ATTRIBUTES - {'openplan_layer_status'}), 'metadata: singleton manifests')
        info = dict(c.execute('select * from project_info').fetchone())
        require((info['crs'], info['project_area_coverage'], info['project_location_coverage'], info['corridor_count'], info['omitted_corridor_count']) == ('EPSG:4326 (WGS 84 longitude/latitude)', 'Project area included', 'Project location included', 1, 0) and 'every expected layer is disclosed' in info['coverage_limits'], 'metadata: manifest coverage')
        result = {}
        for table in FEATURES:
            rows = c.execute(f'select * from "{table}"').fetchall()
            require(len(rows) == (1 if table.startswith('project_') else 0), 'geometry: feature counts')
            if not rows:
                continue
            row = rows[0]
            require(row['project_id'] == j['projectId'], 'parity: feature lineage')
            blob = row['geom']
            kind, coords = geometry(blob)
            xy = flatten(coords)
            bounds = [min(p[0] for p in xy), min(p[1] for p in xy), max(p[0] for p in xy), max(p[1] for p in xy)]
            require(bounds == [contents[table][k] for k in ('min_x','min_y','max_x','max_y')], 'metadata: geometry extents')
            if table == 'project_area':
                require(kind in (3, 6) and sha(blob) == AREA_SHA, 'geometry: exact retained area including holes')
                polygons = [coords] if kind == 3 else coords
                rings = [[len(r) for r in polygon] for polygon in polygons]
            elif table == 'project_location':
                require(kind == 1 and coords == POINT, 'geometry: exact saved point')
                rings = None
            else:
                require(kind == 2 and coords == LINE, 'geometry: exact saved line')
                require((row['corridor_name'],row['corridor_type'],row['los_grade']) == ('Synthetic QA display line; not a model network', 'arterial', None), 'geometry: saved line attributes')
                rings = None
            result[table] = {'sha256': sha(blob), 'wkb_type': kind, 'vertices': len(xy), 'bounds': bounds, 'polygon_ring_vertex_counts': rings}
        statuses = {r['layer_key']: (r['status'],r['record_count']) for r in c.execute('select * from openplan_layer_status')}
        expected = {('crash_ksi' if t == 'safety_crash_ksi' else t): (('included',1) if t.startswith('project_') else ('unavailable',None)) for t in FEATURES}
        require(statuses == expected, 'metadata: unavailable stays nonnumeric')
        require([r[1] for r in c.execute('pragma table_info(engagement_geometry)')] == ['fid','geom','engagement_item_id','source_type','created_at','moderation_status'], 'privacy: geometry only engagement schema')
        manifest = c.execute('select * from project_jurisdiction_context').fetchone()
        require(manifest['readiness_payload_json'] == canonical(j) and manifest['jurisdiction_context_json'] == canonical(j['context']), 'parity: embedded canonical payload context')
        require((manifest['project_id'],manifest['project_revision'],manifest['scope'],manifest['readiness_schema'],manifest['registry_version'],manifest['registry_sha256'],manifest['payload_sha256']) == (j['projectId'],j['projectRevision'],'legacy study-place context only' if state == 'legacy' else 'independent human declaration',j['schema'],j['registryVersion'],j['registrySha256'],j['payloadSha256']) and info['project_id'] == j['projectId'] and info['project_updated_at'] == j['projectRevision'], 'parity: manifest identity revision source hash')
        corpus = [(directory/jname).read_bytes(), (directory/gname).read_bytes()]
        for table in tables:
            corpus.extend(str(v).encode() for row in c.execute(f'select * from "{table}"') for v in row if isinstance(v,str))
        raw = b'\n'.join(corpus)
        require(not any(field in raw.lower() for field in (b'created_by',b'recordedby',b'recorded_by',b'submitted_by',b'moderation_notes')), 'privacy: internal actor fields')
        require(not any(s.encode() in raw for s in secrets), 'privacy: known fixture accounts')
    return {'revision': j['projectRevision'], 'payload_sha256': j['payloadSha256'], 'context_source': j['contextSource'], 'context_state': None if j['context'] is None else j['context']['state'], 'entries': len(j['entries']), 'geometries': result, 'engagement_rows': 0}, (info['project_id'],info['workspace_id'])


def inspect(directory, secrets):
    result, lineage = {}, []
    for state in PAIRS:
        result[state], identity = inspect_pair(directory,state,secrets)
        lineage.append(identity)
    require(len(set(lineage)) == 1, 'parity: same project workspace')
    require(result['legacy']['geometries'] == result['unresolved']['geometries'] == result['declared']['geometries'], 'geometry: identical all three snapshots')
    return result


def edit_sql(directory, sql, params=()):
    with sqlite3.connect(directory/PAIRS['unresolved'][1]) as c:
        c.execute(sql,params)


def edit_json(directory, state, change, rehash=True):
    path = directory/PAIRS[state][0]
    j = json.loads(path.read_text())
    change(j)
    if rehash:
        j['payloadSha256'] = sha(canonical({k:v for k,v in j.items() if k != 'payloadSha256'}).encode())
    path.write_text(json.dumps(j,indent=3)+'\n')


def main():
    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    before = hashes(DOWNLOADS)
    require(all(before[n]['sha256'] == pin for n,pin in PINS.items()), 'custody: frozen input hashes')
    require({n:v for n,v in before.items() if n != 'inventory.json'} == json.loads((DOWNLOADS/'inventory.json').read_text()), 'custody: frozen inventory sizes hashes')
    require(sha(ATTEST.read_bytes()) == '1700d98c21249705d1eb6c355a2151799c9e05a4db8598144beff5abc49f1fb7', 'custody: parent strict attestation')
    fixture = json.loads(FIXTURE.read_text())
    secrets = [v for a in fixture['accounts'].values() for k,v in a.items() if k in ('id','email','password','accessToken') and isinstance(v,str) and v]
    require(len(fixture['accounts']) == 3 and len(secrets) >= 9, 'privacy: fixture coverage')
    del fixture
    baseline = inspect(DOWNLOADS,secrets)
    failed_trial = json.loads((DOWNLOADS/'declared-jurisdictions.json').read_text())
    require([e['scope'] for e in failed_trial['context']['entries']] == ['sovereign','sovereign'], 'custody: retained failed fixture distinct')
    copies = PRIVATE/'control-copies'
    copies.mkdir(mode=0o700,exist_ok=True)
    controls = []

    def restore():
        for n in PINS:
            shutil.copyfile(DOWNLOADS/n,copies/n)
            (copies/n).chmod(0o600)

    def trial(name, mutate, expected='SURVIVED'):
        restore()
        try:
            mutate(copies)
            try:
                inspect(copies,secrets)
                observed = 'SURVIVED'
            except AssertionError as error:
                observed = str(error)
            require(observed == expected, 'control: unexpected '+name+': '+observed)
            controls.append({'name':name,'outcome':observed})
        finally:
            restore()
            require(hashes(copies) == before, 'control: exact restoration')

    trial('harmless JSON whitespace', lambda d: edit_json(d,'unresolved',lambda j:None))
    def bad_integrity(d):
        with sqlite3.connect(d/PAIRS['unresolved'][1]) as c:
            c.execute('pragma ignore_check_constraints=on')
            c.execute("update openplan_layer_status set status='broken' where layer_key='crash_ksi'")
    trial('stored CHECK violation',bad_integrity,'sqlite: integrity')
    trial('missing manifest table',lambda d:edit_sql(d,'drop table project_info'),'metadata: required tables')
    trial('wrong feature SRS',lambda d:edit_sql(d,"update gpkg_geometry_columns set srs_id=0 where table_name='project_location'"),'metadata: geometry registrations')
    trial('manifest omission count',lambda d:edit_sql(d,'update project_info set omitted_corridor_count=1'),'metadata: manifest coverage')
    trial('unavailable replaced with zero',lambda d:edit_sql(d,"update openplan_layer_status set record_count=0 where layer_key='crash_ksi'"),'metadata: unavailable stays nonnumeric')
    def moved_point(d):
        blob = b'GP\x00\x01'+struct.pack('<i',4326)+b'\x01'+struct.pack('<I',1)+struct.pack('<dd',-122.2712,37.8044)
        edit_sql(d,'update project_location set geom=?',(blob,))
        edit_sql(d,"update gpkg_contents set min_x=-122.2712,max_x=-122.2712 where table_name='project_location'")
    trial('point shifted with matching extent',moved_point,'geometry: exact saved point')
    def reversed_line(d):
        blob = b'GP\x00\x01'+struct.pack('<i',4326)+b'\x01'+struct.pack('<II',2,3)+b''.join(struct.pack('<dd',*xy) for xy in reversed(LINE))
        edit_sql(d,'update project_corridors set geom=?',(blob,))
    trial('line vertex order reversed',reversed_line,'geometry: exact saved line')
    def missing_hole(d):
        with read_package(d/PAIRS['unresolved'][1]) as c:
            blob = c.execute('select geom from project_area').fetchone()[0]
        kind, coords = geometry(blob)
        require(kind == 3 and len(coords) == 2,'control: area polygon with one hole')
        # Keep the complete exterior and its extent, while deleting the hole.
        wkb = b'\x01'+struct.pack('<II',3,1)
        for ring in coords[:1]:
            wkb += struct.pack('<I',len(ring))+b''.join(struct.pack('<dd',*xy) for xy in ring)
        edit_sql(d,'update project_area set geom=?',(b'GP\x00\x01'+struct.pack('<i',4326)+wkb,))
    trial('area hole deleted without extent loss',missing_hole,'geometry: exact retained area including holes')
    trial('checksum corruption',lambda d:edit_json(d,'unresolved',lambda j:j.update(disclosure='changed'),False),'jurisdiction: canonical checksum')
    trial('explicit unresolved gains legacy source',lambda d:edit_json(d,'unresolved',lambda j:j.update(contextSource='legacy_study_place')),'jurisdiction: explicit source')
    trial('failed fixture substituted as corrected',lambda d:shutil.copyfile(d/'declared-jurisdictions.json',d/PAIRS['declared'][0]),'jurisdiction: exact unverified declarations')
    def promoted(d):
        def change(j):
            j['entries'][0]['assessment']['reports'][0]['status']='supported'
        edit_json(d,'declared',change)
    trial('US-CA staff declaration support promoted',promoted,'jurisdiction: no authority promotion')
    trial('embedded JSON replaced',lambda d:edit_sql(d,"update project_jurisdiction_context set readiness_payload_json='{}'"),'parity: embedded canonical payload context')
    trial('embedded revision changed',lambda d:edit_sql(d,"update project_jurisdiction_context set project_revision='other'"),'parity: manifest identity revision source hash')
    trial('actor field inserted',lambda d:edit_sql(d,'alter table engagement_geometry add column submitted_by text'),'privacy: geometry only engagement schema')
    trial('known fixture identity inserted',lambda d:edit_sql(d,'update project_info set project_summary=?',(secrets[0],)),'privacy: known fixture accounts')
    restored = inspect(copies,secrets)
    require(restored == baseline and hashes(DOWNLOADS) == before,'custody: restored baseline originals unchanged')
    output = {'inputs_before':before,'inputs_after':hashes(DOWNLOADS),'originals_unchanged':True,'findings':baseline,'controls':controls,'copies_restored':True,'fixture_account_sets_checked':3,'retained_failed_trial':{'file':'declared-jurisdictions.json','scopes':['sovereign','sovereign'],'accepted_pair':False},'sqlite_version':sqlite3.sqlite_version,'checker_sha256':sha(Path(__file__).read_bytes())}
    path = PRIVATE/'results.json'
    path.write_text(json.dumps(output,indent=2)+'\n')
    path.chmod(0o600)
    print(json.dumps({'pairs':3,'originals_unchanged':True,'harmless_survivors':1,'targeted_faults_detected':len(controls)-1,'copies_restored':True,'private_results':str(path)}))


if __name__ == '__main__':
    main()
