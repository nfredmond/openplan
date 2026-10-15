"""Original private download leases with actual retained fixture files."""
import copy
import hashlib
import io
import json
import os
import stat
import time
import unittest
from unittest.mock import patch
import runtime_artifact_access as module
from retained_source import json_bytes
import test_runtime_artifact_plan as fixtures

class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.original=self.f.call();self.runtime=self.f.f.f.f.runtime
        self.request=self.f.request;self.observation=self.f.observation
        self.root=self.f.pack.parent;self.pack=self.root/'private-artifact-access'
        self.now=1000;self.allowed=True;self.calls=[]
        def authorize(binding, scope, deadline, *, owned):
            self.calls.append((copy.deepcopy(binding),scope,owned()))
            self.assertEqual(binding,self.original['manifest']['binding'],'Authority uses every original binding')
            self.assertEqual(scope,'original_application_artifact_download','Artifact access requests its distinct scope')
            self.assertGreater(deadline,time.monotonic(),'Authority receives a live deadline')
            self.assertTrue(owned(),'Authority observes original ownership')
            return self.allowed
        self.access=module.ArtifactAccess(self.f.plan,authorize,timeout=4,clock=lambda:self.now)
    def prepare(self,**changes):
        with self.runtime.owner():
            return self.access.prepare(self.request,self.observation,**{'public_base_url':'https://worker.example','expires_at':1100,**changes})
    def serve(self,lease,output=None,**changes):
        output=output if output is not None else io.BytesIO()
        fields={'request_id':self.request,'observation_hash':self.observation,'job_reference':lease['binding']['jobReference'],'token':lease['token'],'filename':'orthophoto.tif','output':output,**changes}
        with self.runtime.owner(): result=self.access.serve(**fields)
        return result,output.getvalue() if hasattr(output,'getvalue') else None
    def alter(self,name,change):
        p=self.pack/name;r=json.loads(p.read_bytes());change(r);p.write_bytes(json_bytes(r))
    def bytes(self):return (self.root/'private-products/objects/orthophoto.tif').read_bytes()
    def test_original_scope_roster_urls_and_private_records(self):
        lease=self.prepare()
        self.assertEqual(lease['binding'],self.original['manifest']['binding'],'Original lease preserves every binding')
        self.assertEqual(lease['artifactPlanSha256'],hashlib.sha256(json_bytes(self.original['manifest'])).hexdigest(),'Lease binds original manifest')
        self.assertEqual(lease['expiresAt'],1100,'Original expiry is fixed')
        self.assertEqual(lease['unselectedContractKinds'],['mesh','ortho_preview'],'Unselected products stay explicit')
        self.assertEqual(len(lease['artifacts']),4,'Original full roster stays present')
        for original,row in zip(self.original['manifest']['artifacts'],lease['artifacts']):
            self.assertEqual({k:row[k] for k in original},original,'Lease keeps exact descriptors')
            self.assertEqual(row['downloadUrl'],'https://worker.example/artifacts/'+lease['binding']['jobReference']+'/'+lease['token']+'/'+row['filename'] if row['availability']=='retained' else None,'Only retained files receive original URLs')
        self.assertIs(lease['terminalCallbackPermission'],False,'Download access cannot authorize terminal callback')
        for key in ('processingQualityVerification','requestedDeliverableCompletenessVerification','mapPlacementVerification'):
            self.assertEqual(lease[key],'unassessed','Lease cannot promote '+key)
        for name in ('lease.json','receipt.json'):
            self.assertEqual(stat.S_IMODE((self.pack/name).stat().st_mode),0o600,'Token records remain private')
    def test_replay_keeps_token_expiry_and_inode(self):
        first=self.prepare();inode=(self.pack/'lease.json').stat().st_ino
        with patch.object(module.secrets,'token_urlsafe',side_effect=AssertionError('Replay cannot replace token')):
            self.assertEqual(self.prepare(),first,'Replay keeps exact lease')
        self.assertEqual((self.pack/'lease.json').stat().st_ino,inode,'Replay keeps inode')
    def test_interrupted_lease_recovers_original(self):
        original=module.publish
        def interrupt(root,name,raw):
            original(root,name,raw)
            if root==self.pack and name=='lease.json':raise InterruptedError('Lease saved before completion')
        with patch.object(module,'publish',side_effect=interrupt),self.assertRaisesRegex(InterruptedError,'Lease saved before completion'):self.prepare()
        saved=(self.pack/'lease.json').read_bytes()
        with patch.object(module.secrets,'token_urlsafe',side_effect=AssertionError('Recovery cannot replace token')):self.prepare()
        self.assertEqual((self.pack/'lease.json').read_bytes(),saved,'Recovery preserves original bytes')
        self.assertTrue((self.pack/'receipt.json').exists(),'Recovery finishes original completion')
    def test_changed_base_refuses_redirect(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError,'cannot renew or redirect'):self.prepare(public_base_url='https://other.example')
    def test_changed_expiry_refuses_renewal(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError,'cannot renew or redirect'):self.prepare(expires_at=1200)
    def test_expiry_refuses_prepare_and_serve(self):
        lease=self.prepare();self.now=1100
        with self.assertRaisesRegex(PermissionError,'original lease expired'):self.prepare()
        with self.assertRaisesRegex(PermissionError,'original lease expired'):self.serve(lease)
    def test_revocation_precedes_preparation(self):
        self.allowed=False
        with self.assertRaisesRegex(PermissionError,'current original actor refused'):self.prepare()
        self.assertFalse(self.pack.exists(),'Revocation precedes token preparation')
    def test_revocation_after_lease_prevents_completion(self):
        original=module.publish
        def revoke(root,name,raw):
            original(root,name,raw)
            if root==self.pack and name=='lease.json':self.allowed=False
        with patch.object(module,'publish',side_effect=revoke),self.assertRaisesRegex(PermissionError,'current original actor refused'):self.prepare()
        self.assertTrue((self.pack/'lease.json').exists(),'Saved original remains for recovery')
        self.assertFalse((self.pack/'receipt.json').exists(),'Revocation prevents completion')
    def test_nonboolean_authority_refuses(self):
        self.allowed=1
        with self.assertRaisesRegex(ValueError,'authority must return a boolean'):self.prepare()
    def test_original_bytes_and_descriptor(self):
        lease=self.prepare();result,body=self.serve(lease);raw=self.bytes()
        self.assertEqual(body,raw,'Download serves exact original bytes')
        self.assertEqual(result,{'kind':'orthomosaic','sizeBytes':len(raw),'checksumSha256':hashlib.sha256(raw).hexdigest(),'contentType':'image/tiff'},'Served descriptor identifies original bytes')
    def test_completed_processing_does_not_reenter_stages(self):
        lease=self.prepare();self.f.f.f.f.app.f.receipt['authorizedNow']=False
        with patch.object(self.f.plan,'advance',side_effect=AssertionError('Serving cannot reenter processing')):_,raw=self.serve(lease)
        self.assertEqual(raw,self.bytes(),'Distinct access can serve completed job originals')
    def test_wrong_token_refuses_before_output(self):
        lease=self.prepare();output=io.BytesIO()
        with self.assertRaisesRegex(PermissionError,'original URL identity differs'):self.serve(lease,output,token='X'*43)
        self.assertEqual(output.getvalue(),b'','Wrong token releases no bytes')
    def test_wrong_job_refuses(self):
        lease=self.prepare()
        with self.assertRaisesRegex(PermissionError,'original URL identity differs'):self.serve(lease,job_reference='other-job')
    def test_unavailable_file_refuses(self):
        lease=self.prepare()
        with self.assertRaisesRegex(FileNotFoundError,'no retained original file'):self.serve(lease,filename='dtm.tif')
    def test_traversal_file_refuses(self):
        lease=self.prepare()
        with self.assertRaisesRegex(FileNotFoundError,'no retained original file'):self.serve(lease,filename='../lease.json')
    def test_size_refuses_before_output(self):
        lease=self.prepare();p=self.root/'private-products/objects/orthophoto.tif';p.write_bytes(self.bytes()+b'changed');output=io.BytesIO()
        with self.assertRaisesRegex(ValueError,'original file size differs'):self.serve(lease,output)
        self.assertEqual(output.getvalue(),b'','Size refusal precedes output')
    def test_checksum_refuses_complete_body(self):
        lease=self.prepare();p=self.root/'private-products/objects/orthophoto.tif';raw=self.bytes();p.write_bytes(b'X'+raw[1:]);output=io.BytesIO()
        with patch.object(module,'CHUNK',32),self.assertRaisesRegex(ValueError,'original file checksum differs'):self.serve(lease,output)
        self.assertLess(len(output.getvalue()),len(raw),'Checksum refusal withholds final chunk')
    def test_revocation_during_stream_withholds_final_chunk(self):
        lease=self.prepare();output=io.BytesIO();access=self
        class Revoking:
            def write(self,raw):access.allowed=False;return output.write(raw)
        with patch.object(module,'CHUNK',32),self.assertRaisesRegex(PermissionError,'current original actor refused'):self.serve(lease,Revoking())
        self.assertGreater(len(output.getvalue()),0,'Revocation happens during output')
        self.assertLess(len(output.getvalue()),lease['artifacts'][0]['sizeBytes'],'Revocation prevents complete body')
    def test_expiry_during_stream_withholds_final_chunk(self):
        lease=self.prepare();output=io.BytesIO();access=self
        class Expiring:
            def write(self,raw):access.now=1100;return output.write(raw)
        with patch.object(module,'CHUNK',32),self.assertRaisesRegex(PermissionError,'original lease expired'):self.serve(lease,Expiring())
        self.assertLess(len(output.getvalue()),lease['artifacts'][0]['sizeBytes'],'Expiry prevents complete body')
    def test_owner_loss_during_stream_withholds_final_chunk(self):
        lease=self.prepare();output=io.BytesIO();access=self
        class Abandoned:
            def write(self,raw):access.runtime._owned=False;return output.write(raw)
        with patch.object(module,'CHUNK',32),self.assertRaisesRegex(ValueError,'requires its lifetime owner'):self.serve(lease,Abandoned())
        self.assertLess(len(output.getvalue()),lease['artifacts'][0]['sizeBytes'],'Ownership loss prevents complete body')
    def test_saved_lease_alteration_refuses(self):
        lease=self.prepare();self.alter('lease.json',lambda r:r.update(artifactPlanSha256='0'*64))
        with self.assertRaisesRegex(ValueError,'saved original lease differs'):self.serve(lease)
    def test_saved_completion_alteration_refuses(self):
        lease=self.prepare();self.alter('receipt.json',lambda r:r.update(leaseSha256='0'*64))
        with self.assertRaisesRegex(ValueError,'original completion differs'):self.serve(lease)
    def test_missing_lease_cannot_be_replaced(self):
        self.prepare();(self.pack/'lease.json').unlink()
        with self.assertRaisesRegex(ValueError,'completion has no original lease'):self.prepare()
    def test_changed_observation_refuses(self):
        lease=self.prepare()
        with self.assertRaisesRegex(ValueError,'original descriptor binding differs'):self.serve(lease,observation_hash='0'*64)
    def test_symlink_product_refuses(self):
        lease=self.prepare();p=self.root/'private-products/objects/orthophoto.tif';target=p.with_name('other.tif');p.rename(target);p.symlink_to(target)
        with self.assertRaises(OSError):self.serve(lease)
    def test_hardlink_product_refuses(self):
        lease=self.prepare();p=self.root/'private-products/objects/orthophoto.tif';os.link(p,p.with_name('other.tif'))
        with self.assertRaisesRegex(ValueError,'private and owned without aliases'):self.serve(lease)
    def test_expired_deadline_refuses(self):
        lease=self.prepare()
        with self.assertRaisesRegex(TimeoutError,'deadline exceeded'):self.serve(lease,deadline=time.monotonic()-1)
    def test_no_owner_refuses(self):
        with self.assertRaisesRegex(ValueError,'requires its lifetime owner'):self.access.prepare(self.request,self.observation,public_base_url='https://worker.example',expires_at=1100)
    def test_partial_writes_keep_every_byte(self):
        lease=self.prepare();output=io.BytesIO()
        class Partial:
            def write(self,raw):return output.write(raw[:7])
        self.serve(lease,Partial());self.assertEqual(output.getvalue(),self.bytes(),'Partial writes keep every original byte')
    def test_no_progress_output_refuses(self):
        lease=self.prepare()
        class Stalled:
            def write(self,raw):return 0
        with self.assertRaisesRegex(OSError,'output made no progress'):self.serve(lease,Stalled())
    def test_path_prefix_refuses_before_lease_publication(self):
        with self.assertRaisesRegex(ValueError,'base URL differs'):
            self.prepare(public_base_url='https://worker.example/retained')
        for suffix in ('/retained/', '//', '/%2F'):
            with self.subTest(suffix=suffix),self.assertRaisesRegex(ValueError,'base URL differs'):
                module.base_url('https://worker.example'+suffix)
        self.assertFalse((self.pack/'lease.json').exists(),'Unserved prefixes cannot publish a lease')
        with self.runtime.owner():
            self.assertEqual(module.base_url('https://worker.example/'),'https://worker.example','Root slash remains usable')

    def test_invalid_base_refuses(self):
        for url in ('https://user:pass@worker.example','https://worker.example?','https://worker.example#'):
            with self.subTest(url=url),self.assertRaisesRegex(ValueError,'base URL differs'):self.prepare(public_base_url=url)
    def test_nonfinite_expiry_refuses(self):
        with self.assertRaisesRegex(ValueError,'expiry must be finite and positive'):self.prepare(expires_at=float('inf'))
    def test_invalid_constructor_refuses(self):
        with self.assertRaisesRegex(ValueError,'original descriptors and scoped authority'):module.ArtifactAccess(self.f.plan,None)
        with self.assertRaisesRegex(ValueError,'finite positive deadline'):module.ArtifactAccess(self.f.plan,lambda *_:True,timeout=0)
    def test_owner_loss_during_final_partial_write_refuses(self):
        lease=self.prepare();output=io.BytesIO();access=self
        class Abandoned:
            def write(self,raw):access.runtime._owned=False;return output.write(raw[:1])
        with self.assertRaisesRegex(ValueError,'requires its lifetime owner'):self.serve(lease,Abandoned())
        self.assertEqual(len(output.getvalue()),1,'Owner loss stops partial final output')

    def test_resume_uses_saved_settings_after_interruption(self):
        lease=self.prepare();(self.pack/'receipt.json').unlink()
        with self.runtime.owner(),patch.object(module.secrets,'token_urlsafe',side_effect=AssertionError('Resume cannot create token')):
            restored=self.access.resume(self.request,self.observation)
        self.assertEqual(restored,lease,'Resume keeps original base/token/expiry without caller settings')
        self.assertTrue((self.pack/'receipt.json').exists(),'Resume finishes original receipt')
    def test_resume_without_original_refuses(self):
        with self.assertRaisesRegex(ValueError,'resume requires its original lease'):
            self.access.resume(self.request,self.observation)
    def test_duplicate_filename_refuses(self):
        manifest=json.loads((self.f.pack/'manifest.json').read_bytes())
        manifest['artifacts'][1]['filename']=manifest['artifacts'][0]['filename']
        manifest['artifacts'][1]['localRelativePath']=manifest['artifacts'][0]['localRelativePath']
        self.rewrite_plan(manifest)
        with self.assertRaisesRegex(ValueError,'original roster differs'):self.prepare()
    def rewrite_plan(self,manifest):
        (self.f.pack/'manifest.json').write_bytes(json_bytes(manifest))
        receipt=json.loads((self.f.pack/'receipt.json').read_bytes());receipt['manifestSha256']=module.checksum(manifest)
        (self.f.pack/'receipt.json').write_bytes(json_bytes(receipt))
    def test_upstream_receipt_change_refuses(self):
        p=self.root/'private-products/receipt.json';r=json.loads(p.read_bytes());r['products'][0]['sha256']='0'*64;p.write_bytes(json_bytes(r))
        with self.assertRaisesRegex(ValueError,'original upstream receipts differ'):self.prepare()
    def test_self_consistent_changed_descriptor_refuses(self):
        manifest=json.loads((self.f.pack/'manifest.json').read_bytes());manifest['artifacts'][0]['checksumSha256']='0'*64
        self.rewrite_plan(manifest)
        with self.assertRaisesRegex(ValueError,'original upstream descriptors differ'):self.prepare()
    def test_lease_change_during_stream_refuses_complete_body(self):
        lease=self.prepare();output=io.BytesIO();access=self
        class Changing:
            def write(self,raw):
                access.alter('lease.json',lambda r:r.update(expiresAt=1200))
                return output.write(raw)
        with patch.object(module,'CHUNK',32),self.assertRaisesRegex(ValueError,'lease changed during download'):self.serve(lease,Changing())
        self.assertLess(len(output.getvalue()),lease['artifacts'][0]['sizeBytes'],'Lease change prevents complete body')
    def test_deadline_during_final_partial_write_refuses(self):
        lease=self.prepare();output=io.BytesIO();access=self;now=time.monotonic()
        class Delayed:
            def write(self,raw):
                clock.return_value=now+10
                return output.write(raw[:1])
        with patch.object(module.time,'monotonic',return_value=now) as clock,self.assertRaisesRegex(TimeoutError,'deadline exceeded'):self.serve(lease,Delayed(),deadline=now+1)
        self.assertEqual(len(output.getvalue()),1,'Deadline stops partial final output')

    def test_numeric_plan_permission_refuses(self):
        p=self.f.pack/'receipt.json';r=json.loads(p.read_bytes());r['callbackPermission']=0;p.write_bytes(json_bytes(r))
        with self.assertRaisesRegex(ValueError,'original descriptor binding differs'):self.prepare()
    def test_numeric_lease_permission_refuses(self):
        lease=self.prepare();self.alter('lease.json',lambda r:r.update(terminalCallbackPermission=0))
        with self.assertRaisesRegex(ValueError,'saved original lease differs'):self.serve(lease)
    def test_numeric_completion_permission_refuses(self):
        lease=self.prepare();self.alter('receipt.json',lambda r:r.update(terminalCallbackPermission=0))
        with self.assertRaisesRegex(ValueError,'original completion differs'):self.serve(lease)
    def test_changed_contract_coverage_refuses(self):
        manifest=json.loads((self.f.pack/'manifest.json').read_bytes());manifest['unselectedContractKinds']=[];self.rewrite_plan(manifest)
        with self.assertRaisesRegex(ValueError,'original contract coverage differs'):self.prepare()
    def test_nonobject_original_manifest_refuses(self):
        (self.f.pack/'manifest.json').write_bytes(json_bytes([]))
        with self.assertRaisesRegex(ValueError,'original manifest must be an object'):self.prepare()

    def test_receipt_type_change_during_stream_refuses_complete_body(self):
        lease=self.prepare();output=io.BytesIO();access=self
        class Changing:
            def write(self,raw):
                access.alter('receipt.json',lambda r:r.update(terminalCallbackPermission=0))
                return output.write(raw)
        with patch.object(module,'CHUNK',32),self.assertRaisesRegex(ValueError,'lease changed during download'):self.serve(lease,Changing())
        self.assertLess(len(output.getvalue()),lease['artifacts'][0]['sizeBytes'],'Receipt type change prevents complete body')

if __name__=='__main__':unittest.main()
