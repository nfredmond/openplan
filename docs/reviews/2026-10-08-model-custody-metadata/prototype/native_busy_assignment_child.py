"""Bounded synthetic native assignment for process-lifetime evidence, not accuracy."""
import importlib,json,os,sys,time
from pathlib import Path
from importlib.metadata import version
import numpy as np
import pandas as pd
from aequilibrae.paths import Graph,TrafficClass,TrafficAssignment
from aequilibrae.matrix import AequilibraeMatrix

out=Path(sys.argv[1]);width=120;zones=2400
nodes=np.arange(1,width*width+1,dtype=np.int64).reshape(width,width)
a=np.concatenate((nodes[:,:-1].ravel(),nodes[:-1,:].ravel()))
b=np.concatenate((nodes[:,1:].ravel(),nodes[1:,:].ravel()))
graph=Graph()
graph.network=pd.DataFrame({'link_id':np.arange(1,len(a)+1,dtype=np.int64),'a_node':a,'b_node':b,
    'direction':np.zeros(len(a),dtype=np.int64),'time':np.ones(len(a),dtype=np.float64),'capacity':np.full(len(a),10000.0)})
centroids=np.arange(1,zones+1,dtype=np.int64)
graph.prepare_graph(centroids,remove_dead_ends=False);graph.set_graph('time');graph.set_blocked_centroid_flows(False)
matrix=AequilibraeMatrix();matrix.create_empty(zones=zones,matrix_names=['synthetic'],memory_only=True)
matrix.index[:]=centroids;matrix.matrix['synthetic'][:,:]=1.0;np.fill_diagonal(matrix.matrix['synthetic'],0)
matrix.computational_view(['synthetic'])
traffic=TrafficClass('synthetic',graph,matrix)
assignment=TrafficAssignment();assignment.set_classes([traffic]);assignment.set_vdf('BPR')
assignment.set_vdf_parameters({'alpha':0.15,'beta':4.0});assignment.set_capacity_field('capacity');assignment.set_time_field('time')
assignment.set_algorithm('all-or-nothing');assignment.set_cores(1)
aon=importlib.import_module('aequilibrae.paths.all_or_nothing');native=aon.one_to_all
calls=0;started=time.monotonic()
def observed(*args,**kwargs):
    global calls
    result=native(*args,**kwargs);calls+=1
    if calls%10==0:
        pending=out/'progress.tmp';pending.write_text(json.dumps({'completed_native_calls':calls,'elapsed':time.monotonic()-started}))
        pending.replace(out/'progress.json')
    return result
aon.one_to_all=observed
(out/'native-ready').touch()
try:
    assignment.execute()
    total=float(assignment.results()['PCE_tot'].sum())
    assert calls==zones and total>0
    (out/'native-complete.json').write_text(json.dumps({'completed_native_calls':calls,'positive_loaded_flow':True,'aequilibrae':version('aequilibrae'),
        'nodes':width*width,'zones':zones,'links':len(a),'elapsed':time.monotonic()-started}))
finally:matrix.close()
