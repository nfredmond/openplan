"""Native solver drift checks using the existing supervised assignment fixture."""
import hashlib
import json
import os
from pathlib import Path

import verify_native_bound_assignment as proof

control = os.environ.get('OPENPLAN_LIVE_PROFILE_CONTROL', 'baseline')
mutations = {'target-drift': 'result.assignment.rgap_target = 0.01',
             'vdf-drift': 'result.assignment.vdf_parameters[0][0] = 0.16',
             'capacity-drift': 'result.assignment.capacity[0] += 1',
             'skip-guard': 'result.assignment.rgap_target = 0.01',
             'graph-drift': "result.assignment.capacity[0] += 1; result.classes[0].graph.graph.loc[result.classes[0].graph.graph['__supernet_id__']==0,'capacity'] += 1"}
mutations['skip-graph']=mutations['graph-drift']
mutations['centroid-through']='result.classes[0].graph.set_blocked_centroid_flows(False)'
mutations['compact-centroid']='result.classes[0].graph.compact_nodes_to_indices[result.classes[0].graph.centroids[0]] = 1'
mutations['skip-centroid-policy']=mutations['centroid-through']
assert control in ('baseline','harmless','restored','recorded-factor',*mutations)
injection = '''
from aequilibrae.paths import TrafficAssignment
original_execute = TrafficAssignment.execute
def marked_execute(self, *args, **kwargs):
 (Path(sys.argv[1])/'live-profile-execute-entered').write_text('entered')
 return original_execute(self, *args, **kwargs)
TrafficAssignment.execute = marked_execute
original_builder = main.build_traffic_assignment
def changed_builder(*args, **kwargs):
 result = original_builder(*args, **kwargs)
 MUTATION
 return result
main.build_traffic_assignment = changed_builder
'''.replace('MUTATION', mutations.get(control, 'pass'))
if control == 'skip-guard':
    injection += '\nimport model_assignment_live_profile\nmodel_assignment_live_profile.verify = lambda *args: {}\n'
if control == 'skip-graph':
    injection += '\nimport model_assignment_network_graph,model_assignment_network_source\nmodel_assignment_network_graph.verify = lambda assignment,database,settings: (model_assignment_network_source.identity(database), {})\n'
if control == 'skip-centroid-policy':
    injection += '\nimport model_assignment_network_graph\nmodel_assignment_network_graph._verify_centroids = lambda graph: None\n'
if control == 'recorded-factor':
    injection += '''
original_stage=main.stage_assignment
def adjusted_stage(*args,**kwargs):
 settings=main.assignment_network_settings({'default':1.25})
 payload=main.network_settings_payload_json(settings)
 kwargs.update(persisted_network_settings=settings,persisted_network_settings_payload_json=payload,persisted_network_settings_digest=main.network_settings_digest(settings,payload))
 return original_stage(*args,**kwargs)
main.stage_assignment=adjusted_stage
'''
if control == 'harmless': injection += '\n# Harmless native-profile comment.\n'
assert proof.CHILD.count('import main\n') == 1
proof.CHILD = proof.CHILD.replace('import main\n','import main\n'+injection)
output = Path(os.environ['OPENPLAN_BOUND_ASSIGNMENT_OUTPUT'])
failed = False
try:
    proof.main()
except AssertionError as error:
    if not str(error).startswith('Native child failed; inspect '): raise
    failed = True
if control in mutations:
    assert failed, 'Native solver drift was not refused'
    log = (output/'child.log').read_text()
    expected = {'target-drift':'settings differ', 'skip-guard':'settings differ',
                'vdf-drift':'VDF parameter values differ', 'capacity-drift':'network field values differ',
                'graph-drift':'source and recorded transformations','skip-graph':'source and recorded transformations',
                'centroid-through':'must block through-centroid','compact-centroid':'centroid node mapping differs',
                'skip-centroid-policy':'must block through-centroid'}[control]
    assert expected in log, 'Native child failed for an unrelated reason'
    failures = list(output.rglob('assignment-failure.json'))
    assert len(failures) == 1
    failure = json.loads(failures[0].read_text())
    assert failure['error_type'] == 'ValueError' and failure['active_project'] is False
    assert not list(output.rglob('live-profile-execute-entered'))
    assert not list(output.rglob('initial_assignment_inputs/manifest.json'))
    assert not list(output.rglob('link_volumes.csv'))
else:
    assert not failed
    manifests = list(output.rglob('initial_assignment_inputs/manifest.json'))
    assert len(manifests) == 1
    record = json.loads(manifests[0].read_text())['live_profile_verification']
    assert record['status'] == 'matched' and record['scope'] == 'initial_assignment_profile_fields'
    assert record['engine_version'] == '1.6.2'
    graph_record=json.loads(manifests[0].read_text())['network_graph_verification']
    assert graph_record['status']=='matched'
    assert graph_record['scope']=='directed_source_links_with_road_class_factors'
    assert graph_record['centroid_policy']=={'block_through_flows':True,'directed_and_compact_centroid_indices':'matched'}
    assert len(list(output.rglob('live-profile-execute-entered'))) == 1
report = {'control':control,'native_engine':'AequilibraE 1.6.2','refused_before_execution':failed,
    'source_sha256':hashlib.sha256((proof.WORKER/'model_assignment_live_profile.py').read_bytes()).hexdigest(),
    'limits':'Native two-centroid, one-link assignment in supervised child; injected parent database responses. No scientific acceptance, prepared network equality, demand transformation comparison or calibration coverage.'}
(output/'live-profile-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
