"""Declared dependency metadata is separate from byte publication and acceptance."""
import copy
import gzip
import hashlib
import json
import unittest
import uuid
import model_validation_source_catalog as catalog


def fixture(method='aequilibrae'):
    context = {key:str(uuid.uuid4()) for key in ('workspace_id','model_run_id','stage_id','attempt_id')}
    context['method'] = method
    payloads, records, documents, bindings = {}, {}, {}, {}
    def artifact(name, content):
        payloads[name] = content
        return {'path':name,'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}
    def document(role, value):
        documents[role] = json.dumps({'schema':catalog.SCHEMAS[role], **value},sort_keys=True).encode()
        records[role] = artifact(role+'.json',documents[role])
        return records[role]
    inputs = {name:artifact(name+'.dat',('synthetic '+name).encode()) for name in ('registry','network','matcher','member','profile','coefficients','summary','conservation','output')}
    member = inputs['member']
    observed = document('observation_package', {'registry_artifact':inputs['registry'],'observations':[{'measurements':[{'source_member_path':member['path'],'source_member_sha256':member['sha256'],'exact_record_sha256':'a'*64}]}]})
    matched = document('match_audit', {'network_sha256':inputs['network']['sha256'],'registry_sha256':inputs['registry']['sha256'],'observation_package_sha256':observed['sha256'],'matcher':{'sha256':inputs['matcher']['sha256']}})
    stored = artifact(member['path']+'.gz',gzip.compress(payloads[member['path']],mtime=0))
    structural = document('structural_audit', {'method':method,'source_hashes':{'network/input':{**member,'stored_path':stored['path'],'stored_sha256':stored['sha256']}}})
    document('input_bundle', {'readiness_inputs':{'observation_package':observed,'pre_volume_match_audit':matched,'structural_audit':structural,'sources':[member]}})
    document('comparison_basis', {'method':method,'model_run_id':context['model_run_id'],'model_output_artifact':inputs['output'],
        'modeled_quantity':{'expansion_chain':{'run_summary_sha256':inputs['summary']['sha256'],'conservation_sha256':inputs['conservation']['sha256']}},
        'vehicle_basis':{'vehicle_pce_equivalence':{'assignment_profile_sha256':inputs['profile']['sha256']}},
        'assignment_settings':{'sha256':inputs['profile']['sha256']},'coefficient_package':{'sha256':inputs['coefficients']['sha256']},'network_state_hashes':{'network':inputs['network']['sha256']}})
    role_records = {
        '/input_bundle/readiness_inputs/observation_package':observed,
        '/input_bundle/readiness_inputs/pre_volume_match_audit':matched,
        '/input_bundle/readiness_inputs/structural_audit':structural,
        '/input_bundle/readiness_inputs/sources/0':member,
        '/observation_package/registry_artifact':inputs['registry'],
        '/observation_package/observations/0/measurements/0/source_member':member,
        '/match_audit/network_sha256':inputs['network'],
        '/match_audit/observation_package_sha256':observed,
        '/match_audit/registry_sha256':inputs['registry'],
        '/match_audit/matcher/sha256':inputs['matcher'],
        '/structural_audit/source_hashes/network~1input':stored,
        '/comparison_basis/model_output_artifact':inputs['output'],
        '/comparison_basis/modeled_quantity/expansion_chain/run_summary_sha256':inputs['summary'],
        '/comparison_basis/modeled_quantity/expansion_chain/conservation_sha256':inputs['conservation'],
        '/comparison_basis/vehicle_basis/vehicle_pce_equivalence/assignment_profile_sha256':inputs['profile'],
        '/comparison_basis/assignment_settings/sha256':inputs['profile'],
        '/comparison_basis/coefficient_package/sha256':inputs['coefficients'],
        '/comparison_basis/network_state_hashes/network':inputs['network'],
    }
    bindings.update(copy.deepcopy(role_records))
    return {'context':context,'documents':documents,'document_records':records,'bindings':bindings}


class CatalogTests(unittest.TestCase):
    def test_complete_declared_roles_preserve_phase_compression_and_limits(self):
        args = fixture(); before = copy.deepcopy(args)
        result = catalog.build_catalog(**args)
        self.assertEqual(args,before)
        self.assertEqual(len(result['entries']),23)
        self.assertEqual(result['context'],args['context'])
        entries = {row['role']:row for row in result['entries']}
        self.assertEqual(entries['/comparison_basis/modeled_quantity/expansion_chain/run_summary_sha256']['phase'],'execution')
        compressed = entries['/structural_audit/source_hashes/network~1input']
        self.assertEqual(compressed['logical_source']['compression'],'gzip')
        self.assertNotEqual(compressed['artifact']['sha256'],compressed['logical_source']['sha256'])
        self.assertFalse(result['stored_source_bytes_verified'])
        self.assertEqual(result['publication_state'],'not_published')
        self.assertEqual(result['scientific_acceptance'],'unassessed')
        args['bindings'] = dict(reversed(list(args['bindings'].items())))
        for row in args['bindings'].values(): row['harmless_note'] = 'not an evidence change'
        self.assertEqual(result,catalog.build_catalog(**args))
        args['bindings']['/match_audit/network_sha256']['path'] = 'later-change'
        self.assertNotEqual(entries['/match_audit/network_sha256']['artifact']['path'],'later-change')

    def test_all_missing_comparison_roles_are_named(self):
        args = fixture()
        missing = [key for key in args['bindings'] if key.startswith('/comparison_basis/') and key != '/comparison_basis/model_output_artifact']
        for key in missing: del args['bindings'][key]
        with self.assertRaises(catalog.SourceCatalogRefused) as caught: catalog.build_catalog(**args)
        for key in missing: self.assertIn(key + ': missing binding',caught.exception.problems)
        self.assertEqual(len(missing),6)

    def test_context_and_document_changes_are_refused(self):
        for field in ('method','model_run_id'):
            args=fixture(); args['context'][field] = 'activitysim' if field=='method' else str(uuid.uuid4())
            with self.subTest(field=field),self.assertRaisesRegex(catalog.SourceCatalogRefused,'differs from context'): catalog.build_catalog(**args)
        args=fixture();args['documents']['input_bundle'] += b' '
        with self.assertRaisesRegex(catalog.SourceCatalogRefused,'document bytes differ'):catalog.build_catalog(**args)

    def test_binding_hash_path_size_and_status_remain_explicit(self):
        role='/input_bundle/readiness_inputs/sources/0'
        for field,value,message in [('sha256','b'*64,'conflicts'),('path','wrong','conflicts'),('bytes',True,'malformed'),('bytes',999,'conflicts'),('status','unsupported','unsupported'),('status','unavailable','unavailable')]:
            args=fixture();args['bindings'][role][field]=value
            with self.subTest(field=field,value=value),self.assertRaisesRegex(catalog.SourceCatalogRefused,message):catalog.build_catalog(**args)
        args=fixture();args['bindings']['/undeclared']=copy.deepcopy(args['bindings'][role])
        with self.assertRaisesRegex(catalog.SourceCatalogRefused,'undeclared binding'):catalog.build_catalog(**args)

    def test_methods_and_attempts_remain_separate(self):
        first=fixture();second=fixture('activitysim');second['context']['model_run_id']=first['context']['model_run_id']
        basis=json.loads(second['documents']['comparison_basis']);basis['model_run_id']=first['context']['model_run_id']
        self.replace_document(second,'comparison_basis',basis)
        a,b=catalog.build_catalog(**first),catalog.build_catalog(**second)
        self.assertNotEqual(a['context']['method'],b['context']['method'])
        self.assertNotEqual(a['context']['attempt_id'],b['context']['attempt_id'])

    def replace_document(self,args,role,value):
        payload=json.dumps(value,sort_keys=True).encode();args['documents'][role]=payload
        args['document_records'][role].update(sha256=hashlib.sha256(payload).hexdigest(),bytes=len(payload))

    def test_unsupported_schema_and_coefficient_binding_refused(self):
        for field,value in [('schema','future.schema'),('coefficient_package',{'status':'unknown'})]:
            args=fixture();basis=json.loads(args['documents']['comparison_basis']);basis[field]=value
            self.replace_document(args,'comparison_basis',basis)
            with self.subTest(field=field),self.assertRaises(catalog.SourceCatalogRefused):catalog.build_catalog(**args)

    def test_duplicate_keys_and_nonfinite_documents_refused(self):
        for suffix in (b', "schema":"openplan.model-comparison-basis.v2"}', b', "bad":NaN}'):
            args=fixture();payload=args['documents']['comparison_basis'][:-1]+suffix
            args['documents']['comparison_basis']=payload
            args['document_records']['comparison_basis'].update(sha256=hashlib.sha256(payload).hexdigest(),bytes=len(payload))
            with self.subTest(suffix=suffix),self.assertRaisesRegex(catalog.SourceCatalogRefused,'invalid document JSON'):catalog.build_catalog(**args)

    def test_preparation_output_alias_is_refused(self):
        args=fixture();basis=json.loads(args['documents']['comparison_basis'])
        path=args['bindings']['/comparison_basis/assignment_settings/sha256']['path']
        basis['model_output_artifact']['path']=path
        self.replace_document(args,'comparison_basis',basis)
        args['bindings']['/comparison_basis/model_output_artifact']['path']=path
        with self.assertRaisesRegex(catalog.SourceCatalogRefused,'aliases model output'):catalog.build_catalog(**args)

    def test_runtime_summary_coefficient_binding_keeps_execution_phase(self):
        args=fixture();basis=json.loads(args['documents']['comparison_basis'])
        summary=args['bindings']['/comparison_basis/modeled_quantity/expansion_chain/run_summary_sha256']
        basis['coefficient_package']={'status':'bound_in_run_summary','run_summary_sha256':summary['sha256']}
        self.replace_document(args,'comparison_basis',basis)
        del args['bindings']['/comparison_basis/coefficient_package/sha256']
        role='/comparison_basis/coefficient_package/run_summary_sha256';args['bindings'][role]=copy.deepcopy(summary)
        records=catalog.build_catalog(**args)['entries']
        self.assertEqual(next(row for row in records if row['role']==role)['phase'],'execution')


if __name__ == '__main__':unittest.main()
