"""Start only four bounded fixture API services against the reconstructed cluster."""
import importlib.util, json, os, subprocess
from pathlib import Path
import services, network_scope as n
from scope import NETWORK, DB_ID, DATABASE, require

OUT=Path(__file__).parent;PROOF=OUT.parent;ROLE=PROOF/'separate-cluster-point-20261011-02'
spec=importlib.util.spec_from_file_location('api_role_guard',ROLE/'guards.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
point=PROOF/'transit-expanded-local-point-20261011-03/source-point-private';restored=ROLE/'restored-private'/point.relative_to('/')


def verify_result(result):
    require(result['state'] == 'passed-native-database-continuation'
            and result['targetDatabase'] == DATABASE
            and result['databaseContainerId'] == DB_ID, 'api-database-result')

def main():
    os.umask(0o077);OUT.chmod(0o700)
    receipt=json.loads((ROLE/'container-receipt.json').read_text());result=json.loads((ROLE/'database-continuation-02-result.json').read_text())
    verify_result(result)
    n.verify_database_attachment(services.inspect(DB_ID),receipt,'openplan_gtfs_separate_cluster_20261011_02',ROLE/'mounted-root-private.key',guard.verify_container,True)
    network=json.loads((OUT/'network-result.json').read_text());info=json.loads(subprocess.check_output(['docker','network','inspect',network['networkId']]))[0];n.verify_network(info,network['networkId'],{DB_ID})
    snapshots=json.loads((restored/'configuration-private/source-services-private.json').read_text())
    config=json.loads((restored/'configuration-private/fresh-services-private.json').read_text())
    state={**config,'database':result['targetDatabase'],'api_url':'http://127.74.9.11:29941','services':{}}
    services.port_free('127.74.9.11',29941)
    try:
        receipts,runtime=services.start_stack('api',result['targetDatabase'],restored/'storage-objects',restored/'configuration-private/kong-runtime-private.json',snapshots,OUT,state)
        (OUT/'api-services-private.json').write_text(json.dumps(state,indent=2)+'\n')
        print(json.dumps({'state':'passed-native-api-readiness','database':state['database'],'serviceCount':len(receipts),'origin':state['api_url']}),flush=True)
    except BaseException:
        if state['services']:
            services.stop_stack(result['targetDatabase'],restored/'storage-objects',OUT/'api-kong-runtime-private.json',OUT,state,[])
        raise


if __name__=='__main__':main()
