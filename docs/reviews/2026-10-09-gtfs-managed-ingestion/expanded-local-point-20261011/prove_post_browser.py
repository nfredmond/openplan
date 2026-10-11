"""Pure exact post-browser census, non-Auth and schema refusal controls."""
import ast,copy,hashlib,json
from pathlib import Path
import run as r
p=Path(__file__).parent;source=p/'post_browser.py';tree=ast.parse(source.read_text());nodes=[node for node in tree.body if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and node.value.args and isinstance(node.value.args[-1],ast.Constant) and str(node.value.args[-1].value).startswith('expanded-browser-') or isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='changes' for target in node.targets)]
base={'old':{'auth.users':{'count':1},'public.models':{'count':1}},'new':{'auth.users':{'count':1},'public.models':{'count':1}},'before':{'schemaSha256':'known'},'after':{'schemaSha256':'known'}};records=[]
def execute(nodes,value):exec(compile(ast.Module(body=copy.deepcopy(nodes),type_ignores=[]),str(source),'exec'),{'r':r,**value})
for label in ('baseline','harmless','restored'):
 value=copy.deepcopy(base)
 if label=='harmless':value['new']['auth.users']['count']=2
 execute(nodes,value);records.append({'case':label,'passed':True})
variants=[('expanded-browser-native-table-census',lambda v:v['new'].update({'public.unexpected':{'count':0}})),('expanded-browser-nonauth-write',lambda v:v['new']['public.models'].update(count=2)),('expanded-browser-schema-write',lambda v:v['after'].update(schemaSha256='changed'))]
for reason,change in variants:
 value=copy.deepcopy(base);change(value)
 try:execute(nodes,value)
 except ValueError as error:assert str(error)==reason
 else:raise AssertionError('Broken post-browser image survived')
 omitted=[node for node in nodes if not isinstance(node,ast.Expr) or node.value.args[-1].value!=reason];execute(omitted,value);records.append({'case':reason,'refused':True,'omittedGuardAllowsBroken':True})
(p/'post-browser-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure extracted top-level guards. Native reader launched before these controls; its observation remains unaccepted until controls pass. No app/native data/source mutation.'},indent=2)+'\n');print('3 positive and3 post-browser refusals with omitted-guard controls pass; source unchanged.')
