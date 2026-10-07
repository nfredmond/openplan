"""Independent ZIP and SQLite inspection with surviving and rejected artifact mutations."""
from pathlib import Path, PurePosixPath
import hashlib, io, json, sqlite3, struct, zipfile
base=Path(__file__).resolve().parent
original=(base/'planning-synthetic.zip').read_bytes()
def inspect(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names=archive.namelist()
        assert len(names)==len(set(names)), 'duplicate ZIP entry'
        for name in names:
            path=PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in name, 'unconfined ZIP path'
        assert archive.testzip() is None, 'ZIP CRC failure'
        for line in archive.read('checksums.sha256').decode().splitlines():
            digest,name=line.split('  ',1)
            assert hashlib.sha256(archive.read(name)).hexdigest()==digest, f'checksum mismatch: {name}'
        manifest=json.loads(archive.read('manifest.json'))
        for entry in manifest['entries']:
            if entry['path']:
                assert hashlib.sha256(archive.read(entry['path'])).hexdigest()==entry['checksumSha256'], 'manifest hash mismatch'
        assert manifest['approvalOrPublication'] is False
        assert manifest['currentBoardOrReportPdf'] is None
        project=json.loads(archive.read('project/project.json'))
        assert project['name']=='SYNTHETIC Café 道路 🚲', 'Unicode content changed'
        db=sqlite3.connect(':memory:')
        try:
            db.deserialize(archive.read('project/project.gpkg'))
            assert db.execute('PRAGMA application_id').fetchone()[0]==0x47504b47
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert db.execute('SELECT count(*) FROM project_area').fetchone()[0]==1
            assert db.execute('SELECT count(*) FROM project_location').fetchone()[0]==1
            assert db.execute('SELECT count(*) FROM project_corridors').fetchone()[0]==1
            assert db.execute('SELECT omitted_corridor_count FROM project_info').fetchone()[0]==1
            statuses=db.execute('SELECT layer_key,status,record_count FROM openplan_layer_status ORDER BY layer_key').fetchall()
            assert all(count is None for key,status,count in statuses if status=='unavailable'), 'unavailable treated as zero'
            assert any(key=='activitysim_links' and status=='unavailable' for key,status,count in statuses)
            assert any(key=='aequilibrae_links' and status=='unavailable' for key,status,count in statuses)
            blob=db.execute('SELECT geom FROM project_location').fetchone()[0]
            assert blob[:2]==b'GP'
            assert struct.unpack('<i',blob[4:8])[0]==4326
            envelope=(blob[3]>>1)&7
            offset=8+{0:0,1:32,2:48,3:48,4:64}[envelope]
            endian='<' if blob[offset]==1 else '>'
            assert struct.unpack(endian+'I',blob[offset+1:offset+5])[0]==1
            xy=struct.unpack(endian+'dd',blob[offset+5:offset+21])
            assert xy==(-82.9988,39.9612),f'coordinate meaning changed: {xy}'
            return {'entries':names,'statusRows':statuses,'pointLongitudeLatitude':xy,'omittedInvalidCorridors':1,'sqliteIntegrity':'ok','hashesMatch':True,'unicodePreserved':True}
        finally: db.close()
def rewrite(changed=False):
    output=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as source,zipfile.ZipFile(output,'w') as target:
        target.comment=b'Harmless independent review ZIP comment'
        for info in source.infolist():
            value=source.read(info.filename)
            if changed and info.filename=='project/project.json': value=value.replace(b'SYNTHETIC',b'CORRUPTED')
            target.writestr(info,value)
    return output.getvalue()
record=inspect(original)
inspect(rewrite())
record['harmlessZipCommentSurvived']=True
try: inspect(rewrite(True))
except AssertionError as error:
    assert str(error)=='checksum mismatch: project/project.json',str(error)
    record['alteredProjectBytesRejected']=str(error)
else: raise AssertionError('Altered project bytes survived checksum verification')
(base/'planning-artifact-inspection.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
