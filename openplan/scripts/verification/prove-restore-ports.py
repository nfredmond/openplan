"""Probe harmless and broken port selection in scratch modules, never a running drill."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2];original=(root/'scripts/ops/restore_ports.py').read_text();results=[]
for name,changed,expected in [
 ('harmless-port-comment',original+'\n# Selection leaves existing listeners untouched.\n',None),
 ('ignore-occupied-port',original.replace("probe.bind(('0.0.0.0', port))",'pass'),'test_skips_an_occupied_block'),
 ('ignore-ephemeral-range',original.replace('or low <= p <= high',''),'test_avoids_ephemeral'),
 ('reuse-source-ports',original.replace('p in excluded or ',''),'test_avoids_ephemeral'),
 ('swap-service-port-order',original.replace('OFFSETS = (1, 2, 0, 3, 4, 7)','OFFSETS = (2, 1, 0, 3, 4, 7)'),'test_preserves_the_six_service_positions'),
]:
 assert changed!=original
 path=Path('/tmp/openplan-m11-restore-port-control.py');path.write_text(changed)
 result=subprocess.run(['python3','-m','unittest','discover','-s','scripts/ops/tests','-p','test_restore_ports.py'],cwd=root,env={**os.environ,'RESTORE_PORTS_TEST_SOURCE':str(path)},capture_output=True,text=True)
 output=result.stdout+result.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(output)
 assert (result.returncode==0 if expected is None else result.returncode!=0 and expected in output),name+'\n'+output
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/restore-port-controls.json').write_text(json.dumps(results,indent=2)+'\n')
