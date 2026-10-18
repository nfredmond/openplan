#!/usr/bin/python3
"""Final pure custody, builder, diagnostic and refusal checks after root grant."""
import json
import os
from pathlib import Path
import re
import sys
import types

import prepare
import run_tests


def diagnostic_guard(files):
    text='\n'.join('\n'.join(line for line in value.splitlines() if not line.lstrip().startswith('--')) for value in files.values())
    assert 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' in text,'diagnostic-read-only-transaction-missing'
    assert not re.search(r'\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b|\b(?:nextval|setval|set_config)\s*\(|SET\s+(?:LOCAL\s+)?ROLE\b|\\(?:!|connect)\b',text,re.I),'diagnostic-read-only-boundary'
    assert 'net.http_request_queue_id_seq' in files['original-error.sql'] and 'net.http_request_queue_id_seq' in files['corrected-fields.sql'],'diagnostic-fixed-sequence-missing'


def small_controls(out):
    expected={'memory.max':'1073741824','memory.swap.max':'0','cpu.max':'50000 100000'}
    source=Path(run_tests.__file__).read_text()
    anchor="if values!={'memory.max':'1073741824','memory.swap.max':'0','cpu.max':'50000 100000'}:"
    rows=[]
    for name in ['baseline','harmless','guard-omitted','restored']:
        text=source+'\n# Harmless runner comment.\n' if name=='harmless' else source.replace(anchor,'if False:',1) if name=='guard-omitted' else source
        path=out/(name+'-runner.py');path.write_text(text)
        module=types.ModuleType('inert_runner');module.__file__=str(path)
        exec(compile(text,str(path),'exec'),module.__dict__)
        try:
            assert module.require_limits(expected)==expected
            for key in expected:
                bad=dict(expected);bad[key]='MISSING'
                try:module.require_limits(bad)
                except ValueError as error:assert str(error)=='R6_BOUNDED_TEST_PARENT_REQUIRED'
                else:raise AssertionError('R6_LIMIT_GUARD_OMITTED')
        except AssertionError as error:
            assert name=='guard-omitted' and str(error)=='R6_LIMIT_GUARD_OMITTED';outcome='KILLED'
        else:
            assert name!='guard-omitted';outcome='SURVIVED' if name=='harmless' else 'PASS'
        rows.append({'trial':name,'outcome':outcome})
    proposal=prepare.EVIDENCE/'diagnostic-proposal'
    files={name:(proposal/name).read_text() for name in ['prelude.sql','original-error.sql','corrected-fields.sql']}
    diagnostic_guard(files)
    original=files['corrected-fields.sql'];path=out/'owned-diagnostic.sql';path.write_text(original)
    original_pin=prepare.pin(path);diagnostic_rows=[]
    for name in ['harmless-comment','sequence-write','table-write','restored']:
        try:
            if name=='harmless-comment':path.write_text(original+'\n-- Harmless diagnostic comment.\n')
            elif name=='sequence-write':path.write_text(original+"SELECT nextval('net.http_request_queue_id_seq');\n")
            elif name=='table-write':path.write_text(original+'CREATE TEMP TABLE forbidden_control(x int);\n')
            candidate=dict(files);candidate['corrected-fields.sql']=path.read_text()
            try:diagnostic_guard(candidate)
            except AssertionError as error:
                assert name in ['sequence-write','table-write'] and str(error)=='diagnostic-read-only-boundary';outcome='KILLED'
            else:
                assert name not in ['sequence-write','table-write'];outcome='SURVIVED' if name=='harmless-comment' else 'PASS'
            diagnostic_rows.append({'trial':name,'outcome':outcome})
        finally:path.write_text(original)
        assert prepare.pin(path)==original_pin,'diagnostic-exact-restoration-differs'
    return {'runner':rows,'diagnostic':diagnostic_rows,
        'blind':'Pure value guard and finite SQL source scan only; not a SQL parser, live transaction or native permissions proof.'}


