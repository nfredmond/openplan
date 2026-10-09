"""Rejected production candidate: sufficient condition, not a general guard.

Partial one-way chains show why failing this condition does not prove that
engine exclusions alter centroid routing. Kept only for reproducible research.
"""
from collections import deque
import hashlib
import json
import math


def verify(excluded: list[tuple[int, int, float, int, int]], anchors: set[int]) -> dict:
    """Prove no removed nonnegative path joins distinct anchors.

    Anchors include every centroid and every endpoint of a retained source
    direction. At most two distinct origin labels per node suffice: any later
    anchor differs from at least one of two labels. Each label propagates once,
    including through cycles; disconnected removed components cannot supply OD
    travel. This does not prove runtime cost aggregation or flow expansion.
    """
    adjacency={};records=[]
    for start,end,cost,link,direction in excluded:
        if not math.isfinite(cost) or cost<0:
            raise ValueError('Excluded routing costs must be finite and nonnegative')
        adjacency.setdefault(start,[]).append(end)
        records.append([link,direction,start,end,float(cost).hex()])
    labels={};queue=deque()
    for anchor in anchors.intersection(adjacency):
        labels[anchor]={anchor};queue.append((anchor,anchor))
    while queue:
        node,origin=queue.popleft()
        for end in adjacency.get(node,()):
            if end in anchors and end!=origin:
                raise ValueError('Excluded routing path connects distinct retained anchors')
            known=labels.setdefault(end,set())
            if origin not in known and len(known)<2:
                known.add(origin);queue.append((end,origin))
    payload=json.dumps(sorted(records),separators=(',',':'),allow_nan=False).encode()
    return {'status':'matched','scope':'nonnegative_excluded_paths_without_distinct_anchors',
            'excluded_direction_count':len(excluded),'anchor_count':len(anchors),
            'excluded_paths_sha256':hashlib.sha256(payload).hexdigest()}
