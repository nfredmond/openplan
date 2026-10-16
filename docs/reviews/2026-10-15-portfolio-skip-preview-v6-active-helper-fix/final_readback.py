"""Final file-only readback against independent ROUND2's retained V5 bindings."""
import hashlib
import json
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
V5=ROOT.with_name('project-portfolio-skip-preview-20261015-v5')
PUBLIC5=HERE.with_name('2026-10-15-portfolio-skip-preview-v5-corrections')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def files_match(bindings,root):return all(sha(root/name)==expected for name,expected in bindings.items())
def main():
 review=json.loads((HERE/'review-bindings.json').read_text());reviewroot=Path(review['reviewRoot'])
 assert files_match(review['files'],reviewroot),'review-custody-drift'
 for name in review['files']:
  literal='docs/reviews/2026-10-15-portfolio-skip-preview-v5-independent-round2/'+name
  assert subprocess.check_output(['/usr/bin/git','show',review['reviewCommit']+':'+literal],cwd=HERE.parents[2])==(reviewroot/name).read_bytes(),'review-commit-mismatch'
 saved=json.loads((reviewroot/'source-bindings.json').read_text())
 assert files_match(saved['subjectPublicFiles'],PUBLIC5),'reviewed-V5-public-drift'
 assert files_match(saved['subjectSealedPrivateFiles'],V5),'reviewed-V5-private-drift'
 # Independent binding fault stays in memory. No old-file edits.
 assert files_match(dict(saved['subjectPublicFiles']),PUBLIC5),'harmless-binding-copy'
 bad=dict(saved['subjectPublicFiles']);bad['manifest.json']='0'*64
 def detector(check):assert not check(bad,PUBLIC5),'missing-V5-binding-refusal'
 detector(files_match)
 try:detector(lambda expected,root:True)
 except AssertionError as error:assert str(error)=='missing-V5-binding-refusal'
 else:raise AssertionError('disabled-binding-detector-survived')
 manifest=json.loads((HERE/'manifest.json').read_text())
 assert files_match(manifest['files'],ROOT),'V6-sealed-input-drift'
 assert sha(ROOT/'operation-files.sha256')==manifest['checksumListSHA256']
 assert not list((ROOT/'execution').iterdir()) and not (ROOT/'candidate').exists(),'operating-stage-ran'
 audit=json.loads((HERE/'final-audit.json').read_text())
 assert sha(HERE/'parent_recipe.sh')==audit['parentRecipeSHA256'] and sha(HERE/'manifest.json')==audit['manifestSHA256']
 # Complete current public known-value screen, without printing credentials.
 envs=json.loads((ROOT/'envs-private.json').read_text());values=set()
 for obj in [json.loads((ROOT/'app-env-private.json').read_text()),*envs.values()]:
  for key,value in obj.items():
   if any(word in key for word in ['KEY','SECRET','DATABASE_URL','DB_URI']) and len(value)>15:values.add(value.encode())
 assert values
 for path in HERE.rglob('*'):
  if path.is_file():
   data=path.read_bytes();assert not any(value in data for value in values),'known-secret';assert bytes.fromhex('e28094') not in data,'em-dash'
 report={'preparedOnly':True,'reviewCommit':review['reviewCommit'],'sixReviewFilesMatchCommit':True,
  'V5ReviewedPublicFiles':len(saved['subjectPublicFiles']),'V5ReviewedSealedPrivateFiles':len(saved['subjectSealedPrivateFiles']),
  'independentV5BindingsExact':True,'bindingHarmlessFaultAndDisabledComparatorControlsPass':True,
  'V6SealedInputsExact':True,'currentPublicKnownValueScreenPass':True,'operatingStages':0,
  'scope':'File hashes and retained independent bindings only. No live preservation, operating transport or acceptance result.'}
 with (ROOT/'final-readback-01.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 (HERE/'final-readback.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
