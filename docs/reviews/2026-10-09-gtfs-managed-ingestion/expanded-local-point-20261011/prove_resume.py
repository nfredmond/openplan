"""Pure continuation refuses unrelated failed producers and mixed targets."""
import ast,copy,hashlib,json
from pathlib import Path
import resume as r
p=Path(__file__).parent;source=p/'resume.py';producer={'state':'failed','reason':'expanded-signin-unrelated-record-change','originalServicesRestartedAfterFailure':True,'cli':[{'exitCode':2,'jobSettled':False},{'exitCode':0,'jobSettled':True}]};fixture=[producer,{'targetDatabase':'owned','sourceHead':r.r.s.HEAD},{'database':'owned','api_url':r.r.s.API},True,True,True];records=[]
for label in ('baseline','harmless','restored'):
 args=copy.deepcopy(fixture)
 if label=='harmless':args[0]['reviewerNote']='Unrelated'
 r.verify_resume(*args);records.append({'case':label,'passed':True})
variants=[('expanded-resume-producer',lambda a:a[0].update(reason='another-failure')),('expanded-resume-producer',lambda a:a[0].update(originalServicesRestartedAfterFailure=False)),('expanded-resume-target',lambda a:a[2].update(database='foreign')),('expanded-resume-target',lambda a:a[1].update(sourceHead='foreign')),('expanded-resume-target',lambda a:a[2].update(api_url='https://foreign')),('expanded-resume-original-cli',lambda a:a[0]['cli'][1].update(exitCode=2)),('expanded-resume-original-cli',lambda a:a[0]['cli'][1].update(jobSettled=False)),('expanded-resume-preservation',lambda a:a.__setitem__(3,False)),('expanded-resume-preservation',lambda a:a.__setitem__(4,False)),('expanded-resume-preservation',lambda a:a.__setitem__(5,False))]
node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='verify_resume')
for reason,change in variants:
 args=copy.deepcopy(fixture);change(args)
 try:r.verify_resume(*args)
 except ValueError as error:assert str(error)==reason
 else:raise AssertionError('Broken resume survived')
 mutant=copy.deepcopy(node)
 class Omit(ast.NodeTransformer):
  def visit_Expr(self,node):
   v=node.value
   if isinstance(v,ast.Call) and len(v.args)==2 and isinstance(v.args[1],ast.Constant) and v.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
   return self.generic_visit(node)
 Omit().visit(mutant);space={'r':r.r};exec(compile(ast.Module(body=[mutant],type_ignores=[]),str(source),'exec'),space);space['verify_resume'](*args);records.append({'case':reason,'refused':True,'omittedGuardAllowsBroken':True})
(p/'resume-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure continuation guards, no service stop/start or native read.'},indent=2)+'\n');print('3 positive and 10 broken continuation scopes with omitted-guard controls pass.')
