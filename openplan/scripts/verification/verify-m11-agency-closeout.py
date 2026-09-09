"""Independently reconstruct the synthetic agency acceptance case from downloaded files."""
from pathlib import Path
from decimal import Decimal
import argparse,csv,hashlib,json

def canonical_jsonb(value):
    if isinstance(value,dict):return {key:canonical_jsonb(value[key]) for key in sorted(value,key=lambda key:(len(key.encode()),key.encode()))}
    if isinstance(value,list):return [canonical_jsonb(item) for item in value]
    return value

def latest(rows,key):
    result={}
    for row in rows:
        if row[key] not in result or int(row['version'])>int(result[row[key]]['version']):result[row[key]]=row
    return list(result.values())

def verify(folder):
    json_path=folder/'closeout-b40809c2-826d-429d-9dcf-eaf87c7513da.json'
    csv_path=json_path.with_suffix('.csv')
    record=json.loads(json_path.read_text());content=record['content'];package=content['package'];state=package['state']
    computed=hashlib.sha256(json.dumps(canonical_jsonb(content),ensure_ascii=False,separators=(', ',': ')).encode()).hexdigest()
    assert computed==record['content_hash'],'Retained closeout content hash mismatch'
    assert package['formatVersion']==2,'Unexpected package format'
    actuals=[row for row in latest(state['actuals'],'entry_id') if row['command']['status']=='approved']
    assert len(actuals)==7,'Current cost source count'
    incurred=sum(Decimal(row['amount']) for row in actuals if row['command']['category'] in ('labor','expense'))
    hours=sum(Decimal(row['hours']) for row in actuals if row['command']['category']=='labor')
    assert incurred==Decimal('625.00') and hours==Decimal('60.00'),'Independent actual totals'
    for row in actuals:
        assert sum(Decimal(a['amount']) for a in row['allocations'])==Decimal(row['amount']),'Allocation cents do not reconcile'
        if row['command']['category']=='labor':
            assert row['time_entry_id'] and row['command']['staffId'],'Physical time/staff missing'
            assert all(a['taskId'] and a['deliverableId'] for a in row['allocations']),'Labor task/deliverable missing'
    baseline=max((b for b in state['baselines'] if b['state']=='approved'),key=lambda b:b['version'])
    underspend=Decimal(baseline['content']['cost'])-incurred
    assert underspend==Decimal('175.00') and baseline['content']['billingDirection']=='received','Approved budget perspective'
    events=state['closeout']['settlements'];assert len(events)==8 and len({e['content']['sourceKey'] for e in events})==8,'Distinct financial event custody'
    amounts={kind:sum(Decimal(e['content']['amount']) for e in events if e['content']['kind']==kind) for kind in ('payment','credit','refund','retention_hold','retention_release','dispute_open','dispute_resolve')}
    invoice=latest(state['receivedInvoices'],'invoice_id')[0]
    balance=Decimal(invoice['content']['total'])-amounts['payment']-amounts['credit']+amounts['refund']
    assert balance==0 and amounts['retention_hold']==amounts['retention_release'] and amounts['dispute_open']==amounts['dispute_resolve'],'Independent invoice settlement'
    delivery=state['closeout']['deliverableEvents'];assert [e['state'] for e in delivery]==['submitted','returned','resubmitted','accepted'],'Delivery event history'
    assert delivery[0]['source_receipt']['checksum']==delivery[1]['source_receipt']['checksum'] and delivery[2]['source_receipt']['checksum']==delivery[3]['source_receipt']['checksum'] and delivery[0]['source_receipt']['checksum']!=delivery[3]['source_receipt']['checksum'],'Corrected file custody'
    obligations=package['request']['obligations'];assert len(obligations)==1 and obligations[0]['status']=='open' and obligations[0]['dueOn']=='2026-10-15','Continuing obligation lost'
    assert state['rates']==[],'Private rate records included'
    with csv_path.open() as stream:
        reader=csv.DictReader(stream);assert len(reader.fieldnames)==25;rows=list(reader)
    exported=[r for r in latest([r for r in rows if r['record_type']=='actual_version'],'parent_id') if r['state']=='approved']
    assert len(exported)==7 and sum(Decimal(r['amount']) for r in exported)==incurred,'CSV current-source totals'
    assert sum(Decimal(r['hours']) for r in exported if r['hours']!='unassessed')==hours,'CSV labor hours'
    assert {r['record_id'] for r in exported}=={r['id'] for r in actuals},'CSV source-version identities'
    matches=[r for r in rows if r['record_type']=='received_cost_match'];assert len(matches)==1 and matches[0]['amount']=='25.00' and matches[0]['source_version_id'] in {r['id'] for r in actuals},'Matched cost lineage'
    import_row=next(r for r in rows if r['record_type']=='accounting_import_row');review=next(r for r in rows if r['record_type']=='accounting_review_version')
    assert import_row['external_id']==review['external_id']=='SYNTH-POST-01' and import_row['source_sha256']==review['source_sha256'] and len(import_row['source_sha256'])==64 and review['source_version_id']==matches[0]['source_version_id'],'Accounting reconciliation lineage'
    receipt={'synthetic':True,'closeoutId':record['id'],'contentHash':computed,'formatVersion':2,'incurred':str(incurred),'hours':str(hours),'underspend':str(underspend),'invoiceOpen':str(balance),'openObligations':1,'csvRows':len(rows),'csvColumns':25,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (json_path,csv_path)},'limitations':['Engineering reconstruction by a separate script, not independent human finance acceptance','Original received-invoice file checksum is absent from format-2 handoff','Report front-page legacy payment labels still need correction']}
    return receipt

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);parser.add_argument('--receipt',type=Path);args=parser.parse_args();result=verify(args.folder)
    if args.receipt:args.receipt.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