def main():
    os.umask(0o077)
    out=prepare.EVIDENCE/'final-01';out.mkdir(mode=0o700)
    sys.path.insert(0,str(prepare.ROOT/'templates'))
    import controller,journal,policy
    seal=controller.sources()
    plan=json.loads((prepare.ROOT/'plan.json').read_text());oldplan=json.loads((prepare.OLD/'plan.json').read_text())
    assert prepare.FAILED_TARGET in plan['protected'] and plan['database']!=prepare.FAILED_TARGET
    assert {k:v for k,v in plan.items() if k not in ['database','fixture','tokenHash','protected']}=={k:v for k,v in oldplan.items() if k not in ['database','fixture','tokenHash','protected']}
    for suffix in ['', '-r2','-r3','-r4','-r5']:
        old=prepare.ROOT.with_name('a0-usage-limit-native-wrapper-20261016'+suffix)
        previous=json.loads((old/'plan.json').read_text())
        assert plan['database']!=previous['database']
        assert set(plan['fixture'].values()).isdisjoint(previous['fixture'].values())
    assert len(set(plan['fixture'].values()))==len(plan['fixture'])
    for name in prepare.RUNTIME:
        assert prepare.sha(prepare.SOURCE/name)==prepare.sha(prepare.ROOT/'templates'/name),'r6-template-source-differs:'+name
        if name!='controller.py':assert (prepare.SOURCE/name).read_bytes()==(prepare.OLD/'templates'/name).read_bytes(),'noncontroller-runtime-differs:'+name
    before=(prepare.OLD/'templates/controller.py').read_text()
    expected=before.replace('a0-usage-limit-native-wrapper-20261016-r5','a0-usage-limit-native-wrapper-20261016-r6').replace('--unit=openplan-a0-limit-r5-','--unit=openplan-a0-limit-r6-')
    expected=expected.replace('SELECT to_jsonb(s) FROM %I.%I s',"SELECT pg_catalog.jsonb_build_object(''last_value'',s.last_value,''log_cnt'',s.log_cnt,''is_called'',s.is_called) FROM %I.%I s")
    assert expected==(prepare.SOURCE/'controller.py').read_text(),'R6_CHANGE_EXCEEDS_APPROVED_BOUNDARY'
    prepared=json.loads((prepare.ROOT/'prepared-sql/pins.json').read_text())['files']
    rebuilt=prepare.emit_sql(out/'rebuilt-r6',prepare.ROOT/'templates',plan)
    assert prepared==rebuilt and len(rebuilt)==56
    previous=prepare.emit_sql(out/'rebuilt-r5-identities',prepare.ROOT/'templates',oldplan)
    assert previous==json.loads((prepare.OLD/'prepared-sql/pins.json').read_text())['files'],'R5-builder-body-changed'
    calls=[];original=journal.subprocess
    def forbidden(*args,**kwargs):calls.append(True);raise AssertionError('R6_SUBJECT_DISPATCH_FORBIDDEN')
    journal.subprocess=types.SimpleNamespace(Popen=forbidden,PIPE=-1)
    try:
        try:controller.launch('observe')
        except ValueError as error:assert str(error)=='MISSING_ROOT_ADMISSION:observe'
        else:raise AssertionError('R6_MISSING_ADMISSION_ACCEPTED')
    finally:journal.subprocess=original
    assert not calls and not (prepare.ROOT/'stages').exists() and not (prepare.ROOT/'admissions').exists()
    failed=prepare.OLD/'stages/restore419'
    for name in ['history.json','snapshot.json','definitions.json','complete.json','manager-terminal.json']:
        assert not (failed/name).exists(),'R5_FAILED_FENCE_CHANGED:'+name
    assert prepare.sha(failed/'controller/request-021/stderr.bin')=='ffa2a8d781640cc9a4a17e1a1daa1ba2e90d4e0137be34ba7e870865fc2c7080'
    dump=controller.DUMP
    assert not dump.is_symlink() and dump.stat().st_size==16232305 and prepare.sha(dump)==controller.DUMP_SHA
    sequence=json.loads((prepare.EVIDENCE/'sequence-controls-01/result.json').read_text())
    continuity=json.loads((prepare.EVIDENCE/'case-continuity-01/result.json').read_text())
    assert len(sequence['rows'])==12 and len(continuity['rows'])==12
    controls=small_controls(out)
    after=prepare.selected();prepare.write(prepare.EVIDENCE/'old-selected-after.json',after)
    prior=json.loads((prepare.EVIDENCE/'old-selected-before.json').read_text())
    assert prior==after,'R6_OLD_SELECTED_CUSTODY_CHANGED'
    syntax=[]
    for path in [*prepare.HERE.glob('*.py'),*prepare.SOURCE.glob('*.py')]:compile(path.read_text(),str(path),'exec');syntax.append(str(path))
    result={'packageSHA256':seal,'planSHA256':prepare.sha(prepare.ROOT/'plan.json'),
        'selectedOldPins':len(after),'selectedBeforeSHA256':prepare.sha(prepare.EVIDENCE/'old-selected-before.json'),
        'selectedAfterSHA256':prepare.sha(prepare.EVIDENCE/'old-selected-after.json'),
        'selectedUnchanged':True,'runtimeFiles':9,'bindingFiles':5,'precedingHelpers':7,
        'sourcePins':len(json.loads((prepare.ROOT/'bindings/source-pins.json').read_text())['files']),
        'migrationPins':421,'SQLRebuilds':56,'oldIdentityRebuilds':56,'sourceSyntaxFiles':len(syntax),
        'sequenceTrials':12,'continuityProbes':12,'smallControls':controls,'nativeDispatches':0,
        'admissionsAbsent':True,'stagesAbsent':True,'failedR5TargetExcluded':prepare.FAILED_TARGET,
        'freshReview':'REQUIRED; root-owned','claim':'Pure/source custody only; no R6 restoration or diagnostic acceptance'}
    prepare.write(out/'result.json',result)
    print(json.dumps({'selectedUnchanged':True,'sequenceTrials':12,'continuityProbes':12,'SQLRebuilds':56,'nativeDispatches':0}))


if __name__=='__main__':main()
