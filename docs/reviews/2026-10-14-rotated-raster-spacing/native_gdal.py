"""Compare parser spacing with independently decoded GDAL pixel positions."""
import argparse,hashlib,json,math,os,subprocess,sys
from pathlib import Path

def run(repo,out,epsg):
 os.umask(0o077);out.mkdir(mode=0o700);sys.path.insert(0,str(repo/'workers/odm_worker'));import georef
 environment={**os.environ,'PROJ_NETWORK':'OFF','GDAL_PAM_ENABLED':'NO'}
 cases=[('rotated',3,4,4,-3),('quarter-turn',0,-2,3,0),('sheared',2,1,0,3),('reflected',-3,-4,-4,3),('axis-aligned',.05,0,0,-.1),('asymmetric',3,4,12,-5)];rows=[]
 for label,a,b,e,f in cases:
  source=out/(label+'.vrt');target=out/(label+'.tif');source.write_text('<VRTDataset rasterXSize="2" rasterYSize="2"><SRS>EPSG:'+str(epsg)+'</SRS><GeoTransform>0,'+str(a)+','+str(b)+',0,'+str(e)+','+str(f)+'</GeoTransform><VRTRasterBand dataType="Byte" band="1"/></VRTDataset>')
  created=subprocess.run(['gdal_translate','-q','-of','GTiff',str(source),str(target)],capture_output=True,env=environment,timeout=30);(out/(label+'-create.log')).write_bytes(created.stdout+created.stderr);assert created.returncode==0,'GDAL must create the declared fixture: '+label
  points=subprocess.run(['gdaltransform',str(target)],input=b'0 0\n1 0\n0 1\n',capture_output=True,env=environment,timeout=30);(out/(label+'-positions.log')).write_bytes(points.stdout+points.stderr);assert points.returncode==0,'GDAL must independently decode native pixel positions: '+label
  coordinates=[tuple(float(x) for x in line.split()[:2]) for line in points.stdout.decode().splitlines()];assert len(coordinates)==3
  expected=(math.dist(coordinates[0],coordinates[1]),math.dist(coordinates[0],coordinates[2]));parsed=georef.parse_geotiff(target);assert parsed['epsg']==epsg and parsed['width']==parsed['height']==2
  for actual,wanted in zip(parsed['pixel_size'],expected):assert math.isclose(actual,wanted,rel_tol=1e-12,abs_tol=1e-12),'Parser must match independent GDAL native vector lengths: '+label
  rows.append({'case':label,'epsg':epsg,'fileBytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'gdalNativeStepLengths':expected,'parserNativeStepLengths':parsed['pixel_size'],'scope':'synthetic_native_tag_and_vector_arithmetic','surveyAccuracy':'unassessed'})
 result={'gdalVersion':subprocess.check_output(['gdal_translate','--version']).decode().strip(),'cases':rows,'sourceSha256':hashlib.sha256((repo/'workers/odm_worker/georef.py').read_bytes()).hexdigest(),'scientificAcceptance':False};(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'nativeCases':len(rows),'gdalVersion':result['gdalVersion']}),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--epsg',type=int,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve(),a.epsg)
