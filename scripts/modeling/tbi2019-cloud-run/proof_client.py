"""Local S3 transport proof helper, executed only on the owned Docker network."""
import hashlib
import json
import os
from pathlib import Path
import sys
import boto3
from botocore.config import Config

root=Path('/proof')
s3=boto3.client('s3',endpoint_url=os.environ['TBI_S3_ENDPOINT'],
    aws_access_key_id=os.environ['TBI_S3_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['TBI_S3_SECRET_ACCESS_KEY'],
    region_name='us-east-1',config=Config(signature_version='s3v4',s3={'addressing_style':'path'}))
bucket=os.environ['TBI_S3_BUCKET']
if sys.argv[1]=='seed':
    s3.create_bucket(Bucket=bucket)
    for name in ['proof-input/proof.tar.gz','corrupt.tar.gz']:
        s3.upload_file(str(root/name),bucket,Path(name).name)
    print(json.dumps({'seeded':2}))
else:
    objects=[]
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix='results/'):
        objects.extend(page.get('Contents',[]))
    for obj in objects:
        path=root/'retrieved'/obj['Key']; path.parent.mkdir(parents=True,exist_ok=True)
        s3.download_file(bucket,obj['Key'],str(path))
    verified=[]
    for terminal in sorted((root/'retrieved/results').glob('*/terminal.json')):
        folder=terminal.parent; state=json.loads(terminal.read_text())
        manifest=(folder/'manifest.json').read_bytes()
        assert hashlib.sha256(manifest).hexdigest()==state['manifest_sha256']
        for r in json.loads(manifest)['files']:
            path=folder/r['path']; assert path.stat().st_size==r['bytes']
            assert hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==r['sha256']
        # Object timestamps have second-level precision; runner order is tested separately.
        verified.append({'attempt':folder.name,'status':state['status'],'step':state['step'],
                         'error':state.get('error'),'files_verified':len(json.loads(manifest)['files'])})
    (root/'s3-verification.json').write_text(json.dumps(verified,indent=2)+'\n')
    print(json.dumps(verified))
