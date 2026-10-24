"""Keep raw local logs and commit byte-verifiable compressed copies."""
import gzip
import hashlib
import json
from pathlib import Path

E=Path(__file__).resolve().parent
records=[]
for source in sorted([*E.glob('*.engine.log'),*E.glob('*.memory.jsonl'),*E.glob('*.controller.log')]):
    target=source.with_name(source.name+'.gz')
    content=source.read_bytes()
    with target.open('wb') as raw:
        with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as stream:
            stream.write(content)
    inflated=gzip.decompress(target.read_bytes())
    records.append({'raw_name':source.name,'raw_bytes':len(content),'raw_sha256':hashlib.sha256(content).hexdigest(),
        'compressed_name':target.name,'compressed_bytes':target.stat().st_size,
        'compressed_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'inflates_byte_identically':inflated==content})
(E/'compressed-log-custody.json').write_text(json.dumps({'logs':records,'all_byte_identical':all(r['inflates_byte_identically'] for r in records)},indent=2)+'\n')
