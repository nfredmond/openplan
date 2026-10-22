"""Supplied API metadata remains separate from engine custody and quality."""
import base64
import copy
import hashlib
import json
import unittest

import test_engine_effects as fixtures
from retained_source import json_bytes
from task_observation import observe


UNSET=object()


class Checks(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.Checks(methodName='runTest');self.fixture.setUp()
        self.plan=self.fixture.open().plan
        self.value={'uuid':self.plan['taskUuid'],'name':self.plan['name'],'imagesCount':len(self.plan['uploads']),
            'options':copy.deepcopy(self.plan['options'])+[{'name':name,'value':True} for name in ('pc-ept','cog','gltf')],
            'status':{'code':30,'errorMessage':'Synthetic failure'},'progress':100,'processingTime':1500,'dateCreated':1791869373554}
    def tearDown(self):self.fixture.tearDown()
    def read(self,value=UNSET,status=200,body=None,plan=None):
        return observe(self.plan if plan is None else plan,status,json.dumps(self.value if value is UNSET else value).encode() if body is None else body)
    def changed(self,**fields):return {**copy.deepcopy(self.value),**fields}
    def refuses(self,value,reason):
        with self.assertRaisesRegex(ValueError,reason):self.read(value)

    def test_original_plan_is_required(self):
        changed=copy.deepcopy(self.plan);changed['sourceManifestSha256']='invalid'
        with self.assertRaisesRegex(ValueError,'Original engine plan'):self.read(plan=changed)
    def test_raw_bytes_and_plan_hash_are_exact(self):
        body=json.dumps(self.value,indent=2).encode()+b'\n';result=self.read(body=body)
        self.assertEqual(base64.b64decode(result['bodyBase64']),body,'Observation must retain exact original response bytes')
        self.assertEqual(result['bodySha256'],hashlib.sha256(body).hexdigest(),'Observation response hash must bind its exact bytes')
        self.assertEqual(result['bodyBytes'],len(body))
        self.assertEqual(result['originalPlanSha256'],hashlib.sha256(json_bytes(self.plan)).hexdigest(),'Observation must bind its complete original plan')
    def test_acknowledged_metadata_never_grants_permission(self):
        result=self.read()
        for field in ('engineIdentityVerification','originalActorAuthorization','sourceCustodyVerification','effectiveExecutionSettingsVerification','processingQualityVerification','freshnessVerification'):
            self.assertEqual(result[field],'unassessed',field+' cannot be promoted by supplied metadata')
        for field in ('transportPermission','publicationPermission'):self.assertIs(result[field],False,field+' must remain denied')
    def test_response_status_types_and_byte_bound(self):
        valid=json.dumps(self.value).encode()
        for status,body in [(201,valid),(200.0,valid),(True,valid),(200,bytearray(valid)),(200,valid+b' '*1048577)]:
            with self.assertRaisesRegex(ValueError,'response status, type or bound'):self.read(status=status,body=body)
    def test_response_object_and_error_presence(self):
        for value in ([],None,{},self.changed(error='')):self.refuses(value,'unavailable|fields differ')
    def test_required_metadata_is_not_filled_in(self):
        for field in self.value:
            value=copy.deepcopy(self.value);value.pop(field);self.refuses(value,'required fields')
    def test_duplicate_and_nonfinite_json_refuse(self):
        valid=json.dumps(self.value)
        for body in [valid.replace('{','{"uuid":"other",',1).encode(),(valid[:-1]+',"extra":NaN}').encode(),(valid[:-1]+',"extra":1e999}').encode(),b'\xff',b'{']:
            with self.assertRaises(ValueError):self.read(body=body)
    def test_original_uuid_and_name_match(self):
        for fields in ({'uuid':'other'},{'uuid':True},{'name':'changed'},{'name':None}):self.refuses(self.changed(**fields),'original UUID or name')
    def test_known_image_count_matches_exactly(self):
        for count in (0,1,3,True,2.0,-2):self.refuses(self.changed(imagesCount=count),'original image count')
    def test_unknown_image_count_remains_unassessed(self):
        result=self.read(self.changed(imagesCount=-1));self.assertIsNone(result['reportedImageCount'],'Unknown image count cannot become zero')
        self.assertEqual(result['imageCountVerification'],'unassessed')
    def test_requested_options_are_separate_from_added_flags(self):
        result=self.read();self.assertEqual(result['requestedOptions'],self.plan['options'])
        self.assertEqual(result['automaticPostprocessingOptions'],[{'name':name,'value':True} for name in ('pc-ept','cog','gltf')])
        self.assertEqual(result['reportedOptions'],self.value['options'])
    def test_option_shape_and_duplicate_names_refuse(self):
        for options in (None,[{}],[{'name':'x','value':[]}],[{'name':'x','value':True,'extra':0}],self.value['options']+[self.value['options'][-1]],self.value['options'][:-1]+[{**self.value['options'][-1],'extra':0}]):
            self.refuses(self.changed(options=options),'options shape|repeat a name')
    def test_requested_option_values_names_and_types_match(self):
        for options in ([{**self.value['options'][0], 'name':'different-requested-name'},*self.value['options'][1:]],
                        [{'name':'synthetic-flag','value':1},*self.value['options'][1:]],self.value['options'][1:]):
            self.refuses(self.changed(options=options),'original requested options')
    def test_engine_catalogue_order_preserves_exact_requested_names_and_values(self):
        requested = [{'name': name, 'value': value} for name, value in [
            ('max-concurrency', 1), ('feature-type', 'sift'), ('feature-quality', 'low'),
            ('fast-orthophoto', True), ('skip-3dmodel', True), ('orthophoto-resolution', 50)]]
        plan = self.fixture.open(root=self.fixture.base/'catalogue-order-effects', options=requested).plan
        reported = [requested[index] for index in (1, 2, 0, 4, 3, 5)]+[
            {'name': name, 'value': True} for name in ('pc-ept', 'cog', 'gltf')]
        result = self.read(self.changed(uuid=plan['taskUuid'], name=plan['name'], options=reported), plan=plan)
        self.assertEqual(result['requestedOptions'], requested, 'Saved original option order must remain exact')
        self.assertEqual(result['reportedOptions'], reported, 'Actual reported catalogue order must remain exact')
        self.assertEqual(result['processingQualityVerification'], 'unassessed')
        self.assertIs(result['publicationPermission'], False)

    def test_automatic_option_names_values_and_order_match_profile(self):
        for extra in ([{'name':'unknown','value':True}],[{'name':'cog','value':1}],[{'name':'cog','value':False}],
                      [{'name':'gltf','value':True},{'name':'pc-ept','value':True}]):
            self.refuses(self.changed(options=copy.deepcopy(self.plan['options'])+extra),'automatic option additions')
    def test_supported_automatic_subsets_and_explicit_false_are_preserved(self):
        for extra in ([],[{'name':'cog','value':True}],[{'name':'pc-ept','value':True},{'name':'gltf','value':True}]):
            result=self.read(self.changed(options=copy.deepcopy(self.plan['options'])+extra));self.assertEqual(result['automaticPostprocessingOptions'],extra)
        options=[{'name':'cog','value':False}];plan=self.fixture.open(root=self.fixture.base/'different-effects',options=options).plan
        result=self.read(self.changed(options=options),plan=plan);self.assertEqual(result['requestedOptions'],options);self.assertEqual(result['automaticPostprocessingOptions'],[])
    def test_reported_state_is_known_exact_integer(self):
        for status in ({'code':True},{'code':30.0},{'code':0},{'code':60},{'code':30,'extra':0},{}):self.refuses(self.changed(status=status),'reported state')
    def test_all_reported_states_stay_reported(self):
        for code,name in ((10,'queued'),(20,'running'),(30,'failed'),(40,'completed'),(50,'canceled')):
            result=self.read(self.changed(status={'code':code}));self.assertEqual(result['reportedState'],name)
            self.assertEqual(result['processingQualityVerification'],'unassessed')
    def test_reported_error_detail_is_bounded_or_missing(self):
        for detail in (1,[], 'x'*2049):self.refuses(self.changed(status={'code':30,'errorMessage':detail}),'error detail')
        self.assertIsNone(self.read(self.changed(status={'code':30}))['reportedErrorDetail'])
    def test_progress_is_reported_finite_range_not_defaulted(self):
        for progress in (True,None,-1,101,float('inf')):self.refuses(self.changed(progress=progress),'progress|finite')
        self.assertEqual(self.read(self.changed(progress=0))['reportedProgressPercent'],0)
    def test_huge_finite_progress_refuses_before_float_conversion(self):
        for progress in (10**400,-(10**400)):
            self.refuses(self.changed(progress=progress),'reported progress')
    def test_reported_times_are_exact_integer_ranges(self):
        for fields in ({'dateCreated':True},{'dateCreated':0.0},{'dateCreated':-1},{'processingTime':False},{'processingTime':1500.0},{'processingTime':-2}):
            self.refuses(self.changed(**fields),'reported time')
    def test_not_started_processing_time_is_distinct_from_zero(self):
        result=self.read(self.changed(processingTime=-1));self.assertIsNone(result['reportedProcessingTimeMs'],'Not-started time cannot become zero')
        self.assertEqual(result['processingTimeAssessment'],'not_started')
        result=self.read(self.changed(processingTime=0));self.assertEqual(result['reportedProcessingTimeMs'],0);self.assertEqual(result['processingTimeAssessment'],'reported')
    def test_inputs_and_outputs_do_not_alias(self):
        before=copy.deepcopy(self.plan);result=self.read();result['engine']['instanceId']='changed';result['requestedOptions'][0]['value']=False
        self.assertEqual(self.plan,before);self.assertEqual(self.read()['requestedOptions'],before['options'])
        result['automaticPostprocessingOptions'][0]['value']=False
        self.assertIs(result['reportedOptions'][-3]['value'],True,'Returned option views must not alias')


if __name__ == '__main__':unittest.main()
