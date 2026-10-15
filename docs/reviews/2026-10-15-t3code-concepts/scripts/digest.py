"""Print a reading digest for given PR numbers from corpus + pr-details (untrusted text).
Run: python3 -I scripts/digest.py <research_dir> <n> [<n>...]"""
import json, re, sys
from pathlib import Path
R = Path(sys.argv[1]); nums = [int(x) for x in sys.argv[2:]]
corpus = {}
for l in (R/'pull-requests.jsonl').open():
    r = json.loads(l)
    if r['number'] in nums: corpus[r['number']] = r
BOTS = re.compile(r'(\[bot\]|macroscope|cursor|vercel|coderabbit|github-actions|chatgpt-codex|greptile)', re.I)
def clean(t):
    t = re.sub(r'<!--.*?-->', '', t or '', flags=re.S)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', '[img]', t)
    return re.sub(r'\n{3,}', '\n\n', t).strip()
for n in nums:
    c = corpus.get(n, {}); d = json.loads((R/'pr-details'/f'{n}.json').read_text()) if (R/'pr-details'/f'{n}.json').exists() else {}
    pr = d.get('pr', {})
    print(f"\n######## #{n} {c.get('title')}\nstate={c.get('state')} merged={c.get('merged_at')} created={c.get('created_at')} author={c.get('author')} +{pr.get('additions')}/-{pr.get('deletions')} files={pr.get('changed_files')} merge_sha={pr.get('merge_commit_sha')}")
    print(clean(c.get('body'))[:900])
    fs = d.get('files', [])
    print(f"-- files ({len(fs)} listed):", '; '.join(f"{f['filename']}(+{f['additions']})" for f in sorted(fs, key=lambda f: -(f['additions'] or 0))[:14]))
    hum = [x for x in d.get('issueComments', []) + d.get('reviews', []) if x.get('body') and not BOTS.search(x.get('user') or '')]
    for x in hum[:3]:
        print(f"-- comment by {x.get('user')}: {clean(x['body'])[:350]}")
    rc = [x for x in d.get('reviewComments', []) if not BOTS.search(x.get('user') or '')]
    for x in rc[:2]:
        print(f"-- review comment by {x.get('user')} on {x.get('path')}: {clean(x['body'])[:350]}")
    bots = [x for x in d.get('reviewComments', []) if BOTS.search(x.get('user') or '')]
    print(f"-- bot review comments: {len(bots)}; human review comments: {len(rc)}; human issue comments/reviews: {len(hum)}")
