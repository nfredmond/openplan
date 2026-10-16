"""Selected POSIX/systemd host-entry tests. Every payload and unit is an owned stand-in."""
import hashlib
import json
from pathlib import Path
import types

PUBLIC=Path(__file__).resolve().parent
PACKET=PUBLIC.parent/'2026-10-15-current-project-preview-host-attestation-v2'
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-independent-round4-20261015')
ORIGINAL=ROOT.parent/'current-project-preview-host-attestation-v2-20261015'
adapter=ROOT/'runner-adapter';adapter.mkdir(mode=0o700)
# Adapt only fixture roots, hashes, unit names and the final non-business payload.
for name in ['manifest.json','PARENT_RECIPE.md','run_attest_host.sh']:
    adapter.joinpath(name).write_text((PACKET/name).read_text().replace(str(ORIGINAL),str(ROOT)))
source=(PACKET/'verify_runner.py').read_text().split("\nrun_case(1,'harmless comment first'",1)[0]
source=source.replace(str(ORIGINAL),str(ROOT)).replace('v2r3-case-','r4-case-').replace('openplan-host-attest-v2-standin-r3-','openplan-host-attest-review-r4-peer-')
h=types.ModuleType('independent_composition');h.__file__=str(adapter/'verify_runner.py')
(adapter/'verify_runner.py').write_text(source)
exec(compile(source,h.__file__,'exec'),vars(h))
assert h.ROOT==ROOT and ORIGINAL.as_posix() not in h.SOURCE
(ROOT/'specimens').mkdir(mode=0o700)
h.run_case(1,'harmless comment first',fault='comment')
h.run_case(2,'changed npm seal',fault='npm',reason='external-seal')
h.run_case(3,'attempt already reserved',fault='attempt',reason='attempt-exists')
h.run_case(4,'alternate entry',fault='entry',reason='runner-identity')
h.run_case(5,'old receipt present',fault='old-receipt',reason='receipt-exists')
h.run_case(6,'new receipt present',fault='new-receipt',reason='new-receipt-exists')
h.run_case(20,'removed seal accepts altered npm',fault='npm',remove='seal')
h.run_case(21,'removed attempt guard dispatches',fault='attempt',remove='attempt-exists')
h.run_case(22,'removed new receipt guard dispatches',fault='new-receipt',remove='new-receipt-exists')
h.run_case(30,'parent harmless first',fault='parent-comment',parent=True)
h.run_case(31,'parent external hash refuses changed runner',fault='parent-pin',reason='parent-hash',parent=True)
h.run_case(32,'parent external hash removal dispatches',fault='parent-unseal',parent=True)
h.run_case(33,'exact restored composition')
result={'adapterSourceSha256':hashlib.sha256((PACKET/'verify_runner.py').read_bytes()).hexdigest(),'cases':h.rows,'guardRemovalDetections':h.mutations,'restored':True,'limits':['Actual POSIX shell/systemd, proc peer access, namespaces and child resource caps; fixture roots, pins, unit names and final payload.','No actual attestor, fixed host unit, receipt, listener, HTTP, SQL/database/helper operation or business service dispatch.','Host controller retains same-user authority, Docker/proc/network permissions. Caps do not confine.']}
(ROOT/'composition.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'cases':len(h.rows),'guardRemovalDetections':len(h.mutations),'restored':True}))
