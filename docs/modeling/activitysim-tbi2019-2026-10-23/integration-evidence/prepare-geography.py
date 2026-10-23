"""Prepare source geography and a conservative MVTA home-area zone mask."""
import csv,json,sys,hashlib
from pathlib import Path
import geopandas as gpd
sys.path.insert(0,'scripts/modeling')
ROOT=Path('data/_screening_cache/tbi2019-integration');EVIDENCE=Path('docs/modeling/activitysim-tbi2019-2026-10-23/integration-evidence')
zones=list(csv.DictReader(Path('docs/modeling/activitysim-transit-2026-10-23/zones.csv').open()))
tracts=gpd.read_file((ROOT/'tracts-2019.response').read_bytes()).set_index('GEOID').loc[[z['GEOID'] for z in zones]].to_crs(4326)
places=gpd.read_file((ROOT/'places-2019.response').read_bytes()).to_crs(4326)
names=['Apple Valley','Burnsville','Eagan','Prior Lake','Rosemount','Savage','Shakopee']
selected=places[places.NAME.isin(names)]
assert set(selected.NAME)==set(names)
mask=selected.geometry.union_all()
tracts.to_file(ROOT/'study-tracts.geojson',driver='GeoJSON')
selected.to_file(ROOT/'mvta-member-cities.geojson',driver='GeoJSON')
gpd.GeoDataFrame({'name':['seven-county footprint']},geometry=[tracts.geometry.union_all()],crs=4326).to_file(ROOT/'boundary.geojson',driver='GeoJSON')
# Any positive-area overlap is excluded. A centroid outside a city cannot hide an intersecting tract.
projected=tracts.to_crs(26915);mask_projected=selected.to_crs(26915).geometry.union_all()
excluded=[]
for z in zones:
 geom=projected.loc[z['GEOID']].geometry
 overlap=geom.intersection(mask_projected).area
 if overlap>0:
  excluded.append({'zone_id':int(z['zone_id']),'GEOID':z['GEOID'],'reason':'mvta_member_city_overlap_service_missing','overlap_square_meters':overlap})
raw=json.loads((ROOT/'acs-controls.json').read_text())
rows=[]
for z in zones:
 g=z['GEOID'];r=raw[g]
 rows.append({**z,'zone_kind':'internal','area_sq_mi':float(projected.loc[g].geometry.area)/2589988.110336,
  'est_population':r['B01003_001E'],'est_households':r['B11001_001E'],'est_workers':r['B23025_004E'],
  'median_income':r['B19013_001E']})
with (ROOT/'zone_attributes.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
report={'source':'MVTA 2020 audited financial report, government profile and service area; historical membership statement; TIGER2019 place and tract geometry','member_cities':names,'zones_total':len(zones),'zones_excluded':len(excluded),'zones_remaining':len(zones)-len(excluded),'zone_exclusions':excluded,'survey_records_excluded_for_mvta':None,'survey_reason':'Frozen roster has county only; endpoint dependence cannot be computed without prohibited outcome fields. Member-area mask does not identify all trips using MVTA outside its member cities.','drive_transit':{'status':'unavailable','reason':'No verified park-and-ride to highway-node and GTFS-stop crosswalk yet','connectors':0}}
(EVIDENCE/'coverage.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='zone_exclusions'},indent=2))
