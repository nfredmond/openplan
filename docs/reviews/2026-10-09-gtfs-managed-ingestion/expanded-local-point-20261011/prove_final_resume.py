"""Pure post-producer result/file assertions and targeted omitted-guard controls."""
import ast,copy,hashlib,json
from pathlib import Path
import verify_final_resume as v
out=Path(__file__).parent;source=out/'verify_final_resume.py';result={'state':'passed-native','sourceHead':v.r.s.HEAD,'cli':[{'exitCode':2,'jobSettled':False,'computationAttempts':0,'sourceNetworkAttempts':0,'nativeCandidateCount':0,'nativeLockHolders':3},{'exitCode':0,'jobSettled':True,'computationAttempts':0,'sourceNetworkAttempts':0,'nativeCandidateCount':0,'nativeLockHolders':3}],'propertiesEqual':True,'originalDatabaseUnchanged':True,'originalDurableFilesUnchanged':True,'allKnownGtfsRootsCaptured':True,'storageObjectsReadBack':10,'syntheticUserSignin':True,'rolesCapturedReused':True,'mountedKeyCapturedReused':True,'mountedKeyCapturedAndReadVerified':True};files={'archive.zip':{'sha256':'a','mode':384},'pending.json':{'sha256':'b','mode':384}};fixtures={'verify_result':[result],'verify_files':[files,copy.deepcopy(files),{'pending.json'}]};records=[]
for label in ('baseline','harmless','restored'):
 for name,args in copy.deepcopy(fixtures).items():
  if label=='harmless' and name=='verify_result':args[0]['reviewerNote']='Unrelated'
  if label=='harmless' and name=='verify_files':args[1]['pending.json']['sha256']='changed-authorized-journal'
  getattr(v,name)(*args)
 records.append({'case':label,'passed':True})
variants=[('verify_result','expanded-final-result',lambda a:a[0].update(state='failed')),('verify_result','expanded-final-result',lambda a:a[0].update(sourceHead='foreign')),('verify_result','expanded-final-cli',lambda a:a[0]['cli'][0].update(exitCode=0)),('verify_result','expanded-final-cli',lambda a:a[0]['cli'][1].update(jobSettled=False)),('verify_result','expanded-final-no-compute',lambda a:a[0]['cli'][1].update(computationAttempts=1)),('verify_result','expanded-final-no-compute',lambda a:a[0]['cli'][1].update(sourceNetworkAttempts=1)),('verify_result','expanded-final-no-compute',lambda a:a[0]['cli'][1].update(nativeCandidateCount=1)),('verify_result','expanded-final-no-compute',lambda a:a[0]['cli'][1].update(nativeLockHolders=0)),('verify_result','expanded-final-preservation',lambda a:a[0].update(propertiesEqual=False)),('verify_result','expanded-final-preservation',lambda a:a[0].update(allKnownGtfsRootsCaptured=False)),('verify_result','expanded-final-preservation',lambda a:a[0].update(originalDatabaseUnchanged=False)),('verify_result','expanded-final-services',lambda a:a[0].update(storageObjectsReadBack=9)),('verify_result','expanded-final-services',lambda a:a[0].update(syntheticUserSignin=False)),('verify_result','expanded-final-key-role-custody',lambda a:a[0].update(mountedKeyCapturedAndReadVerified=False)),('verify_files','expanded-final-file-census',lambda a:a[1].pop('pending.json')),('verify_files','expanded-final-unrelated-file',lambda a:a[1]['archive.zip'].update(sha256='changed')),('verify_files','expanded-final-file-mode',lambda a:a[1]['pending.json'].update(mode=420))]
tree=ast.parse(source.read_text())
for name,reason,change in variants:
 args=copy.deepcopy(fixtures[name]);change(args)
 try:getattr(v,name)(*args)
 except ValueError as error:assert str(error)==reason
 else:raise AssertionError('Broken final result survived '+reason)
 node=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name))
 class Omit(ast.NodeTransformer):
  def visit_Expr(self,node):
   value=node.value
   if isinstance(value,ast.Call) and len(value.args)==2 and isinstance(value.args[1],ast.Constant) and value.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
   return self.generic_visit(node)
 Omit().visit(node);space={'r':v.r};exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),space)
 space[name](*args);records.append({'case':reason,'refused':True,'omittedGuardAllowsBroken':True})
(out/'resumed-final-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Synthetic post-producer file/result observations, no native read or mutation.'},indent=2)+'\n');print('3 positive, 17 broken final observations and omitted-guard controls pass.')
