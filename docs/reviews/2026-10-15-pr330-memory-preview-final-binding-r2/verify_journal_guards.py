"""Tiny new journal boundary controls, separate from accepted crash campaign."""
import json
import os
from pathlib import Path
import sys
import types
import uuid

from verify_delta import remove_guard

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
SOURCE=(HERE/'journal.py').read_bytes()


def case(source,reason):
    m=types.ModuleType('guard_copy');exec(compile(source,'journal-guard-copy','exec'),m.__dict__)
    root=PRIVATE/'fixtures'/('journal-guard-'+uuid.uuid4().hex);root.mkdir(mode=0o700);m.DURABLE=root
    if reason=='journal-private-directory':
        root.chmod(0o755);m.begin('fixture',{})
    elif reason=='journal-record-name':m.record('../escape',{'fixture':True})
    elif reason=='journal-operation-name':m.begin('../escape',{})
    else:
        m.sys=types.SimpleNamespace(argv=['fixture','badmode','fixture','--','/usr/bin/true'],stdout=sys.stdout,stderr=sys.stderr)
        try:m.main()
        except SystemExit as e:assert e.code==0


def main():
    os.umask(0o077);records=[]
    for reason in ['journal-private-directory','journal-record-name','journal-operation-name','journal-cli']:
        for source in [SOURCE,SOURCE+b'\n# harmless guard comment\n']:
            try:case(source,reason)
            except ValueError as e:assert str(e)==reason
            else:raise AssertionError('bad input accepted:'+reason)
        case(remove_guard(SOURCE,reason),reason)
        records.append({'case':reason,'result':'harmless survivor; intended refusal; removed guard accepts fault'})
    assert (HERE/'journal.py').read_bytes()==SOURCE
    value={'preparedOnly':True,'controls':records,'exactRestoration':True,
        'blindCategories':['private paths and /usr/bin/true stand-in only','no operating journal, DB, application or helper']}
    (PRIVATE/'records/journal-boundary-controls.json').write_text(json.dumps(value,indent=2)+'\n')
    (HERE/'journal-boundary-controls.json').write_text(json.dumps(value,indent=2)+'\n')
    print(json.dumps({'controls':len(records),'restored':True}))


if __name__=='__main__':main()
