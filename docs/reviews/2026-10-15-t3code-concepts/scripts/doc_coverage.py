"""Build a reproducible per-path documentation coverage record (TSV + JSON summary).
The script proves retrieval only (file present locally, line count). The 'researcherDeclaration'
column records what the analyst states was read; the script cannot verify reading.
Run: python3 -I scripts/doc_coverage.py <research_dir>"""
import sys, json, subprocess, collections
from pathlib import Path
R = Path(sys.argv[1]); T = R / 't3code'; X = R / 'docs-extra'
paths = [p for p in (R / 'documentation-inventory.txt').read_text().splitlines() if p]
def cat(p):
    if p.startswith('.repos/alchemy-effect/'): return 'vendored-upstream:alchemy-effect (Apache-2.0)'
    if p.startswith('.repos/effect-smol/'): return 'vendored-upstream:effect-smol (MIT)'
    if p.startswith('docs/user/'): return 't3-user-doc'
    if p.startswith('docs/internals/'): return 't3-internals-design'
    if p.startswith('docs/orchestration-v2/'): return 't3-orchestration-v2-design'
    if p.startswith('docs/operations/'): return 't3-operations-runbook'
    if p.startswith('.agents/'): return 't3-agent-skill'
    if p.startswith('.github/') or p.startswith('.macroscope/') or p in ('CONTRIBUTING.md','AGENTS.md','CLAUDE.md'): return 't3-repo-policy'
    if '/testkit/fixtures/' in p: return 't3-test-fixture-readme'
    return 't3-component-readme'
rows = []
for p in paths:
    c = cat(p)
    local = T / p
    extra = X / p.replace('/', '_')
    if local.is_file():
        src, lines = 'sparse-checkout', sum(1 for _ in local.open(errors='replace'))
    elif extra.is_file():
        src, lines = 'git-show-at-pinned-commit', sum(1 for _ in extra.open(errors='replace'))
    else:
        src, lines = 'not-fetched (tree path only)', ''
    retrieved = 'retrieved' if src != 'not-fetched (tree path only)' else 'not retrieved'
    if c.startswith('vendored'):
        decl = 'path-screened only (external upstream library docs under .repos; not T3 product docs)'
        if p.endswith(('alchemy-effect/README.md','effect-smol/README.md')): decl = 'README head viewed via git show (output not retained) + license checked'
    else:
        decl = 'researcher declares read in full (not script-verifiable)' if retrieved == 'retrieved' else 'NOT READ'
    rows.append((p, c, src, str(lines), retrieved, decl))
out = R / 'evidence' / 'documentation-coverage.tsv'
out.write_text('path\tcategory\tsource\tlines\tscriptVerifiedRetrieval\tresearcherDeclaration\n' + ''.join('\t'.join(r) + '\n' for r in rows))
first = [r for r in rows if not r[1].startswith('vendored')]
summ = {'totalPaths': len(rows),
        'firstPartyNonVendoredPaths': len(first),
        'externalVendoredRepoPaths': len(rows) - len(first),
        'note': 'Only firstPartyNonVendoredPaths are T3-owned prose. External .repos paths are upstream library docs. Retrieval is script-verified; reading is a researcher declaration.',
        'byCategory': collections.Counter(r[1] for r in rows),
        'byRetrieval': collections.Counter(r[4] for r in rows),
        'byResearcherDeclaration': collections.Counter(r[5] for r in rows),
        'bySource': collections.Counter(r[2] for r in rows),
        'firstPartyLinesRetrieved': sum(int(r[3]) for r in first if r[3])}
(R / 'evidence' / 'documentation-coverage-summary.json').write_text(json.dumps(summ, indent=2) + '\n')
print(json.dumps(summ, indent=2))
