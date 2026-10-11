"""Pure exact-source and successful-target startup refusals."""
import ast,copy,hashlib,json
from pathlib import Path
import preview as p
out=Path(__file__).parent;source=out/'preview.py';database='openplan_attempt_cli_'+'c'*32
fixture=[p.REPO/'openplan',p.s.HEAD,'',p.BUILD,{'targetDatabase':database},{'state':'passed-native','sourceHead':p.s.HEAD,'targetDatabase':database},{'database':database,'api_url':p.s.API},{'NEXT_PUBLIC_SUPABASE_URL':p.s.API,'OPENPLAN_COMMIT_SHA':'old'},False]
records=[]
for label in ('baseline','harmless','restored'):
 args=copy.deepcopy(fixture)
 if label=='harmless':args[7]['reviewerNote']='Unrelated'
 settings=p.prepare(*args);assert args[7]['OPENPLAN_COMMIT_SHA']=='old';assert settings['OPENPLAN_COMMIT_SHA']==p.s.HEAD and settings['OPENPLAN_GTFS_PARSER_BUILD']==p.s.HEAD and settings['NODE_OPTIONS']=='--max-old-space-size=768';records.append({'case':label,'passed':True})
variants=[('expanded-preview-source',lambda a:a.__setitem__(0,Path('/foreign'))),('expanded-preview-source',lambda a:a.__setitem__(1,'foreign')),('expanded-preview-source',lambda a:a.__setitem__(2,' M file')),('expanded-preview-build',lambda a:a.__setitem__(3,'foreign')),('expanded-preview-native',lambda a:a[5].update(state='failed')),('expanded-preview-native',lambda a:a[5].update(sourceHead='foreign')),('expanded-preview-target',lambda a:a[6].update(database='foreign')),('expanded-preview-target',lambda a:a[5].update(targetDatabase='foreign')),('expanded-preview-api',lambda a:a[6].update(api_url='https://foreign')),('expanded-preview-api',lambda a:a[7].update(NEXT_PUBLIC_SUPABASE_URL='https://foreign')),('expanded-preview-port',lambda a:a.__setitem__(8,True))]
node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='prepare')
for reason,change in variants:
 args=copy.deepcopy(fixture);change(args)
 try:p.prepare(*args)
 except ValueError as error:assert str(error)==reason
 else:raise AssertionError('Broken preview survived')
 mutated=copy.deepcopy(node)
 class Omit(ast.NodeTransformer):
  def visit_Expr(self,node):
   v=node.value
   if isinstance(v,ast.Call) and len(v.args)==2 and isinstance(v.args[1],ast.Constant) and v.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
   return self.generic_visit(node)
 Omit().visit(mutated);space={'s':p.s,'REPO':p.REPO,'BUILD':p.BUILD};exec(compile(ast.Module(body=[mutated],type_ignores=[]),str(source),'exec'),space);space['prepare'](*args);records.append({'case':reason,'refused':True,'omittedGuardAllowsBroken':True})
(out/'preview-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure launch preflight. No app, browser, native services or database changed.'},indent=2)+'\n');print('3 positive and 11 broken preview scopes with omitted-guard controls pass.')
