"""Preserve a native counterexample to the rejected excluded-anchor guard."""
import hashlib
import json
import os
from pathlib import Path

import verify_native_compressed_routes as native

HERE=Path(__file__).resolve().parent
SOURCE=(HERE/'excluded_paths_candidate.py').read_text()
LINKS=[(1,1,10,0,1.,'c'),(2,10,2,1,1.,'c'),
       (3,2,20,0,3.,'c'),(4,20,1,0,3.,'c'),
       (5,2,3,0,3.,'c'),(6,3,1,0,4.,'c')]


def run(control):
    source=SOURCE
    if control=='harmless':source+='\n# Harmless research comment.\n'
    if control=='omit-route-check':
        old='if end in anchors and end!=origin:'
        assert source.count(old)==1
        source=source.replace(old,'if False:')
    namespace={};exec(compile(source,'excluded_paths_candidate.py','exec'),namespace)
    original_verify=native.verify_compact;original_links=native.LINKS
    observed={}
    def inspect(graph):
        verified=original_verify(graph)
        anchors=set(map(int,graph.centroids));excluded=[]
        for _,row in graph.graph.iterrows():
            start=int(graph.all_nodes[int(row.a_node)]);end=int(graph.all_nodes[int(row.b_node)])
            if int(row['__compressed_id__'])==graph.compact_num_links:
                excluded.append((start,end,float(row.travel_time),int(row.link_id),int(row.direction)))
            else:anchors.update((start,end))
        assert len(excluded)==1 and excluded[0][:2]==(10,1), 'Fixture must retain partial reverse direction'
        try:namespace['verify'](excluded,anchors)
        except ValueError as error:
            assert str(error)=='Excluded routing path connects distinct retained anchors'
            observed.update(candidate_refusal=str(error),excluded=excluded,anchors=sorted(anchors))
        else:raise AssertionError('Candidate no longer reproduces partial-direction false rejection')
        return verified
    try:
        native.LINKS=LINKS;native.verify_compact=inspect
        record=native.run('row-order' if control=='row-order' else 'baseline')
        assert record['costs']==[[0.,2.,4.],[6.,0.,3.],[4.,3.,0.]]
        assert record['compact_path_verification']['excluded_direction_equivalence']=='unassessed'
        return {'control':control,**observed,'native_matches_independent_routes_and_flows':True,
                'directed_links':record['directed_links'],'compact_links':record['compact_links'],
                'costs':record['costs'],'flows':record['flows']}
    finally:
        native.LINKS=original_links;native.verify_compact=original_verify


def main():
    output=Path(os.environ['OPENPLAN_EXCLUSION_COUNTEREXAMPLE_OUTPUT'])
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    results=[]
    for control in ('baseline','harmless','row-order','omit-route-check','restored'):
        try:record=run(control)
        except AssertionError as error:
            assert control=='omit-route-check' and str(error)=='Candidate no longer reproduces partial-direction false rejection'
            record={'control':control,'expected_failure':str(error)}
        else:assert control!='omit-route-check','Targeted research mutation escaped'
        results.append(record)
    report={'engine_version':native.version('aequilibrae'),
        'candidate_sha256':hashlib.sha256(SOURCE.encode()).hexdigest(),
        'proof_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'source_links':LINKS,'controls':results,
        'decision':'Rejected as a production refusal rule; excluded routing remains unassessed.',
        'limits':'Synthetic fixed-cost all-or-nothing transformation counterexample. No general exclusion proof, equilibrium or scientific accuracy claim.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'report.json').write_text(content)
    (HERE/'excluded-path-counterexample.json').write_text(content)
    print(json.dumps({'decision':report['decision'],'controls':[r['control'] for r in results]},indent=2))


if __name__=='__main__':main()
