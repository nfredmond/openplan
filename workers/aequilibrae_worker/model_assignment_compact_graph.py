"""Verify retained compact paths without claiming excluded-link equivalence."""
import hashlib
import json

import numpy as np


def _integers(values,label):
    values=np.asarray(values)
    if values.ndim!=1 or values.dtype.kind not in 'iu':
        raise ValueError('Compact routing integer array invalid: '+label)
    return values


def _verify(graph):
    """Require compact adjacency and each retained source chain to agree.

    Source directions mapped to the engine's final sentinel are counted, not
    certified as irrelevant. Cost updates and flow expansion remain separate.
    """
    nodes=_integers(graph.compact_all_nodes,'nodes')
    directed_nodes=_integers(graph.all_nodes,'directed nodes')
    frame=graph.compact_graph
    ids=_integers(frame['id'],'edge IDs')
    starts=_integers(frame['a_node'],'edge starts')
    ends=_integers(frame['b_node'],'edge ends')
    count=len(ids)
    if (count==0 or len(starts)!=count or len(ends)!=count
            or not np.array_equal(ids,np.arange(count))
            or graph.compact_num_links!=count or graph.compact_num_nodes!=len(nodes)
            or len(np.unique(nodes))!=len(nodes)):
        raise ValueError('Compact routing inventory differs')
    if np.any(starts<0) or np.any(ends<0) or np.any(starts>=len(nodes)) or np.any(ends>=len(nodes)):
        raise ValueError('Compact routing endpoint index invalid')
    fs=_integers(graph.compact_fs,'forward star')
    expected=np.concatenate(([0],np.cumsum(np.bincount(starts,minlength=len(nodes)))))
    if not np.array_equal(fs,expected) or np.any(starts[1:]<starts[:-1]):
        raise ValueError('Compact routing forward star differs from adjacency')
    source=graph.graph
    groups=[[] for _ in range(count)]
    crosswalk=_integers(source['__compressed_id__'],'source crosswalk')
    a=_integers(source['a_node'],'source starts');b=_integers(source['b_node'],'source ends')
    link_ids=_integers(source['link_id'],'source links');directions=_integers(source['direction'],'source directions')
    if any(len(values)!=len(crosswalk) for values in (a,b,link_ids,directions)):
        raise ValueError('Compact routing source inventory differs')
    if (np.any(crosswalk<0) or np.any(crosswalk>count) or np.any(a<0) or np.any(b<0)
            or np.any(a>=len(directed_nodes)) or np.any(b>=len(directed_nodes))):
        raise ValueError('Compact routing source index invalid')
    excluded=0
    for index,compact_id in enumerate(crosswalk):
        if compact_id==count:
            excluded+=1;continue
        groups[int(compact_id)].append((int(directed_nodes[a[index]]),int(directed_nodes[b[index]]),
                                       int(link_ids[index]),int(directions[index])))
    digest=hashlib.sha256();centroids=set(map(int,graph.centroids))
    for compact_id,edges in enumerate(groups):
        outgoing={}
        def refusal(reason, stop=None):
            row={name:values[compact_id] for name,values in frame.items()}
            detail={'compact_id':compact_id, 'compact_link_id':int(row['link_id']) if 'link_id' in row else None,
                    'compact_direction':int(row['direction']) if 'direction' in row else None,
                    'compact_indices':[int(starts[compact_id]),int(ends[compact_id])],
                    'original_endpoints':[int(nodes[starts[compact_id]]),int(nodes[ends[compact_id]])],
                    'stop_node':stop, 'mapped_source_directions':[[link,direction] for _,_,link,direction in edges[:20]],
                    'mapped_count':len(edges), 'residue_count':len(outgoing)}
            return ValueError(reason+'; '+json.dumps(detail,sort_keys=True))
        for start,end,link,direction in edges:
            if start in outgoing:raise refusal('Compact routing source chain branches',start)
            outgoing[start]=(end,link,direction)
        start=int(nodes[starts[compact_id]]);end=int(nodes[ends[compact_id]])
        current=start;path=[]
        while current in outgoing:
            next_node,link,direction=outgoing.pop(current)
            path.append([link,direction]);current=next_node
            if current==end:break
            if current in centroids:raise refusal('Compact routing chain crosses a centroid',current)
        if not path or current!=end or outgoing:
            raise refusal('Compact routing source chain differs from endpoints',current)
        digest.update(json.dumps([start,end,path],separators=(',',':')).encode()+b'\n')
    return {'scope':'retained_compact_source_paths','status':'matched','compact_link_count':count,
            'source_path_sha256':digest.hexdigest(),'excluded_direction_count':excluded,
            'excluded_direction_equivalence':'unassessed','runtime_cost_and_flow_equivalence':'unassessed'}


def verify(graph, *, stage='pre-assignment retention'):
    try:
        record = _verify(graph)
        if getattr(graph, 'exclusion_proof', None) is not None:
            record['producer_correction'] = {
                'engine_source_pins': graph._source_pins,
                'source_topology_sha256': graph._source_identity,
                'omissions': graph.omissions, 'exclusion_proof': graph.exclusion_proof}
        return record
    except ValueError as exc:
        raise ValueError(f'Compact routing refused stage={stage}: {exc}') from exc
