import subprocess,json,datetime,hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
ROOT=Path(__file__).parent
PAGES=ROOT/'pr-pages';PAGES.mkdir(exist_ok=True)
def api(endpoint):
 return json.loads(subprocess.check_output(['gh','api',endpoint],text=True))
repo=api('repos/pingdotgg/t3code');commit=api('repos/pingdotgg/t3code/commits/main')['sha']
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
rows=[]
def fetch_page(page):
 path=PAGES/f'{page:04}.json'
 if path.exists():return page,json.loads(path.read_text())
 batch=api(f'repos/pingdotgg/t3code/pulls?state=all&sort=created&direction=asc&per_page=100&page={page}')
 path.write_text(json.dumps(batch,ensure_ascii=False))
 return page,batch
finished=False
with ThreadPoolExecutor(max_workers=4) as pool:
 for first in range(1,1000,4):
  for page,batch in pool.map(fetch_page,range(first,first+4)):
   for x in batch:
    rows.append({k:x.get(k) for k in ['number','title','body','html_url','state','draft','created_at','updated_at','closed_at','merged_at']}|{'labels':[v['name'] for v in x['labels']],'author':x['user']['login'] if x['user'] else None})
   print(f'page={page} rows={len(rows)}',flush=True)
   if len(batch)<100:
    finished=True
    break
  if finished:break
assert len({x['number'] for x in rows})==len(rows)
(ROOT/'pull-requests.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows))
(ROOT/'pr-index.tsv').write_text('number\tstate\tmerged\ttitle\turl\n'+''.join(f"{x['number']}\t{x['state']}\t{bool(x['merged_at'])}\t{x['title'].replace(chr(9),' ').replace(chr(10),' ')}\t{x['html_url']}\n" for x in rows))
clone=ROOT/'t3code'
if not clone.exists():subprocess.run(['git','clone','--depth=1','--filter=blob:none','--sparse','https://github.com/pingdotgg/t3code.git',str(clone)],check=True)
subprocess.run(['git','sparse-checkout','set','docs','.github','.agents'],cwd=clone,check=True)
actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()
if actual!=commit:
 subprocess.run(['git','fetch','--depth=1','origin',commit],cwd=clone,check=True)
 subprocess.run(['git','checkout','--detach',commit],cwd=clone,check=True)
files=subprocess.check_output(['git','ls-tree','-r','--name-only',commit],cwd=clone,text=True).splitlines()
docs=[p for p in files if p.startswith('docs/') or p.lower().endswith(('.md','.mdx','.rst','.adoc'))]
(ROOT/'documentation-inventory.txt').write_text('\n'.join(docs)+'\n')
report={'repository':repo['full_name'],'sourceCommit':commit,'startedAt':start,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pullRequests':len(rows),'pages':page,'states':{k:sum(x['state']==k for x in rows) for k in ['open','closed']},'merged':sum(bool(x['merged_at']) for x in rows),'documentationPaths':len(docs),'allTreePaths':len(files),'maxPrNumber':max(x['number'] for x in rows),'corpusSha256':hashlib.sha256((ROOT/'pull-requests.jsonl').read_bytes()).hexdigest(),'scope':'Paginated all-state PR metadata and bodies, not all discussions or patches; repository documentation inventory at pinned source commit. PR data is collected over an interval.'}
(ROOT/'inventory.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
