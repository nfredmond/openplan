#!/usr/bin/python3
"""Emit a separately reviewed, root-only READ ONLY proposal. Never dispatch."""
import json
from pathlib import Path

import prepare


def main():
    out=prepare.EVIDENCE/'diagnostic-proposal';out.mkdir(mode=0o700)
    container='a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
    target=prepare.FAILED_TARGET;oid=6212363;system='7683856985084612646'
    # Each transaction gets its own process and returned identity. The parent
    # validates a returned prelude in that SAME process before sending any body.
    identity="""SELECT pg_catalog.json_build_object('database',current_database(),'oid',(SELECT oid::pg_catalog.int8 FROM pg_catalog.pg_database WHERE datname=current_database()),'systemIdentifier',(SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()),'sessionRole',session_user,'currentRole',current_user,'adminSuperuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=session_user),'postgresSuperuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname='postgres'),'serviceBypassRLS',(SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname='service_role'),'pid',pg_backend_pid(),'applicationName',current_setting('application_name'),'readOnly',current_setting('transaction_read_only'));"""
    scope="""SELECT pg_catalog.json_build_object('pid',pg_backend_pid(),'database',current_database(),'readOnly',current_setting('transaction_read_only'),'originalScope',pg_catalog.json_build_object('databases',(SELECT json_agg(json_build_object('name',datname,'oid',oid,'owner',datdba,'acl',datacl,'config',(SELECT json_agg(to_jsonb(s)) FROM pg_db_role_setting s WHERE s.setdatabase=d.oid)) ORDER BY datname) FROM pg_database d WHERE datname<>current_database()),'roles',(SELECT md5(string_agg(md5(to_jsonb(r)::pg_catalog.text),'' ORDER BY oid)) FROM pg_authid r),'memberships',(SELECT md5(coalesce(string_agg(md5(to_jsonb(m)::pg_catalog.text),'' ORDER BY roleid,member,grantor),'')) FROM pg_auth_members m),'globalSettings',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::pg_catalog.text),'' ORDER BY setrole),'')) FROM pg_db_role_setting s WHERE setdatabase=0)));"""
    prelude="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='20s'; SET LOCAL application_name='a0-limit-wrapper';\n"+identity+'\n'+scope+'\n\\echo IDENTITY_AND_SCOPE_RETURNED\n'
    original='SELECT to_jsonb(s) FROM net.http_request_queue_id_seq s;\n'
    corrected="SELECT pg_catalog.json_build_object('pid',pg_backend_pid(),'database',current_database(),'oid',(SELECT oid::pg_catalog.int8 FROM pg_catalog.pg_database WHERE datname=current_database()),'systemIdentifier',(SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()),'sessionRole',session_user,'currentRole',current_user,'readOnly',current_setting('transaction_read_only'),'sequence',pg_catalog.jsonb_build_object('last_value',s.last_value,'log_cnt',s.log_cnt,'is_called',s.is_called)) FROM net.http_request_queue_id_seq s;\n"
    bodies={'original-error.sql':original+'ROLLBACK;\n',
            'corrected-fields.sql':corrected+corrected+scope+'\nROLLBACK;\n'}
    files={'prelude.sql':prelude,**bodies}
    for name,text in files.items():
        with (out/name).open('x') as stream:stream.write('-- PROPOSAL ONLY. No execution or admission. Private returned rows only.\n'+text)
        (out/name).chmod(0o600)
    prepare.write(out/'proposal.json',{
        'status':'UNADMITTED SELECT/READ ONLY PROPOSAL; root-owned independent review/decision required',
        'scope':'One fixed sequence on the exclusively owned failed R5 target; no stage repair, adoption, reuse or restore acceptance',
        'target':target,'targetOID':oid,'systemIdentifier':system,'sequence':'net.http_request_queue_id_seq',
        'argv':['/usr/bin/docker','exec','-i',container,'psql','-XqAt','-h','/var/run/postgresql','-p','5432','-w','-U','supabase_admin','-d',target,'-v','ON_ERROR_STOP=1'],
        'processes':'Two separate new exclusive journal requests, original error then corrected read. No request or stage replay.',
        'protocol':'Journal intent/input first. Start each fixed psql request with prelude only. Preserve returned PID/streams; wait a finite deadline for the exact prelude marker. Validate unchanged strict native policy, readOnly on, known database/OID/system/roles and same returned backend PID before sending the separately journaled body to that same process. Missing/mismatched prefix refuses without sending body.',
        'originalExpected':'Nonzero exit with the named no-composite-type sequence error. Actual full stderr hash may differ from the old DO-block context; retain it rather than inventing equality. No automatic retry.',
        'correctedExpected':'Two explicit three-field state reads, same positive PID/target/system/roles and readOnly on; unchanged state and originalScope; terminal zero after rollback. No backend-lifetime assumption.',
        'transactionScope':'Read-only repeatable-read sees one transaction snapshot, not all concurrent commits. Root must exclude other native/catalog operations and compare fresh scope prefixes across both requests; any discrepancy fences the diagnostic.',
        'noWrites':['no DDL/DML/temp objects/functions/triggers/RLS changes','no nextval/setval/increment/reset','no old receipt/admission/stage mutation','no credential discovery'],
        'parentBounds':{'memoryBytes':1073741824,'swapBytes':0,'cpuPercent':50,'RuntimeMaxSec':120},
        'nativeDispatches':0,'admission':None,'review':None,
        'files':{name:prepare.pin(out/name) for name in files}})
    print('Prepared root-only query proposal; no native request or admission')


if __name__=='__main__':main()
