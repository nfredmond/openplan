from pathlib import Path
import subprocess,hashlib,json,os
os.umask(0o077)
b=Path('/home/nathaniel/.local/state/openplan/pr330-workbook-keyset-native-proof-20261015')
r=Path('/home/nathaniel/.t3/worktrees/openplan/t3-953bb086')
out=r/'docs/reviews/2026-10-15-pr330-workbook-keyset-native-proof'
rev='75931937aa85950da68577abef1246d7f3c8ff13'
p=b/'module/openplan';p.mkdir(parents=True)
# Extract the complete small dependency graph identified by the prior proof, from exact Git objects.
old=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015/54537205/openplan')
bind={}
paths=sorted(old.rglob('*'))+[old/'src/lib/export/review-workbook-layout.ts']
for f in paths:
 if 'node_modules' in f.parts or not str(f.relative_to(old)).startswith('src/'):continue
 if not f.is_file() and str(f.relative_to(old))!='src/lib/export/review-workbook-layout.ts':continue
 rel=str(f.relative_to(old))
 try:data=subprocess.check_output(['git','show',rev+':openplan/'+rel],cwd=r,stderr=subprocess.DEVNULL)
 except subprocess.CalledProcessError:continue
 target=p/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 assert data==(r/'openplan'/rel).read_bytes()
 bind[rel]={'gitBlob':subprocess.check_output(['git','rev-parse',rev+':openplan/'+rel],cwd=r,text=True).strip(),'sha256':hashlib.sha256(data).hexdigest()}
(p/'node_modules').symlink_to('/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules',target_is_directory=True)
(b/'source-bindings.json').write_text(json.dumps({'head':rev,'appTree':subprocess.check_output(['git','rev-parse',rev+':openplan'],cwd=r,text=True).strip(),'files':bind},indent=2))
print('extracted',len(bind),'source files')
