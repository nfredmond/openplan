"""Mutate disposable copies of the accepted root, preserving source bytes."""
from contextlib import closing
import importlib.util,json,os,shutil,sqlite3,tempfile
from pathlib import Path
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009');POINT=Path(__file__).parent.parent;SOURCE=POINT/'source-seed-03'
spec=importlib.util.spec_from_file_location('retained_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py');root=importlib.util.module_from_spec(spec);spec.loader.exec_module(root)
worker=SOURCE/'point-private/managed-stage-worker-private';expected=root.inventory(worker);before=root.inventory(worker);record=[]
protected=SOURCE/'point-private/configuration-private';scoped=json.loads((protected/'managed-stage-source-scope-private.json').read_text());logical=json.loads((protected/'managed-stage-logical-journals-private.json').read_text());attempt=Path(scoped['attemptWorkspace'])
root.equal_root(expected,json.loads(json.dumps(expected,sort_keys=True)));root.equal_root(expected,root.inventory(worker))
with tempfile.TemporaryDirectory(prefix='root-controls-',dir=Path(__file__).parent) as temporary:
 copied=Path(temporary)/'worker'
 def restore():
  if copied.exists():shutil.rmtree(copied)
  shutil.copytree(worker,copied)
 restore()
 variants=[('owner-marker',attempt/'attempt_owner.json','bytes'),('missing-input',attempt/'inputs/source.bin','remove'),('missing-output',attempt/'outputs/result.json','remove'),('missing-empty-directory',attempt/'scratch/empty','directory'),('private-mode',attempt/'inputs/source.bin','mode')]
 for label,relative,kind in variants:
  try:
   target=copied/relative
   if kind=='bytes':target.write_bytes(b'{}\n')
   elif kind=='remove':target.unlink()
   elif kind=='directory':target.rmdir()
   elif kind=='mode':target.chmod(0o400)
   try:root.equal_root(expected,root.inventory(copied))
   except ValueError as e:assert str(e)=='model-point-worker-root-differs'
   else:raise AssertionError('Changed root survived: '+label)
   record.append({'case':label,'refused':'model-point-worker-root-differs'})
  finally:restore();root.equal_root(expected,root.inventory(copied))
 for name in scoped['cases']:
  try:
   path=copied/name/'model-commands.sqlite3'
   with closing(sqlite3.connect(path)) as connection,connection:connection.execute('DELETE FROM execution_admissions')
   try:root.equal_journal(logical[name],root.sqlite_image(path))
   except ValueError as e:assert str(e)=='model-point-journal-records-differ'
   else:raise AssertionError('Removed admission survived')
   record.append({'case':name+'-missing-admission','refused':'model-point-journal-records-differ'})
  finally:restore();root.equal_journal(logical[name],root.sqlite_image(copied/name/'model-commands.sqlite3'))
root.equal_root(before,root.inventory(worker))
(Path(__file__).parent/'retained-root-controls.json').write_text(json.dumps({'baselineHarmlessRestored':True,'cases':record,'sourceRootUnchanged':True,'scope':'Inventory and complete SQLite-record checks on disposable copies. Does not revive writer objects, authorize predecessor reuse or fence a hostile/concurrent writer.'},indent=2)+'\n')
print(len(record),'retained-root native copy controls pass')
