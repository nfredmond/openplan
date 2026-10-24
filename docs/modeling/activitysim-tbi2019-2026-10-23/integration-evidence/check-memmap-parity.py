"""Check installed ActivitySim skim factories on the retained real input matrix set."""
import hashlib,json,tempfile,types,sys
from pathlib import Path
import numpy as np
import openmatrix as omx
from activitysim.core.skim_dict_factory import MemMapSkimFactory,NumpyArraySkimFactory
from activitysim.core import skim_dictionary
ROOT=Path('data/_screening_cache/tbi2019-integration').resolve();EVIDENCE=Path(__file__).resolve().parent
path=ROOT/'bundle/skims/mtc_skims.omx'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
with omx.open_file(str(path),'r') as source:
 names=list(source.list_matrices());size=int(source.shape()[0])
with tempfile.TemporaryDirectory(prefix='openplan-tbi2019-memmap-') as tmp:
 cache=Path(tmp)
 state=types.SimpleNamespace(get_injectable=lambda key,default=None:default,
  filesystem=types.SimpleNamespace(get_cache_dir=lambda:cache))
 network=types.SimpleNamespace(state=state,multiprocess=lambda:False)
 shape=(len(names),size,size) if skim_dictionary.ROW_MAJOR_LAYOUT else (size,size,len(names))
 info=types.SimpleNamespace(dtype_name='float32',skim_data_shape=shape,skim_tag='taz',
  omx_keys={name:name for name in names},omx_manifest={name:str(path) for name in names},
  block_offsets={name:i for i,name in enumerate(names)},omx_file_paths=[str(path)])
 dense_factory=NumpyArraySkimFactory(network)
 dense=dense_factory.allocate_skim_buffer(info).reshape(shape)
 dense_factory._read_skims_from_omx(info,dense)
 disk=MemMapSkimFactory(network).get_skim_data('taz',info)
 rows=np.repeat(np.arange(size),size);cols=np.tile(np.arange(size),size)
 def indexes(i):return (np.full(rows.shape,i),rows,cols) if skim_dictionary.ROW_MAJOR_LAYOUT else (rows,cols,np.full(rows.shape,i))
 def check(i):np.testing.assert_array_equal(disk[indexes(i)],dense[indexes(i)])
 for i in range(len(names)):check(i)
 # Harmless change: reverse traversal still checks every matrix value.
 for i in reversed(range(len(names))):check(i)
 cache_path=cache/'cached_taz.mmap';before=sha(cache_path)
 changed=np.memmap(cache_path,dtype='float32',mode='r+',shape=shape)
 cell=(0,0,0);original=changed[cell].copy();changed[cell]=np.float32(123456.0) if original!=123456.0 else np.float32(123457.0);changed.flush()
 caught=False
 try:check(0)
 except AssertionError:caught=True
 changed[cell]=original;changed.flush();changed._mmap.close();del changed
 if not caught:raise AssertionError('Deliberate skim corruption survived')
 if sha(cache_path)!=before:raise AssertionError('Cache restoration differs')
 check(0)
 record={'source_omx_sha256':sha(path),'activitysim_version':'1.5.1','matrices':len(names),
  'shape':list(shape),'dtype':'float32 unchanged from default factory','values_checked_per_traversal':len(names)*size*size,
  'parity':'all values exactly equal','harmless_controls':1,'intended_failures':1,'cache_restored_sha256':before,
  'blind_category':'factory value parity only; no behavior, RNG or scientific validity claim',
  'scope':'full real input matrices; no survey outcomes'}
 (EVIDENCE/'memmap-parity.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
