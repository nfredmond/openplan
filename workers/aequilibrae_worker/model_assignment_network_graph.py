"""Compare directed assignment links with one read-only source snapshot."""
import hashlib
import json
import math

import numpy as np
from network_settings import canonical_network_settings
from model_assignment_network_source import identity


def _integer(value):
    if isinstance(value,(bool,np.bool_)) or not isinstance(value,(int,np.integer)):
        raise ValueError('Source-to-graph identity must be an integer')
    return int(value)


def _number(value):
    if isinstance(value,(bool,np.bool_)):
        raise ValueError('Source-to-graph value must be finite numeric data')
    result=float(value)
    if not math.isfinite(result):raise ValueError('Source-to-graph value must be finite numeric data')
    return result


def _verify_centroids(graph):
    """Protect the native routing indices and this stage's no-through policy."""
    centroids=np.asarray(graph.centroids)
    if (centroids.ndim!=1 or centroids.dtype.kind not in 'iu' or len(centroids)==0
            or np.any(centroids<=0) or len(np.unique(centroids))!=len(centroids)):
        raise ValueError('Assignment routing centroids must be unique positive integers')
    if _integer(graph.num_zones)!=len(centroids):
        raise ValueError('Assignment routing zone count differs from centroids')
    if graph.block_centroid_flows is not True:
        raise ValueError('Assignment routing must block through-centroid flows')
    for prefix in ('','compact_'):
        nodes=np.asarray(getattr(graph,prefix+'all_nodes'))
        indices=np.asarray(getattr(graph,prefix+'nodes_to_indices'))
        if (nodes.ndim!=1 or nodes.dtype.kind not in 'iu'
                or not np.array_equal(nodes[:len(centroids)],centroids)
                or indices.ndim!=1 or indices.dtype.kind not in 'iu'
                or np.any(centroids>=len(indices))
                or not np.array_equal(indices[centroids],np.arange(len(centroids)))):
            raise ValueError('Assignment routing centroid node mapping differs: '+prefix)


def verify(assignment,database,settings):
    """Check direction, node remapping, mode exclusion and recorded class factors.

    The scope is the directed graph, before compression and demand assignment.
    It does not validate compressed routing topology or scientific accuracy.
    """
    settings=canonical_network_settings(settings)
    factors=settings['road_class_factors']
    graphs=[];seen=set()
    fields=('link_id','direction','a_node','b_node','modes','distance','travel_time','capacity')
    for item in assignment.classes:
        graph=item.graph
        if id(graph) in seen:continue
        seen.add(id(graph))
        _verify_centroids(graph)
        if not isinstance(graph.mode,str) or len(graph.mode)!=1 or not graph.mode.isalnum():
            raise ValueError('Unsupported source-to-graph mode identity')
        frame=graph.graph
        columns={name:np.asarray(frame[name]) for name in fields}
        lengths={len(values) for values in columns.values()}
        if len(lengths)!=1 or not lengths or next(iter(lengths))==0:
            raise ValueError('Source-to-graph column inventory differs')
        all_nodes=np.asarray(graph.all_nodes)
        if all_nodes.ndim!=1 or all_nodes.dtype.kind not in 'iu' or len(np.unique(all_nodes))!=len(all_nodes):
            raise ValueError('Source-to-graph node map is invalid')
        for field in ('a_node','b_node'):
            values=columns[field]
            if values.dtype.kind not in 'iu' or np.any(values<0) or np.any(values>=len(all_nodes)):
                raise ValueError('Source-to-graph node index is invalid')
        graphs.append({'graph':graph,'columns':columns,'all_nodes':all_nodes,
            'remaining_nodes':set(map(int,all_nodes)),'position':0,
            'order':np.lexsort((columns['direction'],columns['link_id'])),
            'digest':hashlib.sha256()})
    if not graphs:raise ValueError('Source-to-graph comparison requires a graph')

    def observe(table,row):
        if table=='nodes':
            for record in graphs:record['remaining_nodes'].discard(row['node_id'])
            return
        direction=_integer(row['direction'])
        if direction not in (-1,0,1):raise ValueError('Source link direction is invalid')
        modes=row['modes']
        if not isinstance(modes,str):raise ValueError('Source link modes are missing')
        factor=factors.get(str(row.get('link_type') or ''),1.0)
        for record in graphs:
            mode=record['graph'].mode
            start=_integer(row['a_node']);end=_integer(row['b_node'])
            if mode not in modes:end=start
            for sign in (-1,1):
                if direction!=0 and direction!=sign:continue
                suffix='_ab' if sign==1 else '_ba'
                def field(name):return _number(row[name] if name in row else row[name+suffix])
                expected=[_integer(row['link_id']),sign,start if sign==1 else end,end if sign==1 else start,
                    modes,field('distance').hex(),(field('travel_time')/factor).hex(),(field('capacity')*factor).hex()]
                position=record['position']
                if position>=len(record['order']):raise ValueError('Assignment graph omits a source direction')
                index=int(record['order'][position]);columns=record['columns'];nodes=record['all_nodes']
                actual=[_integer(columns['link_id'][index]),_integer(columns['direction'][index]),
                    _integer(nodes[columns['a_node'][index]]),_integer(nodes[columns['b_node'][index]]),
                    str(columns['modes'][index]),_number(columns['distance'][index]).hex(),
                    _number(columns['travel_time'][index]).hex(),_number(columns['capacity'][index]).hex()]
                if actual!=expected:raise ValueError('Assignment graph differs from source and recorded transformations')
                record['digest'].update(json.dumps(actual,separators=(',',':'),ensure_ascii=False).encode()+b'\n')
                record['position']+=1

    source=identity(database,observe=observe)
    records=[]
    from model_assignment_compact_graph import verify as verify_compact
    for record in graphs:
        if record['position']!=len(record['order']):raise ValueError('Assignment graph adds directions absent from source')
        if record['remaining_nodes']:raise ValueError('Assignment graph node map contains nodes absent from source')
        records.append({'mode':record['graph'].mode,'directed_link_count':record['position'],
                        'directed_links_sha256':record['digest'].hexdigest(),
                        'compact_paths':verify_compact(record['graph'])})
    payload=json.dumps(settings,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    return source,{'scope':'directed_source_links_with_road_class_factors','status':'matched',
                   'source_sha256':source['sha256'],'network_settings_sha256':hashlib.sha256(payload).hexdigest(),
                   'graphs':records,'centroid_policy':{'block_through_flows':True,
                       'directed_and_compact_centroid_indices':'matched'},
                   'compressed_routing_equivalence':'unassessed'}
