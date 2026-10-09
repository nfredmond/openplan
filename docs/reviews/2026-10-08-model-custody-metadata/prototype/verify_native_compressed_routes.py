"""Compare native compressed assignment with independent source-graph routing.

Synthetic, fixed-cost transformation evidence only. No observed accuracy claim.
Run in a process with OPENBLAS_NUM_THREADS=1 and OMP_NUM_THREADS=1.
"""
import hashlib
import heapq
import json
import os
import sys
from pathlib import Path
from importlib.metadata import version
from importlib.util import find_spec

sys.path.insert(0,str(Path(__file__).resolve().parents[4]/'workers/aequilibrae_worker'))
from model_assignment_compact_graph import verify as verify_compact

import numpy as np
import pandas as pd
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths.graph import Graph
from aequilibrae.paths.results import AssignmentResults
from aequilibrae.paths.all_or_nothing import allOrNothing
from aequilibrae.paths.cython.AoN import aggregate_link_costs

# link ID, original endpoints, direction, time, allowed modes.
LINKS=[(1,1,10,0,2.,'c'),(2,10,11,0,3.,'c'),(3,11,2,0,4.,'c'),
       (4,2,12,0,1.,'c'),(5,12,3,0,1.,'c'),(6,1,13,0,6.,'c'),
       (7,13,3,0,7.,'c'),(8,10,14,0,.5,'c'),(9,11,13,1,9.,'c'),
       (10,1,3,0,.1,'w'),(11,2,3,1,1.5,'c')]
CENTROIDS=[1,2,3]
DEMAND=np.array([[0.,5.,7.],[11.,0.,13.],[17.,19.,0.]])


def reference(blocked):
    """Dijkstra uses only source rows, never native graph arrays or crosswalks."""
    adjacency={}
    expected={(lid,sign):0. for lid,a,b,d,c,m in LINKS for sign in (-1,1) if d in (0,sign)}
    for lid,a,b,d,c,m in LINKS:
        if 'c' not in m:continue
        for sign,start,end in ((1,a,b),(-1,b,a)):
            if d in (0,sign):adjacency.setdefault(start,[]).append((end,c,(lid,sign)))
    costs=np.zeros((3,3));routes={}
    for i,origin in enumerate(CENTROIDS):
        distances={origin:0.};paths={origin:[]};queue=[(0.,origin)]
        while queue:
            cost,node=heapq.heappop(queue)
            if cost!=distances[node]:continue
            if blocked and node in CENTROIDS and node!=origin:continue
            for end,weight,edge in adjacency.get(node,[]):
                candidate=cost+weight
                if candidate<distances.get(end,float('inf')):
                    distances[end]=candidate;paths[end]=paths[node]+[edge]
                    heapq.heappush(queue,(candidate,end))
        for j,destination in enumerate(CENTROIDS):
            costs[i,j]=distances[destination]
            routes[f'{origin}:{destination}']=paths[destination]
            for edge in paths[destination]:expected[edge]+=float(DEMAND[i,j])
    return costs,expected,routes


