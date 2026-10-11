"""Original retained ZIP member bytes. No image decoding or engine requests."""
import copy
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import tempfile
import time
import unittest
from unittest.mock import patch
import warnings
import zipfile

from admission_journal import Journal
import derived_zip as module
from retained_source import json_bytes


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='odm-derived-zip-')
        self.base = Path(self.temp.name);self.input = self.base/'input';self.input.mkdir(mode=0o700)
        self.source = self.base/'source';self.root = self.base/'derived';self.path = self.input/'original.zip'
        self.content = [('second/a.jpg',b'Original second ordinary bytes'),('first/a.JPG',b'Original first ordinary bytes'),('readme.txt',b'Ignored ordinary text')]
        self.write_zip()
        self.journal = Journal(self.base/'admissions')
        self.request = {'requestId':'synthetic-zip-request','externalRef':{'workspaceId':'synthetic-workspace','missionId':'synthetic-mission'},'imagery':{'type':'zip_url','url':'http://127.0.0.1:1/never.zip'}}
        self.journal.admit(self.request,lambda value:('synthetic-original-job',{'requestId':value['requestId'],'jobReference':'synthetic-original-job','status':'accepted'}),max_queued=2)
        self.context = {key:'synthetic-'+key for key in ('installationId','originalActorId','targetId','applicationJobId')}
        self.context.update(workspaceId='synthetic-workspace',missionId='synthetic-mission')
        self.source_arguments = {'journal':self.journal,'request_id':self.request['requestId'],'reference':'synthetic-original-job',
            'context':self.context,'source_root':self.input,'sources':['original.zip'],'destination':self.source,'max_bytes':1024*1024,'timeout':2}

    def tearDown(self): self.temp.cleanup()

    def write_zip(self, content=None):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            with zipfile.ZipFile(self.path,'w',zipfile.ZIP_DEFLATED) as archive:
                for name,raw in self.content if content is None else content: archive.writestr(name,raw)
        self.path.chmod(0o600)

    def prepare(self, **changes):
        return module.prepare(**{'source_arguments':self.source_arguments,'destination':self.root,
            'max_expanded_bytes':4096,'max_entries':100,'max_directory_bytes':1024*1024,'timeout':2,**changes})

    def footer(self, edit):
        raw = self.path.read_bytes();offset = raw.rfind(b'PK\x05\x06')
        values = list(struct.unpack('<4s4H2LH',raw[offset:offset+22]));edit(values)
        self.path.write_bytes(raw[:offset]+struct.pack('<4s4H2LH',*values)+raw[offset+22:])

    def directory(self, **changes):
        raw = self.path.read_bytes()
        return module.directory(**{'stream':io.BytesIO(raw),'size':len(raw),'max_entries':100,'max_metadata':1024*1024,'deadline':time.monotonic()+2,**changes})

    def zip64(self):
        raw = self.path.read_bytes();offset = raw.rfind(b'PK\x05\x06');values = list(struct.unpack('<4s4H2LH',raw[offset:offset+22]))
        record = struct.pack('<4sQ2H2L4Q',b'PK\x06\x06',44,45,45,0,0,values[4],values[4],values[5],values[6])
        locator = struct.pack('<4sLQL',b'PK\x06\x07',0,offset,1)
        values[3]=values[4]=65535;values[5]=values[6]=4294967295
        self.path.write_bytes(raw[:offset]+record+locator+struct.pack('<4s4H2LH',*values))

    def test_exact_ordered_bytes_and_distinct_basenames(self):
        receipt = self.prepare();rows = receipt['manifest']['sources']
        self.assertEqual([row['archiveMember'] for row in rows],['first/a.JPG','second/a.jpg'],'archive paths must keep deterministic original order')
        self.assertEqual([row['filename'] for row in rows],['image-00000.jpg','image-00001.jpg'],'equal basenames need distinct engine filenames')
        for row,raw in zip(rows,[self.content[1][1],self.content[0][1]]):
            self.assertEqual((self.root/row['objectRelativePath']).read_bytes(),raw)
            self.assertEqual(row['sha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(receipt['manifest']['archive']['sha256'],hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(receipt['manifest']['binding']['originalContext'],self.context)
        self.assertEqual(receipt['manifest']['imageDecodingVerification'],'unassessed')
        self.assertEqual(receipt['manifest']['authorityVerification'],'unassessed')

    def test_replay_needs_no_original_download(self):
        first = self.prepare();self.path.unlink();second = self.prepare()
        self.assertEqual(first,second,'complete derived replay must preserve exact original receipt')

    def test_missing_slot_recovers_from_retained_original_zip(self):
        first = self.prepare();(self.root/'objects/image-00001.bin').unlink();self.path.unlink()
        self.assertEqual(self.prepare(),first,'missing original slot must recover from exact retained ZIP')
        self.assertEqual((self.root/'objects/image-00001.bin').read_bytes(),self.content[0][1])

    def test_changed_context_and_limits_refuse(self):
        self.prepare()
        for changes in ({'max_expanded_bytes':8192},{'max_entries':200},{'max_directory_bytes':2*1024*1024},
                        {'source_arguments':{**self.source_arguments,'context':{**self.context,'originalActorId':'changed'}}}):
            with self.subTest(changes=changes),self.assertRaisesRegex(ValueError,'identity differs'): self.prepare(**changes)

    def test_changed_derived_plan_mapping_refuses(self):
        self.prepare();path = self.root/'plan.json';value = json.loads(path.read_bytes());value['images'][0]['archiveMember']='changed.jpg';path.write_bytes(json_bytes(value))
        with patch.object(module,'digest',side_effect=AssertionError('Derived bytes read before saved-plan validation')):
            with self.assertRaisesRegex(ValueError,'record differs'): self.prepare()

    def test_changed_derived_plan_shape_and_identity_refuse(self):
        self.prepare();path = self.root/'plan.json';original = path.read_bytes();value = json.loads(original);value['extra']=True;path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError,'identity differs'): self.prepare()
        value=json.loads(original);value['images']=[];path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError,'^Saved derived ZIP mapping differs$'): self.prepare()

    def test_changed_retained_image_refuses(self):
        self.prepare();path=self.root/'objects/image-00000.bin';raw=path.read_bytes();path.write_bytes(b'X'+raw[1:])
        with self.assertRaisesRegex(ValueError,'Retained derived ZIP image differs'): self.prepare()

    def test_unknown_derived_object_refuses(self):
        self.prepare()
        for name in ('extra-a.bin','extra-b.bin'):
            path=self.root/'objects'/name;path.write_bytes(b'extra');path.chmod(0o600)
        scan=module.os.scandir
        @contextmanager
        def bounded(path):
            with scan(path) as entries:
                def actual_entries():
                    for index,entry in enumerate(entries):
                        if index>=3:raise AssertionError('Derived object enumeration read beyond declared bound')
                        yield entry
                yield actual_entries()
        with patch.object(module.os,'scandir',bounded),self.assertRaisesRegex(ValueError,'object mapping differs'): self.prepare()

    def test_late_object_mapping_refuses(self):
        self.prepare();digest=module.digest
        def changed(*args,**kwargs):
            actual=digest(*args,**kwargs)
            if args[1]=='image-00001.bin': (self.root/'objects/image-00000.bin').rename(self.root/'objects/late.bin')
            return actual
        with patch.object(module,'digest',changed),self.assertRaisesRegex(ValueError,'object mapping differs'): self.prepare()

    def test_manifest_without_original_plan_refuses(self):
        self.prepare();(self.root/'plan.json').unlink()
        with self.assertRaisesRegex(ValueError,'manifest has no original plan'): self.prepare()

    def test_alias_public_and_overlapping_roots_refuse(self):
        self.prepare();alias=self.base/'alias';alias.symlink_to(self.root)
        with self.assertRaises(ValueError): self.prepare(destination=alias)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError): self.prepare()
        self.root.chmod(0o700)
        with self.assertRaisesRegex(ValueError,'must not overlap'): self.prepare(destination=self.source/'derived')

    def test_invalid_budgets_and_timeout_refuse(self):
        for key in ('max_expanded_bytes','max_entries','max_directory_bytes'):
            for value in (True,0,-1):
                with patch.object(module,'retain',side_effect=AssertionError('Source bytes read before derived budget admission')):
                    with self.subTest(key=key,value=value),self.assertRaises(ValueError): self.prepare(**{key:value})
        for value in (True,0,-1,float('nan'),float('inf')):
            with self.assertRaisesRegex(ValueError,'timeout'): self.prepare(timeout=value)
        with self.assertRaises(TimeoutError): self.prepare(timeout=1e-12)

    def test_footer_and_comment_guards(self):
        self.path.write_bytes(b'not a ZIP')
        with self.assertRaisesRegex(ValueError,'footer is missing'): self.directory()
        self.write_zip();self.footer(lambda values:values.__setitem__(7,10))
        with self.assertRaisesRegex(ValueError,'comment is inconsistent'): self.directory()

    def test_spanning_and_extent_guards(self):
        self.footer(lambda values:values.__setitem__(1,1))
        with self.assertRaisesRegex(ValueError,'Spanning'): self.directory()
        self.write_zip();self.footer(lambda values:values.__setitem__(6,0))
        with self.assertRaisesRegex(ValueError,'extent is inconsistent'): self.directory()

    def test_declared_directory_bounds_precede_zipfile_allocation(self):
        with patch.object(module.zipfile,'ZipFile',side_effect=AssertionError('ZIP index allocated before directory bounds')):
            for changes in ({'max_entries':2},{'max_directory_bytes':1}):
                with self.assertRaisesRegex(ValueError,'directory exceeds'): self.prepare(**changes)

    def test_actual_directory_count_and_record_guards(self):
        self.footer(lambda values:(values.__setitem__(3,1),values.__setitem__(4,1)))
        with self.assertRaisesRegex(ValueError,'Actual ZIP directory exceeds'): self.directory(max_entries=2)
        with self.assertRaisesRegex(ValueError,'record count differs'): self.directory()
        self.write_zip();raw=self.path.read_bytes();offset=raw.find(b'PK\x01\x02');self.path.write_bytes(raw[:offset]+b'XXXX'+raw[offset+4:])
        with self.assertRaisesRegex(ValueError,'record is inconsistent'): self.directory()

    def test_zip64_original_bytes_supported(self):
        self.zip64();receipt=self.prepare()
        self.assertEqual(len(receipt['manifest']['sources']),2,'bounded native ZIP64 index must derive original bytes')

    def test_zip64_locator_and_footer_guards(self):
        self.zip64();raw=self.path.read_bytes();offset=raw.find(b'PK\x06\x07');changed=bytearray(raw);struct.pack_into('<L',changed,offset+4,1);self.path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError,'locator is inconsistent'): self.directory()
        self.path.write_bytes(raw);offset=raw.find(b'PK\x06\x06');changed=bytearray(raw);struct.pack_into('<Q',changed,offset+4,43);self.path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError,'footer is inconsistent'): self.directory()

    def test_zip64_declarations_and_missing_locator_refuse(self):
        self.zip64();self.footer(lambda values:values.__setitem__(4,2));self.footer(lambda values:values.__setitem__(3,2))
        with self.assertRaisesRegex(ValueError,'declarations differ'): self.directory()
        self.write_zip();self.footer(lambda values:(values.__setitem__(3,65535),values.__setitem__(4,65535)))
        with self.assertRaisesRegex(ValueError,'locator is missing'): self.directory()

    def test_zip64_short_footer_refuses(self):
        self.zip64();raw=self.path.read_bytes();position=raw.find(b'PK\x06\x06')
        class Short(io.BytesIO):
            def read(self,size=-1):
                if self.tell()==position and size==56:return super().read(55)
                return super().read(size)
        with self.assertRaisesRegex(ValueError,'ZIP64 footer is incomplete'): self.directory(stream=Short(raw))

    def test_direct_directory_and_expansion_deadlines_refuse(self):
        with self.assertRaises(TimeoutError): self.directory(deadline=0)
        self.write_zip([])
        with self.assertRaises(TimeoutError): self.directory(deadline=0)
        self.write_zip()
        with zipfile.ZipFile(self.path) as archive,self.assertRaises(TimeoutError):
            module.expanded(archive,archive.infolist()[0],4096,0)

    def test_unsafe_repeated_and_noncanonical_members_refuse(self):
        for name in ('../a.jpg','/a.jpg','a\\b.jpg','a//b.jpg','./a.jpg','a\x00.jpg'):
            self.write_zip([('a.jpg' if '\x00' in name else name,b'ordinary')])
            if '\x00' in name: self.path.write_bytes(self.path.read_bytes().replace(b'a.jpg',b'a\x00jpg'))
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'name is unsafe'): self.prepare()
            shutil.rmtree(self.source);shutil.rmtree(self.root)
        self.write_zip([('a.jpg',b'a'),('a.jpg',b'b')])
        with self.assertRaisesRegex(ValueError,'name is unsafe'): self.prepare()

    def test_encrypted_and_special_members_refuse(self):
        with zipfile.ZipFile(self.path) as archive:
            original = archive.infolist()[0]
            for changes in ({'flag_bits':original.flag_bits|1},{'external_attr':(stat.S_IFLNK|0o600)<<16}):
                changed=copy.copy(original)
                for key,value in changes.items():setattr(changed,key,value)
                with patch.object(archive,'infolist',return_value=[changed]),self.assertRaisesRegex(ValueError,'Encrypted or special'):
                    module.members(archive,1,4096,time.monotonic()+2)

    def test_loaded_directory_census_refuses(self):
        with zipfile.ZipFile(self.path) as archive,self.assertRaisesRegex(ValueError,'Loaded ZIP directory count differs'):
            module.members(archive,1,4096,time.monotonic()+2)

    def test_no_images_and_expanded_budget_precede_reads(self):
        self.write_zip([('readme.txt',b'ordinary')])
        with self.assertRaisesRegex(ValueError,'no selected image'): self.prepare()
        shutil.rmtree(self.source);shutil.rmtree(self.root);self.write_zip()
        with patch.object(module,'expanded',side_effect=AssertionError('ZIP bytes read before expanded-budget admission')):
            with self.assertRaisesRegex(ValueError,'images exceed expanded'): self.prepare(max_expanded_bytes=1)

    def test_actual_expanded_size_and_budget_guards(self):
        class Archive:
            def open(self, _info): return io.BytesIO(b'AB')
        info=zipfile.ZipInfo('a.jpg');info.file_size=2
        with self.assertRaisesRegex(ValueError,'Actual ZIP image exceeds'): module.expanded(Archive(),info,1,time.monotonic()+2)
        info.file_size=1
        with self.assertRaisesRegex(ValueError,'Actual ZIP image size differs'): module.expanded(Archive(),info,100,time.monotonic()+2)

    def test_original_zip_descriptor_hash_is_rechecked(self):
        receipt=module.retain(**self.source_arguments);receipt['manifest']['sources'][0]['sha256']='0'*64
        with patch.object(module,'retain',return_value=receipt),self.assertRaisesRegex(ValueError,'retained ZIP hash differs'): self.prepare()

    def test_original_zip_descriptor_size_and_type_guards(self):
        receipt=module.retain(**self.source_arguments);receipt['manifest']['sources'][0]['bytes']+=1
        with patch.object(module,'retain',return_value=receipt),self.assertRaisesRegex(ValueError,'retained ZIP size differs'): self.prepare()
        receipt['manifest']['sources'][0]['bytes']-=1
        receipt['manifest']['binding']['originalRequest']['imagery']['type']='photo_manifest'
        with patch.object(module,'retain',return_value=receipt),self.assertRaisesRegex(ValueError,'One original retained ZIP'): self.prepare()

    def test_copied_byte_comparison_precedes_publication(self):
        expanded=module.expanded
        def changed(*args,**kwargs):
            actual=expanded(*args,**kwargs)
            if len(args)>=5 and args[4] is not None: actual['sha256']='0'*64
            return actual
        with patch.object(module,'expanded',changed),patch.object(module,'digest',side_effect=AssertionError('Unverified ZIP copy published')):
            with self.assertRaisesRegex(ValueError,'planned ZIP image bytes differ'): self.prepare()
        self.assertEqual(list((self.root/'objects').iterdir()),[],'unverified copy must not reach a fixed slot')

    def test_copy_sync_precedes_fixed_slot(self):
        fsync=os.fsync
        def interrupted(descriptor):
            path=Path(os.readlink('/proc/self/fd/'+str(descriptor)))
            if path.parent==self.root and path.name.startswith('.partial-') and path.read_bytes().startswith(b'Original'):
                raise OSError('controlled derived slot sync interruption')
            return fsync(descriptor)
        with patch.object(module.os,'fsync',interrupted),self.assertRaisesRegex(OSError,'controlled derived slot'): self.prepare()
        self.assertEqual(list((self.root/'objects').iterdir()),[],'unsynced copy must not reach a fixed slot')
        self.assertFalse((self.root/'manifest.json').exists())
        self.assertEqual(len(self.prepare()['manifest']['sources']),2)

    def test_insufficient_disk_refuses_before_copy(self):
        class Disk: free=0
        module.retain(**self.source_arguments)
        with patch.object(module.shutil,'disk_usage',return_value=Disk()),self.assertRaisesRegex(ValueError,'Insufficient free space'): self.prepare()
        self.assertEqual(list((self.root/'objects').iterdir()),[])

    def test_original_bytes_and_modes_unchanged_on_replay(self):
        self.prepare()
        self.assertEqual(stat.S_IMODE((self.root/'manifest.json').stat().st_mode),0o600,'derived manifest must remain private')
        def image(): return {str(path.relative_to(self.base)):(path.read_bytes(),stat.S_IMODE(path.stat().st_mode)) for root in (self.input,self.source,self.root) for path in root.rglob('*') if path.is_file()}
        original=image();self.prepare();self.assertEqual(image(),original,'complete replay must preserve ordinary bytes and private modes')


if __name__=='__main__': unittest.main()
