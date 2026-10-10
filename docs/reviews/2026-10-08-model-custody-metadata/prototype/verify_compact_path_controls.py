"""Harmless and targeted faults for compact adjacency and source path checks."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path

worker=Path(__file__).resolve().parents[4]/'workers/aequilibrae_worker'
source=(worker/'model_assignment_compact_graph.py').read_text()
checks=[('baseline',None,None,None),('harmless',None,None,None),
 ('forward-star',"if not np.array_equal(fs,expected) or np.any(starts[1:]<starts[:-1]):",'if False:','test_changed_forward_star_refuses'),
 ('endpoint',"if not path or current!=end or outgoing:",'if False:','test_missing_source_chain_refuses'),
 ('branch',"if start in outgoing:raise ValueError('Compact routing source chain branches')",'pass','test_source_branch_refuses'),
 ('centroid',"if current in centroids:raise ValueError('Compact routing chain crosses a centroid')",'pass','test_interior_centroid_refuses'),
 ('restored',None,None,None)]
results=[]
for control,old,new,test in checks:
    candidate=source
    if old:
        assert candidate.count(old)==1
        candidate=candidate.replace(old,new)
    elif control=='harmless':candidate+='\n# Harmless compact-path comment.\n'
    with tempfile.TemporaryDirectory(prefix='openplan-compact-path-control-') as tmp:
        (Path(tmp)/'model_assignment_compact_graph.py').write_text(candidate)
        target='test_assignment_compact_graph'+('.CompactGraphTests.'+test if test else '')
        code=f"import sys,unittest;sys.path[:0]=[{tmp!r},{str(worker)!r}];r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({target!r}));raise SystemExit(not r.wasSuccessful())"
        result=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True,timeout=30)
        log=result.stdout+result.stderr
        reason='ValueError not raised' if test else None
        if control=='branch':reason='does not match'
        matched=result.returncode==0 if reason is None else result.returncode!=0 and reason in log
        if not matched:raise AssertionError(f'{control}: {log}')
        results.append({'control':control,'returncode':result.returncode,'expected_failure':reason,'matched':matched})
assert (worker/'model_assignment_compact_graph.py').read_text()==source
report={'source_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':results,
        'limits':'Synthetic source chains. Excluded directions, native runtime costs, flow expansion and scientific acceptance are outside this check.'}
(Path(__file__).parent/'compact-path-controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
