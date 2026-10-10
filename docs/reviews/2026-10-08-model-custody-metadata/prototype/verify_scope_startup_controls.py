"""Mutate isolated module copies to test the owned scope startup and exit guards."""
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent;WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
modules=('model_engine_process.py','model_engine_supervision.py','model_engine_bootstrap.py')
sources={name:(WORKER/name).read_text() for name in modules}
records=[]
cases=[('baseline',None,None),('harmless',None,None),
       ('authorize-before-record','test_record_failure_never_executes_engine','Engine ran before scope identity was retained'),
       ('ignore-scope-population','test_detached_descendant_prevents_exit_receipt','EngineStillRunning not raised'),
       ('ignore-scope-identity','test_changed_scope_identity_stops_writer','ValueError not raised'),
       ('restored',None,None)]
for case,test,expected in cases:
    with tempfile.TemporaryDirectory(prefix='openplan-scope-control-') as temporary:
        directory=Path(temporary);candidate=dict(sources)
        if case=='harmless':candidate['model_engine_process.py']+='\n# Harmless scope control comment.\n'
        if case=='authorize-before-record':
            s=candidate['model_engine_process.py'];s=s.replace('                self.scope.authorize()\n','')
            s=s.replace('                scope_identity=self.scope.verify_start(self.process.pid)\n','                scope_identity=self.scope.verify_start(self.process.pid)\n                self.scope.authorize()\n');candidate['model_engine_process.py']=s
        if case in ('ignore-scope-population','ignore-scope-identity'):
            s=candidate['model_engine_supervision.py'];s=s.replace('    def require_empty(self):\n','    def require_empty(self):\n        return {**self.identity,\'observed_scope_empty\':True}\n');candidate['model_engine_supervision.py']=s
        for name,content in candidate.items():(directory/name).write_text(content)
        target='test_model_engine_supervision'+('.LiveEngineScopeTests.'+test if test else '')
        result=subprocess.run([sys.executable,'-B','-m','unittest',target,'-v'],cwd=directory,
            env=dict(os.environ,PYTHONPATH=str(directory)+os.pathsep+str(WORKER),OPENPLAN_LIVE_ENGINE_SCOPE='1'),capture_output=True,text=True,timeout=60)
        if expected:
            assert result.returncode!=0 and expected in result.stderr,case+' failed to detect mutation: '+result.stderr
            records.append({'control':case,'detected':expected})
        else:
            assert result.returncode==0,case+': '+result.stderr
            records.append({'control':case,'passed':True,'summary':result.stderr.strip().splitlines()[-3:]})
report={'sources_sha256':{name:hashlib.sha256(text.encode()).hexdigest() for name,text in sources.items()},'controls':records,
        'limits':'Real Linux user scopes and inherited channel, mocked database transport. No parent-loss recovery, cancellation, hostile migration sandbox, full native model or output publication.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'scope-startup-controls.json').write_text(content);print(content)
