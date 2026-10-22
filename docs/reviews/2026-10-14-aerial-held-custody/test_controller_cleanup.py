"""Exercise cleanup fences with a simulated Docker boundary, never real services."""
import importlib.util,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
p=Path(__file__).with_name('verify_upgrade_controls.py');spec=importlib.util.spec_from_file_location('controller',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
IDENTITY='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
def state():return {'Id':IDENTITY,'Image':'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f','Config':{'Labels':{'openplan.purpose':'odm-private-dispatch-rpc-cli-20261012'}},'HostConfig':{'Memory':1073741824,'MemorySwap':1073741824,'PortBindings':{}},'State':{'Running':True}}
class Checks(unittest.TestCase):
 def test_owned_running_cluster_uses_graceful_stop(self):
  with patch.object(m.subprocess,'check_output',return_value=json.dumps([state()]).encode()),patch.object(m.subprocess,'run') as stop:
   m.cleanup_owned_cluster();self.assertTrue(stop.call_args.args[0]==['docker','stop','--time','120',IDENTITY],'Owned cleanup keeps its exact target and graceful deadline')
 def test_stopped_cluster_is_left_untouched(self):
  value=state();value['State']['Running']=False
  with patch.object(m.subprocess,'check_output',return_value=json.dumps([value]).encode()),patch.object(m.subprocess,'run') as stop:
   m.cleanup_owned_cluster();self.assertFalse(stop.called,'Stopped owned cluster needs no stop')
 def test_foreign_or_unbounded_surface_refuses_before_stop(self):
  for field in ['Id','Image','purpose','Memory','MemorySwap','PortBindings']:
   value=state()
   if field in ['Id','Image']:value[field]='foreign'
   elif field=='purpose':value['Config']['Labels']['openplan.purpose']='foreign'
   else:value['HostConfig'][field]={'5432/tcp':[{}]} if field=='PortBindings' else 0
   with self.subTest(field=field),patch.object(m.subprocess,'check_output',return_value=json.dumps([value]).encode()),patch.object(m.subprocess,'run') as stop:
    with self.assertRaises(AssertionError,msg='Cleanup refuses a changed ownership/resource fence'):m.cleanup_owned_cluster()
    self.assertFalse(stop.called,'Unowned cleanup never starts a stop')
 def test_outer_timeout_requests_fenced_cleanup(self):
  calls=[]
  def process(args,**kwargs):
   calls.append(args)
   if args[0]=='docker':return subprocess.CompletedProcess(args,0)
   raise subprocess.TimeoutExpired(args,360)
  repo=Path(__file__).resolve().parents[3]
  with tempfile.TemporaryDirectory(prefix='openplan-held-cleanup-') as root,patch.object(m.subprocess,'check_output',return_value=json.dumps([state()]).encode()),patch.object(m.subprocess,'run',side_effect=process):
   with self.assertRaises(TimeoutError):m.run(repo,Path(root)/'proof')
  self.assertTrue([c for c in calls if c[0]=='docker']==[['docker','stop','--time','120',IDENTITY]],'Outer timeout requests owned cluster cleanup')
 def test_native_controller_timeouts_request_fenced_cleanup(self):
  for name in ['verify_native_controls.py','verify_aftermath_controls.py']:
   target=p.with_name(name);spec=importlib.util.spec_from_file_location('native_controller',target);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   calls=[]
   def process(args,**kwargs):
    calls.append(args)
    if args[0]=='docker':return subprocess.CompletedProcess(args,0)
    raise subprocess.TimeoutExpired(args,240)
   repo=Path(__file__).resolve().parents[3]
   with self.subTest(controller=name),tempfile.TemporaryDirectory(prefix='openplan-held-native-cleanup-') as root,patch.dict(sys.modules,{'verify_upgrade_controls':m}),patch.object(m.subprocess,'check_output',return_value=json.dumps([state()]).encode()),patch.object(m.subprocess,'run',side_effect=process):
    with self.assertRaises(TimeoutError):module.run(repo,Path(root)/'proof')
    self.assertTrue([c for c in calls if c[0]=='docker']==[['docker','stop','--time','120',IDENTITY]],'Native controller timeout requests owned cluster cleanup')
if __name__=='__main__':unittest.main(verbosity=2)
