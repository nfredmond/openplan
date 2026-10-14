"""Challenge the native driver's actual capture-size and streaming-hash block."""
import argparse,ast,hashlib,json,tempfile
from pathlib import Path


def run(repo,out):
    out.mkdir(parents=True,exist_ok=False)
    path=repo/'docs/reviews/2026-10-14-recovery-execution/native_http.py'
    raw=path.read_text();tree=ast.parse(raw);function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
    start=next(i for i,n in enumerate(function.body) if isinstance(n,ast.Assert) and 'original restore input size' in ast.get_source_segment(raw,n))
    nodes=function.body[start:start+3]
    assert [type(n).__name__ for n in nodes]==['Assert','With','Assert'],'Capture checks remain one size/hash block'
    block=ast.unparse(ast.Module(body=nodes,type_ignores=[]));controls=[]
    with tempfile.TemporaryDirectory() as folder:
        capture=Path(folder)/'capture.dump';capture.write_bytes(b'Synthetic capture bytes for source guard controls')
        size=capture.stat().st_size;digest=hashlib.sha256(capture.read_bytes()).hexdigest()
        def assess(text):
            def call(given_size,given_hash):exec(text,{'capture':capture,'saved':{'restoredCapture':{'bytes':given_size,'sha256':given_hash}},'hashlib':hashlib})
            call(size,digest)
            for given_size,given_hash,label,diagnostic in [(size+1,digest,'Capture size change cannot survive guard','Native HTTP original restore input size matches its recorded capture'),(size,'0'*64,'Capture hash change cannot survive guard','Native HTTP original restore input hash matches its recorded capture')]:
                try:call(given_size,given_hash)
                except AssertionError as error:assert str(error)==diagnostic,'Capture refusal reaches its intended diagnostic'
                else:raise AssertionError(label)
        def positive(label,text):assess(text);controls.append({'control':label,'outcome':'survived'})
        positive('baseline',block);positive('harmless','# Harmless capture guard note.\n'+block);positive('restored-after-harmless',block)
        for label,index,expected in [('size',0,'Capture size change cannot survive guard'),('hash',2,'Capture hash change cannot survive guard')]:
            mutant=ast.parse(block);mutant.body[index].test=ast.Constant(True);changed=ast.unparse(ast.fix_missing_locations(mutant))
            try:assess(changed)
            except AssertionError as error:assert str(error)==expected,'Capture fault reaches its intended control'
            else:raise AssertionError('Broken capture guard survives')
            controls.append({'control':label,'outcome':'intended_failure','reason':expected})
        positive('restored-final',block)
    (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
    (out/'source-binding.json').write_text(json.dumps({'nativeDriverSha256':hashlib.sha256(path.read_bytes()).hexdigest()},indent=2)+'\n')
    print({'positive':4,'faults':2,'scope':'Actual source block with synthetic bytes, not a real archive restore'})

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
