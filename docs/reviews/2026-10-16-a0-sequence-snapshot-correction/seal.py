#!/usr/bin/python3
"""Seal terminal R6 preparation metadata outside the compiler lock."""
import json
import os
from pathlib import Path

import prepare


def main():
    os.umask(0o077)
    root=prepare.ROOT;evidence=prepare.EVIDENCE;public=prepare.HERE
    assert json.loads((evidence/'test-unit-01/exit.json').read_text())['exitCode']==0
    terminal=json.loads((evidence/'test-steps-terminal.json').read_text())
    assert len(terminal['rows'])==6 and all(row['exitCode']==0 for row in terminal['rows'])
    assert not (root/'admissions').exists() and not (root/'stages').exists()
    final=json.loads((evidence/'final-01/result.json').read_text())
    assert prepare.selected()==json.loads((evidence/'old-selected-before.json').read_text()),'selected-old-proof-changed-at-seal'
    for name in ['source-pins.json','preceding-helper-pins.json','inventory.json','proposed-target.json','admission.example.json','package-pins.json']:
        prepare.write(public/name,json.loads((root/'bindings'/name).read_text()))
    prepare.write(public/'prepared-sql-pins.json',json.loads((root/'prepared-sql/pins.json').read_text()))
    prepare.write(public/'checks.json',final)
    prepare.write(public/'controls.json',{
        'sequence':json.loads((evidence/'sequence-controls-01/result.json').read_text()),
        'continuity':json.loads((evidence/'case-continuity-01/result.json').read_text()),
        'smallControls':final['smallControls']})
    prepare.write(public/'terminal.json',{'unit':json.loads((evidence/'test-unit-01/exit.json').read_text()),
        'parent':json.loads((evidence/'test-parent.json').read_text()),'steps':terminal,
        'flock':'All granted R6 TEST work terminal. No further acquisition by this packet.'})
    prepare.write(public/'diagnostic-proposal.json',json.loads((evidence/'diagnostic-proposal/proposal.json').read_text()))
    helpers=evidence/'prepared-helpers';helpers.mkdir(mode=0o700)
    for path in sorted(public.glob('*.py')):
        with (helpers/path.name).open('xb') as stream:stream.write(path.read_bytes())
        (helpers/path.name).chmod(0o600)
    packet_files={str(path.relative_to(root)):prepare.pin(path) for path in sorted(root.rglob('*')) if path.is_file()}
    prepare.write(evidence/'packet-private-pins.json',packet_files)
    files={str(path.relative_to(evidence)):prepare.pin(path) for path in sorted(evidence.rglob('*')) if path.is_file()}
    prepare.write(evidence/'correction-private-pins.json',files)
    for tree in [root,evidence]:
        for path in [tree,*tree.rglob('*')]:
            assert not path.is_symlink(),str(path)
            mode=path.stat().st_mode&0o777
            assert mode==0o700 if path.is_dir() else mode in [0o600,0o700] if path.name=='run_stage.sh' else mode==0o600,str(path)
    prepare.write(public/'evidence-pins.json',{
        'packetRoot':str(root),'packetManifest':{'path':'packet-private-pins.json','sha256':prepare.sha(evidence/'packet-private-pins.json'),'entries':len(packet_files)},
        'privateRoot':str(evidence),'privateManifest':{'path':'correction-private-pins.json','sha256':prepare.sha(evidence/'correction-private-pins.json'),'entries':len(files)},
        'public':{str(path.relative_to(public)):{'sha256':prepare.sha(path),'bytes':path.stat().st_size} for path in sorted(public.rglob('*')) if path.is_file()},
        'selectedPrivateEvidence':{name:prepare.sha(evidence/name) for name in ['old-selected-before.json','old-selected-after.json','old-verification.json','sequence-controls-01/result.json','case-continuity-01/result.json','final-01/result.json','test-unit-01/exit.json','test-steps-terminal.json','diagnostic-proposal/proposal.json']},
        'packageSHA256':final['packageSHA256'],'planSHA256':final['planSHA256'],
        'sourceBase':'1b21ef6dbc3c9a75872ad6d36e6b7d369c6fda9a',
        'freshRootOwnedReview':'REQUIRED before final commit/admission unless root explicitly changes checkpoint ordering',
        'nativeDispatches':0,'admissionsAbsent':True,'stagesAbsent':True,'wrapperAcceptance':False})
    print(json.dumps({'publicFiles':len([path for path in public.rglob('*') if path.is_file()]),'packetFiles':len(packet_files),'correctionFiles':len(files),
        'packageSHA256':final['packageSHA256'],'planSHA256':final['planSHA256'],'nativeDispatches':0}))


if __name__=='__main__':main()
