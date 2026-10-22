"""Write complete reading texts for the selected PRs: full cleaned body, complete
changed-file list, and all fetched human comments (as fetched: issue comments truncated
at 4000 chars, reviews and review comments at 2500 chars by fetch_pr_details.py).
Bot comments are counted, not reproduced. Output: scratch/full/batch-NN.txt (~55k chars).
Run: python3 -I scripts/full_text.py <research_dir>"""
import json, re, sys
from pathlib import Path
R = Path(sys.argv[1]); O = R/'scratch'/'full'; O.mkdir(parents=True, exist_ok=True)
BOTS = re.compile(r'(\[bot\]|macroscope|cursor|vercel|coderabbit|github-actions|chatgpt-codex|greptile|devin)', re.I)
def clean(t):
    t = re.sub(r'<!--.*?-->', '', t or '', flags=re.S); t = re.sub(r'!\[[^\]]*\]\([^)]*\)', '[img]', t)
    return re.sub(r'\n{3,}', '\n\n', t).strip()
sel = [int(l.split('\t')[0]) for l in (R/'evidence'/'deep-review-selection.tsv').read_text().splitlines()[1:] if l]
corp = {}
for l in (R/'pull-requests.jsonl').open():
    r = json.loads(l)
    if r['number'] in sel: corp[r['number']] = r
batch, size, idx, manifest = [], 0, 1, {}
def flush():
    global batch, size, idx
    if batch:
        (O/f'batch-{idx:02}.txt').write_text(''.join(batch)); idx += 1; batch, size = [], 0
for n in sel:
    c = corp[n]; d = json.loads((R/'pr-details'/f'{n}.json').read_text())
    hum = [x for x in d['issueComments'] + d['reviews'] if x.get('body') and not BOTS.search(x.get('user') or '')]
    rc = [x for x in d['reviewComments'] if not BOTS.search(x.get('user') or '')]
    nbot = sum(1 for x in d['issueComments'] + d['reviews'] + d['reviewComments'] if BOTS.search(x.get('user') or ''))
    s = [f"\n######## #{n} {c['title']}\nstate={c['state']} merged={c['merged_at']} declared_changed_files={d['pr'].get('changed_files')} files_endpoint={len(d['files'])}\n",
         "---- BODY (complete, cleaned) ----\n", clean(c['body']), "\n---- FILES (complete) ----\n",
         '; '.join(f"{f['filename']}(+{f['additions']}/-{f['deletions']})" for f in d['files']), "\n"]
    for x in hum: s.append(f"---- HUMAN COMMENT/REVIEW by {x.get('user')} ----\n{clean(x['body'])}\n")
    for x in rc: s.append(f"---- HUMAN REVIEW COMMENT by {x.get('user')} on {x.get('path')} ----\n{clean(x['body'])}\n")
    s.append(f"---- bot items counted, not reproduced: {nbot}\n")
    text = ''.join(s)
    if size + len(text) > 55000: flush()
    batch.append(text); size += len(text); manifest[n] = idx
flush()
(O/'manifest.json').write_text(json.dumps(manifest))
print(idx-1, 'batches')
