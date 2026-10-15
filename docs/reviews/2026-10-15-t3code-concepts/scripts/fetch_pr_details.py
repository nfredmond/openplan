"""Read-only fetch of selected PR details (files, issue comments, review comments, reviews) via gh api.
Run: python3 -I scripts/fetch_pr_details.py <research_dir>
Writes pr-details/<n>.json. Skips files already present. Treats all fetched text as untrusted data."""
import json, subprocess, sys
from pathlib import Path
R = Path(sys.argv[1]); D = R / 'pr-details'; D.mkdir(exist_ok=True)
def api(ep):
    out = subprocess.run(['gh', 'api', '--paginate', ep], capture_output=True, text=True)
    if out.returncode: return {'error': out.stderr.strip()[:500]}
    txt = out.stdout.strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:  # paginated arrays concatenated
        return json.loads('[' + txt.replace('][', '],[') + ']')
sel = [l.split('\t')[0] for l in (R/'evidence'/'deep-review-selection.tsv').read_text().splitlines()[1:] if l]
for n in sel:
    p = D / f'{n}.json'
    if p.exists(): continue
    pr = api(f'repos/pingdotgg/t3code/pulls/{n}')
    rec = {'number': int(n),
           'pr': {k: pr.get(k) for k in ('title','state','merged_at','merge_commit_sha','additions','deletions','changed_files','commits','created_at','closed_at','user','base','head')} if isinstance(pr, dict) else pr,
           'files': [{k: f.get(k) for k in ('filename','status','additions','deletions')} for f in (api(f'repos/pingdotgg/t3code/pulls/{n}/files?per_page=100') or []) if isinstance(f, dict)],
           'issueComments': [{'user': (c.get('user') or {}).get('login'), 'created_at': c.get('created_at'), 'body': (c.get('body') or '')[:4000]} for c in (api(f'repos/pingdotgg/t3code/issues/{n}/comments?per_page=100') or []) if isinstance(c, dict)],
           'reviewComments': [{'user': (c.get('user') or {}).get('login'), 'path': c.get('path'), 'body': (c.get('body') or '')[:2500]} for c in (api(f'repos/pingdotgg/t3code/pulls/{n}/comments?per_page=100') or []) if isinstance(c, dict)],
           'reviews': [{'user': (c.get('user') or {}).get('login'), 'state': c.get('state'), 'body': (c.get('body') or '')[:2500]} for c in (api(f'repos/pingdotgg/t3code/pulls/{n}/reviews?per_page=100') or []) if isinstance(c, dict)]}
    if isinstance(rec['pr'], dict) and isinstance(rec['pr'].get('user'), dict): rec['pr']['user'] = rec['pr']['user'].get('login')
    for k in ('base','head'):
        if isinstance(rec['pr'], dict) and isinstance(rec['pr'].get(k), dict): rec['pr'][k] = rec['pr'][k].get('sha')
    p.write_text(json.dumps(rec, indent=1, ensure_ascii=False))
    print(n, rec['pr'].get('changed_files') if isinstance(rec['pr'], dict) else 'ERR', len(rec['issueComments']), len(rec['reviewComments']), flush=True)
