"""Actual parent shell with owned stand-in runner and roots. Never runs an operating stage."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
REVIEW='df968613b36ea221c7ae510e5a0bb7bba046720a'
rows=[]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 fixture=ROOT/'context-tests/parent-recipe-01';fixture.mkdir(mode=0o700)
 for name in ['execution','home']:(fixture/name).mkdir(mode=0o700)
 # This command merely records the requested verb in a new owned specimen.
 runner=fixture/'run_stage.sh';runner.write_text('#!/bin/sh\nset -eu\nprintf "%s\\n" "$1" >> "$HOME/../dispatch.log"\n');runner.chmod(0o700)
 (fixture/'operation-files.sha256').write_text(sha(runner)+'  '+str(runner)+'\n')
 m=json.loads((HERE/'manifest.json').read_text())
 text=(HERE/'parent_recipe.sh').read_text().replace(str(ROOT),str(fixture)).replace('/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock',str(fixture/'standin.lock'))
 text=text.replace(m['checksumListSHA256'],sha(fixture/'operation-files.sha256')).replace(m['files']['run_stage.sh'],sha(runner))
 script=fixture/'recipe.sh';script.write_text(text)
 def invoke(stage,review=REVIEW):
  return subprocess.run(['/bin/sh',str(script),review,stage],env={'PATH':'/usr/bin:/bin','HOME':str(fixture/'home'),'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=20)
 def log():return (fixture/'dispatch.log').read_text() if (fixture/'dispatch.log').exists() else ''
 def refused(name,stage,phrase,review=REVIEW):
  before=log();result=invoke(stage,review);assert result.returncode!=0 and phrase in (result.stdout+result.stderr).decode(),name
  assert log()==before,'unexpected-standin-dispatch';rows.append({'case':name,'outcome':'REFUSED'})
 result=invoke('preflight');assert result.returncode==0 and log()=='preflight\n';rows.append({'case':'one-preflight-only-harmless','outcome':'SURVIVED'})
 refused('duplicate-admission','preflight','FileExistsError')
 refused('missing-restore-readiness','restore','Required preceding artifact absent: preflight-ready.json')
 refused('missing-post-runtime','post-journey','Required preceding artifact absent: runtime-start-attestation.json')
 refused('review-mismatch','restore','ROUND2 admission differs','49e3fa2004c1336ffa36c134a8f21bcc2d72d327')
 before=log();bad=invoke('arbitrary-command');assert bad.returncode==2 and log()==before;rows.append({'case':'unknown-stage-refuses','outcome':'REFUSED'})
 # Harmless shell comment survives a named missing-prerequisite detector.
 script.write_text('# harmless wording\n'+text)
 refused('harmless-comment-preserves-gate','post-journey','Required preceding artifact absent: runtime-start-attestation.json')
 original_log=log()
 try:
  fault=text.replace("if not p.is_file() or p.is_symlink():raise SystemExit('Required preceding artifact absent: '+name)",'pass')
  assert fault!=text;script.write_text(fault)
  result=invoke('post-journey');assert result.returncode==0 and log()==original_log+'post-journey\n'
  rows.append({'case':'remove-prerequisite-codefault-detected','outcome':'KILLED','reason':'Missing artifact permits the stand-in post verb, which the detector rejects.'})
 finally:
  script.write_text(text);(fixture/'dispatch.log').write_text(original_log)
 # Supplying both future receipts permits exactly the post verb in the stand-in.
 for name in ['runtime-start-attestation.json','protected-runtime-before.json']:(fixture/name).write_text('{}\n')
 result=invoke('post-journey');assert result.returncode==0 and log()==original_log+'post-journey\n'
 rows.append({'case':'one-post-verb-only-with-prerequisites','outcome':'SURVIVED'})
 assert not list((ROOT/'execution').iterdir()) and not (ROOT/'candidate').exists()
 result={'scope':'Actual parent shell, fixed external checks and real predecessor gate against new owned stand-ins. The runner only appends a verb; no systemd/app/helper/DB/browser stage dispatches. REVIEW here is a syntactic fixture token, not acceptance of its content.', 'cases':rows,'codeAndLogRestoredInFinally':True,'operatingStages':0,'blindCategories':['Human review acceptance is not encoded by commit existence.','Future receipts here are stand-ins; operating domain guards must reacquire real identities.']}
 (ROOT/'parent-recipe-controls-01.json').write_text(json.dumps(result,indent=2)+'\n');(HERE/'parent-recipe-controls.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'cases':len(rows),'operatingStages':0}))
if __name__=='__main__':main()