def run(control):
    graph=Graph();graph.mode='c'
    rows=[dict(link_id=lid,a_node=a,b_node=b if 'c' in modes else a,direction=d,
               travel_time=cost,modes=modes) for lid,a,b,d,cost,modes in LINKS]
    if control=='row-order':rows.reverse()
    graph.network=pd.DataFrame(rows)
    graph.prepare_graph(np.array(CENTROIDS,dtype=np.int64))
    graph.set_graph('travel_time');graph.set_skimming(['travel_time'])
    graph.set_blocked_centroid_flows(control not in ('allow-through','unblocked-baseline'))
    assert graph.compact_num_links<graph.num_links, 'Fixture did not exercise compression'
    compact_record=verify_compact(graph)
    matrix=AequilibraeMatrix();matrix.create_empty(zones=3,matrix_names=['demand'],memory_only=True)
    matrix.index[:]=CENTROIDS;matrix.matrix['demand'][:]=DEMAND
    matrix.computational_view(['demand'])
    result=AssignmentResults();result.cores=1;result.prepare(graph,matrix)
    try:
        # Match the runtime's stable supernetwork ordering and aggregation call.
        costs=np.empty(graph.num_links,dtype=np.float64)
        costs[graph.graph['__supernet_id__'].to_numpy()]=graph.graph.travel_time.to_numpy()
        aggregate_link_costs(costs,graph.compact_cost,result.crosswalk)
        if control=='cost-drift':
            row=graph.graph[(graph.graph.link_id==6)&(graph.graph.direction==1)].iloc[0]
            graph.compact_cost[int(row['__compressed_id__'])]+=1000.
        if control=='crosswalk-drift':
            row=graph.graph[(graph.graph.link_id==1)&(graph.graph.direction==1)].iloc[0]
            other=graph.graph[(graph.graph.link_id==8)&(graph.graph.direction==1)].iloc[0]
            result.crosswalk[int(row['__supernet_id__'])]=int(other['__compressed_id__'])
        assignment=allOrNothing('demand',matrix,graph,result);assignment.execute()
        assert not assignment.report, f'Native assignment reported errors: {assignment.report}'
        expected_costs,expected_flows,routes=reference(control!='unblocked-baseline')
        actual={}
        # Native loads use stable supernetwork indices, not dataframe order.
        for _,row in graph.graph.iterrows():
            actual[(int(row.link_id),int(row.direction))]=float(result.link_loads[int(row['__supernet_id__']),0])
        actual_costs=np.asarray(result.skims.matrix['travel_time'])
        assert np.array_equal(actual_costs,expected_costs), 'Native skim differs from independent source routes'
        assert actual==expected_flows, 'Expanded native flows differ from independent source routes'
        return {'control':control,'directed_links':graph.num_links,'compact_links':graph.compact_num_links,
                'compact_path_verification':compact_record,'costs':actual_costs.tolist(),'flows':{f'{lid}:{direction}':value for (lid,direction),value in actual.items()},
                'routes':routes}
    finally:
        matrix.close()
        result.skims.close()


def main():
    output=Path(os.environ['OPENPLAN_COMPRESSED_ROUTE_OUTPUT'])
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    results=[]
    for control in ('baseline','row-order','unblocked-baseline','allow-through','cost-drift','crosswalk-drift','restored'):
        try:
            record=run(control)
        except AssertionError as error:
            expected={'allow-through':'Native skim differs','cost-drift':'Native skim differs',
                      'crosswalk-drift':'Expanded native flows differ'}.get(control)
            if expected is None or expected not in str(error):raise
            record={'control':control,'targeted_failure':str(error)}
        else:
            assert control in ('baseline','row-order','unblocked-baseline','restored'), f'{control}: targeted defect escaped'
        results.append(record)
    assert results[0]['costs'][0][2]==13., 'Blocked route must bypass centroid 2'
    assert results[0]['costs'][1][2]==1.5 and results[0]['costs'][2][1]==2., 'One-way route must change directional costs'
    assert reference(False)[0][0,2]==10.5, 'Through-centroid counterfactual must differ'
    engine_sources={name:hashlib.sha256(Path(find_spec(name).origin).read_bytes()).hexdigest()
                    for name in ('aequilibrae.paths.graph','aequilibrae.paths.all_or_nothing',
                                 'aequilibrae.paths.results.assignment_results','aequilibrae.paths.cython.AoN')}
    report={'engine_version':version('aequilibrae'),'engine_source_sha256':engine_sources,'source_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'controls':results,'limits':'Synthetic fixed-cost compressed all-or-nothing assignment. Not the full managed worker, equilibrium iterations, nationwide validation or independent observation acceptance.'}
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    (Path(__file__).parent/'native-compressed-routes.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'engine_version':report['engine_version'],'controls':[r['control'] for r in results]},indent=2))


if __name__=='__main__':main()
