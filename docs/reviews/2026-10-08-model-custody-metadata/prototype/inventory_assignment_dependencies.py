"""Report static main-module dependencies without importing operator configuration.

This is an extraction aid, not a runtime isolation or acceptance guard. Symbol
references overapproximate calls and cannot resolve dynamic dispatch or imports.
"""
import ast
import builtins
import hashlib
import json
from pathlib import Path
import symtable

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'
source = (WORKER / 'main.py').read_text()
tree = ast.parse(source)
tables = {t.get_name(): t for t in symtable.symtable(source, 'main.py', 'exec').get_children()}
functions = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def global_references(table):
    names = {s.get_name() for s in table.get_symbols() if s.is_global() and s.is_referenced()}
    for child in table.get_children():
        names.update(global_references(child))
    return names - set(dir(builtins))


pending = ['stage_assignment']
visited = {}
while pending:
    name = pending.pop()
    if name in visited:
        continue
    node = functions[name]
    references = global_references(tables[name])
    local = sorted(references & functions.keys())
    visited[name] = {
        'lines': [node.lineno, node.end_lineno],
        'local_function_references': local,
        'other_global_references': sorted(references - functions.keys()),
        'attribute_calls': sorted({ast.unparse(n.func) for n in ast.walk(node)
                                   if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}),
        'imports': sorted({ast.unparse(n) for n in ast.walk(node)
                           if isinstance(n, (ast.Import, ast.ImportFrom))}),
    }
    pending.extend(local)

report = {
    'source': 'workers/aequilibrae_worker/main.py',
    'sha256': hashlib.sha256(source.encode()).hexdigest(),
    'root': 'stage_assignment',
    'reachable_main_functions': len(visited),
    'functions': dict(sorted(visited.items())),
    'limits': 'Static symbol references in main.py only. Includes branches whether exercised or not. Imported module internals, native extensions, dynamic calls, filesystem and network behavior require separate inspection and runtime evidence. Does not prove credential isolation, containment, no-egress, or scientific acceptance.',
}
(ROOT / 'assignment-dependencies.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'source_sha256': report['sha256'], 'reachable_main_functions': len(visited),
                  'root_lines': visited['stage_assignment']['lines'],
                  'functions_with_requests': [name for name, item in visited.items()
                                              if any(c.startswith('requests.') for c in item['attribute_calls'])]}, indent=2))
