"""Show each new retained-root test fails if its protecting comparison is omitted."""
import ast,copy,hashlib,json
from pathlib import Path
p=Path(__file__).parent;source=p/'prove_retained_root.py';raw=source.read_bytes();tree=ast.parse(raw);records=[]
# Comment-only source survives the actual native copy checks.
exec(compile(b'# Harmless source comment\n'+raw,str(source),'exec'),{'__file__':str(source)})
variants=next(n for n in tree.body if isinstance(n,ast.With))
assignment=next(n for n in variants.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='variants')
labels=['owner-marker','missing-input','missing-output','missing-empty-directory','private-mode']
for label in labels+['claim-missing-admission','progress-missing-admission']:
 t=copy.deepcopy(tree)
 # Replace only the selected protecting comparison, after the actual module loads.
 compare='equal_journal' if label.endswith('-missing-admission') else 'equal_root'
 injection=ast.parse('root.'+compare+' = lambda *args: None').body[0]
 root_loaded=next(i for i,n in enumerate(t.body) if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and n.value.func.attr=='exec_module' and n.value.args and isinstance(n.value.args[0],ast.Name) and n.value.args[0].id=='root');t.body.insert(root_loaded+1,injection)
 block=next(n for n in t.body if isinstance(n,ast.With));a=next(n for n in block.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='variants')
 if label in labels:
  a.value.elts=[a.value.elts[labels.index(label)]]
  block.body=[n for n in block.body if not (isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='name')]
  reason='Changed root survived: '+label
 else:
  a.value.elts=[]
  loop=next(n for n in block.body if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='name');loop.iter=ast.List(elts=[ast.Constant(label.split('-')[0])],ctx=ast.Load());reason='Removed admission survived'
 try:exec(compile(ast.fix_missing_locations(t),str(source),'exec'),{'__file__':str(source)})
 except AssertionError as e:assert str(e)==reason
 else:raise AssertionError('Omitted comparison failed to expose test oracle: '+label)
 records.append({'case':label,'omittedComparison':compare,'testFailsForIntendedReason':reason})
assert source.read_bytes()==raw
(p/'retained-root-oracles.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(raw).hexdigest(),'harmlessCommentSurvivesActualCopyTests':True,'cases':records,'scope':'Actual native copy tests with in-memory omitted comparisons. Source and production helpers unchanged. No concurrency, engine resume or remote-host acceptance.'},indent=2)+'\n')
print(len(records),'new native copy test oracles controlled')
