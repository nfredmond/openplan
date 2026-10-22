"""Compare actual browser-delivered bytes and decoded project geometry."""
import hashlib,json,os,shutil,sqlite3,struct,subprocess
from pathlib import Path
os.umask(0o077);base=Path(__file__).parent;original=base/'project-geography-export.gpkg';copy=base/'project-export-control-private.gpkg';shutil.copyfile(original,copy);copy.chmod(0o600);saved=copy.read_bytes();rows=[]
BYTE_SHA='e042bdcbf5ea9f194951828b3da3a2d1dead3ba850b65a4b1affa174d76c340f';GEOMETRY_SHA='007c5ce9a3bea160193427fe1e6f769c33c239b3b448cd9e40ab623d9acdd8fd'
def bytes_match(path):
 assert hashlib.sha256(path.read_bytes()).hexdigest()==BYTE_SHA,'Browser-delivered project export bytes differ'
def geometry_match(path):
 data=json.loads(subprocess.check_output(['ogr2ogr','-f','GeoJSON','/vsistdout/',str(path),'project_area']));assert len(data['features'])==1,'Project export must retain one original area';g=data['features'][0]['geometry'];payload=json.dumps({'type':g['type'],'coordinates':g['coordinates']},separators=(',',':')).encode();assert hashlib.sha256(payload).hexdigest()==GEOMETRY_SHA,'Decoded project export geometry differs from actual coverage input'
def check(label,fn,reason=None):
 try:fn(copy)
 except AssertionError as e:
  assert reason and str(e)==reason,(label,str(e));rows.append({'case':label,'outcome':'intended_failure','reason':reason})
 else:
  assert reason is None,(label,'broken case survived');rows.append({'case':label,'outcome':'survived'})
try:
 check('bytes-baseline',bytes_match);check('geometry-baseline',geometry_match);os.utime(copy,(1234567890,1234567890));check('bytes-harmless-timestamp',bytes_match);check('geometry-harmless-timestamp',geometry_match)
 copy.write_bytes(saved+b'changed transferred bytes');check('changed-byte-control',bytes_match,'Browser-delivered project export bytes differ');copy.write_bytes(saved)
 # Translate the complete valid polygon, preserving rings and the GPKG envelope.
 c=sqlite3.connect(copy);blob=bytearray(c.execute('SELECT geom FROM project_area').fetchone()[0]);assert blob[:2]==b'GP';header_endian='<' if blob[3]&1 else '>';envelope=(blob[3]>>1)&7;size={0:0,1:32,2:48,3:48,4:64}[envelope]
 if size:
  for offset in [8,16]:struct.pack_into(header_endian+'d',blob,offset,struct.unpack_from(header_endian+'d',blob,offset)[0]+.001)
 offset=8+size;endian='<' if blob[offset] else '>';assert struct.unpack_from(endian+'I',blob,offset+1)[0]==3;rings=struct.unpack_from(endian+'I',blob,offset+5)[0];offset+=9
 for _ in range(rings):
  count=struct.unpack_from(endian+'I',blob,offset)[0];offset+=4
  for _ in range(count):struct.pack_into(endian+'d',blob,offset,struct.unpack_from(endian+'d',blob,offset)[0]+.001);offset+=16
 assert offset==len(blob);c.execute('UPDATE project_area SET geom=?',(bytes(blob),));c.execute("UPDATE gpkg_contents SET min_x=min_x+.001,max_x=max_x+.001 WHERE table_name='project_area'");c.commit();c.close();check('valid-translated-geometry',geometry_match,'Decoded project export geometry differs from actual coverage input')
finally:copy.write_bytes(saved)
check('bytes-restored',bytes_match);check('geometry-restored',geometry_match);assert original.read_bytes()==saved
c=sqlite3.connect('file:'+str(original)+'?mode=ro',uri=True);assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';statuses=[{'layer':a,'status':b,'count':n} for a,b,n in c.execute('SELECT layer_key,status,record_count FROM openplan_layer_status')];c.close()
result={'controls':rows,'byteSha256':BYTE_SHA,'geometrySha256':GEOMETRY_SHA,'sqliteIntegrity':'ok','layerStatuses':statuses,'originalUnchanged':True,'scope':'Native GDAL/SQLite checks on one synthetic project export. No native GUI, planner acceptance, map drawing, independent installation or scientific acceptance.'};(base/'project-export-controls.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'controls':len(rows),'originalUnchanged':True,'sqliteIntegrity':'ok'}))
