"""Selected decisive real POSIX/systemd/inner-wrapper and single-entry controls.

Reuse the inspected instrumentation, not its full campaigns. Subjects stay exact.
Only NEW owned specimens, unit names and the small build fixture budget change.
"""
import json
import os
from pathlib import Path

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
SUBJECT=PUBLIC.parent/'2026-10-15-current-project-preview-app-binding-v3'
OUT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-v3-independent-round3-20261015')
SEALED=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')

text=(SUBJECT/'verify_composition.py').read_text()
old="ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')"
assert text.count(old)==1
text=text.replace(old,'ROOT=Path('+repr(str(OUT))+')')
text=text.replace('ROOT=Path('+repr(str(OUT))+')','ROOT=Path('+repr(str(OUT))+')\nSEALED=Path('+repr(str(SEALED))+')')
text=text.replace('str(ROOT).encode(),str(spec).encode()','str(SEALED).encode(),str(spec).encode()')
text=text.replace("SPEC=ROOT/'composed-recipe-07'","SPEC=ROOT/'composition-specimens-02'")
text=text.replace('openplan-binding-v3-composed01-','openplan-review-v3-r3-composed02-')
text=text.replace("        write(spec/'stage.sh',derived)","        assert b'ROOT='+str(spec).encode()+b'\\n' in derived, 'fixture-root-not-relocated'\n        write(spec/'stage.sh',derived)")
selection="""
selected=['harmless comment','broken outer-inner composition','writable donor','wrong sealed subject','remove seal check','restored']
cases=[next(row for row in cases if row[0]==name) for name in selected]
assert len(cases)==6 and cases[0][0]=='harmless comment'
"""
assert text.count("for phase in ['build','start']:")==1
text=text.replace("for phase in ['build','start']:",selection+"\nfor phase in ['build','start']:")
# The PROBE's fixed SEALED paths remain read-only subjects. ROOT now points to
# owned fixture outputs; its actual producer output was acquired by identity.py.
text=text.replace("ROOT/'actual-health-producer.json'","ROOT/'producer.json'")
text=text.replace("ROOT/'composed-controls-07.json'","ROOT/'composition.json'")
(OUT/'composition-adapted.py').write_text(text)
scope={'__file__':str(SUBJECT/'verify_composition.py'),'__name__':'review_composition'}
exec(compile(text,str(OUT/'composition-adapted.py'),'exec'),scope)
result=json.loads((OUT/'composition.json').read_bytes())
assert len(result['cases'])==12 and result['restored']

# One representative single-wrapper entry path. No active business dispatch.
entry=(SUBJECT/'verify_entry.py').read_text()
entry=entry.replace('from common import PUBLIC, ROOT as V2, ROOT as OUT, write',
    'PUBLIC=Path('+repr(str(SUBJECT))+')\nV2=Path('+repr(str(SEALED))+')\nOUT=Path('+repr(str(OUT))+')\n'
    'def write(path,value):\n    with path.open("x") as f:json.dump(value,f,indent=2);f.write("\\n")')
entry=entry.replace("for stage in ['active-check', 'checkout', 'attest']:","for stage in ['checkout']:")
entry=entry.replace('openplan-binding-v3-entry-','openplan-review-v3-r3-entry-')
entry=entry.replace("OUT/'entry-controls-01.json'","OUT/'entry.json'")
(OUT/'entry-adapted.py').write_text(entry)
exec(compile(entry,str(OUT/'entry-adapted.py'),'exec'),{'__file__':str(SUBJECT/'verify_entry.py'),'__name__':'review_entry'})
assert len(json.loads((OUT/'entry.json').read_bytes())['cases'])==3
print('Selected composition and single-wrapper entry controls restore owned subjects.')
