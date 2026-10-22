"""Replay supplied controls with new private outputs and frozen inputs read-only."""
import json
import os
from pathlib import Path
import shutil
import sys
import types

os.umask(0o077)
PUBLIC = Path(__file__).resolve().parent.parent/'2026-10-15-current-project-preview-app-binding'
ORIGINAL = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
PRIVATE = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')

def relocated(source):
    # Relocate test output only. Production template ROOT stays unchanged.
    return source.replace(str(ORIGINAL), str(PRIVATE))

def main():
    which = sys.argv[1]
    if which == 'prepare':
        for name in ['app_binding_v1.py','attest_start_v1.py','binding-private.json',
                     'app-env-private.json','app-v1.env','migrations.json',
                     'dependency-binding.json','recovery-active-binding.json']:
            shutil.copyfile(ORIGINAL/name,PRIVATE/name)
            (PRIVATE/name).chmod(0o600)
        return
    filename = {'consumer':'verify_controls.py','attestation':'verify_attestation.py',
                'small':'verify_small_guards.py','boundary':'verify_boundary.py'}[which]
    source = relocated((PUBLIC/filename).read_text())
    if which == 'attestation':
        # Its support builder reads the supplied consumer source. Relocate that
        # source in memory before any fixture directories or operation calls.
        old = "text=(PUBLIC/'verify_controls.py').read_text().split('\\nrows=campaign(m)\\n')[0]"
        new = old + '.replace('+repr(str(ORIGINAL))+','+repr(str(PRIVATE))+')'
        assert source.count(old)==1
        source=source.replace(old,new)
    if which == 'small':
        old="exec(compile(source,module.__file__,'exec'),module.__dict__)"
        assert source.count(old)==1
        source=source.replace(old,old+'\n    module.ROOT=PRIVATE')
    if which == 'boundary':
        source=source.replace('boundary-specimens-02','boundary-specimens-03')
    scope={'__file__':str(PUBLIC/filename),'__name__':'independent_replay'}
    exec(compile(source,str(PUBLIC/filename),'exec'),scope)

if __name__=='__main__':
    main()
