"""Historical input-only road network and free-flow skims. No demand assignment."""
import sys,json,hashlib,datetime,platform,importlib.metadata
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import geopandas as gpd
import pandas as pd
import requests
import screening_runtime as runtime
from aequilibrae.project.network.osm.osm_downloader import OSMDownloader
ROOT=Path('data/_screening_cache/tbi2019-integration')
OUT=ROOT/'highway-get'
OUT.mkdir(exist_ok=False)
(OUT/'sources').mkdir()
records=[]
# Supply the historical date only in this study process. Installed code and defaults stay unchanged.
def historical_request(self,data,**kwargs):
 query=data['data'].replace('[out:json]','[out:json][date:"2019-10-08T12:00:00Z"]',1)
 index=len(records)
 path=OUT/'sources'/f'overpass-{index:03d}.json'
 (OUT/'sources'/f'overpass-{index:03d}.query').write_text(query)
 url='https://overpass-api.de/api/interpreter'
 response=requests.get(url,params={'data':query},timeout=540,headers={'User-Agent':'OpenPlan-input-research/1.0 (github.com/nfredmond/openplan)'})
 path.write_bytes(response.content)
 record={'url':url,'query':query,'http_status':response.status_code,'sha256':hashlib.sha256(response.content).hexdigest(),'bytes':len(response.content),'path':str(path),'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 records.append(record);(OUT/'source-manifest.json').write_text(json.dumps(records,indent=2)+'\n')
 response.raise_for_status();payload=response.json()
 if payload.get('remark'):raise RuntimeError('Overpass incomplete response: '+payload['remark'])
 return payload
OSMDownloader.overpass_request=historical_request
boundary=gpd.read_file(ROOT/'boundary.geojson').geometry.iloc[0]
zones=pd.read_csv(ROOT/'zone_attributes.csv',dtype={'GEOID':str})
network,zones=runtime.build_network(OUT,boundary,zones,2.0)
network['historical_osm_timestamp']='2019-10-08T12:00:00Z'
network['historical_limit']='OSM database state, not independently verified road opening dates or measured period speeds'
(OUT/'network.json').write_text(json.dumps(network,indent=2)+'\n')
zones.to_csv(OUT/'zone_attributes.with-gateways.csv',index=False)
# Only internal study centroids enter the ActivitySim skim, preserving the 704-zone order.
centroids={int(k):v for k,v in network['centroid_map'].items() if int(k)<=len(zones[zones.zone_kind=='internal'])}
skims=runtime.compute_freeflow_skims(Path(network['project_dir']),centroids,OUT/'run_output')
summary={k:v for k,v in skims.items() if k not in {'matrix','distance_matrix'}}
summary.update(python=platform.python_version(),versions={p:importlib.metadata.version(p) for p in ['aequilibrae','numpy','pandas','geopandas']})
(OUT/'skim-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary),flush=True)
