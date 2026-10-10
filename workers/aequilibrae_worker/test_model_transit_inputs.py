"""Original transit bytes and assumptions survive independent retained copies."""
import hashlib,json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import gtfs_skim as gs
import model_transit_inputs as inputs
import model_package_inputs as packages
import test_transit_feed_handoff as fixtures


class TransitInputTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.raw=fixtures._feed_bytes()
        self.meta={'feed_version_id':fixtures.VERSION_ID,'feed_checksum_sha256':hashlib.sha256(self.raw).hexdigest(),
                   'feed_service_end_date':'2020-01-01','feed_schedule_expired':True,'source_name':'Synthetic'}
        self.settings=gs.TransitSkimSettings(.2,7,2.25,2)

    def retain(self):return inputs.retain(self.raw,self.meta,self.settings,self.root/'retained')

    def test_original_bytes_metadata_and_settings_survive_independent_copy(self):
        record=self.retain();original=dict(self.meta);self.meta['source_name']='changed'
        copied,raw,meta,settings=inputs.consume(record,self.root/'consumed')
        self.assertEqual(raw,self.raw);self.assertEqual(meta,original);self.assertEqual(settings,self.settings)
        first=Path(record['package_directory'])/'feed.zip';second=Path(copied['package_directory'])/'feed.zip'
        self.assertNotEqual(first.stat().st_ino,second.stat().st_ino)
        self.assertEqual(second.stat().st_mode & 0o777,0o600)
        los=gs.load_feed(raw=raw,source_name=meta['source_name'])
        skim=gs.transit_skim(los,fixtures.COVERED_LONS,fixtures.COVERED_LATS,settings=settings)
        self.assertTrue(skim['available'][0,1]);self.assertEqual(skim['fare'][0,1],2.25)

    def test_mismatched_archive_refused_before_retention(self):
        self.meta['feed_checksum_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'checksum'):self.retain()
        self.assertFalse((self.root/'retained').exists())

    def test_tampered_retained_archive_or_metadata_refused(self):
        for name in ('feed.zip','transit.json'):
            with self.subTest(name=name):
                record=inputs.retain(self.raw,self.meta,self.settings,self.root/('retained-'+name))
                (Path(record['package_directory'])/name).write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError,'inventory'):inputs.consume(record,self.root/('copy-'+name))

    def test_generic_package_is_not_accepted_as_transit(self):
        retained=self.retain();source=Path(retained['package_directory'])
        (source/'unrelated').write_text('data')
        record=packages.retain(source,self.root/'generic')
        with self.assertRaisesRegex(ValueError,'inventory differs'):inputs.consume(record,self.root/'consumed')

    def test_same_size_metadata_change_after_copy_is_refused(self):
        record=self.retain();original=packages.consume
        def tamper(*args):
            copied=original(*args)
            path=Path(copied['package_directory'])/'transit.json'
            raw=path.read_bytes();changed=raw.replace(b'Synthetic',b'Forgeries')
            self.assertEqual(len(raw),len(changed));self.assertNotEqual(raw,changed)
            path.write_bytes(changed)
            return copied
        with patch.object(packages,'consume',side_effect=tamper):
            with self.assertRaisesRegex(ValueError,'bytes differ'):inputs.consume(record,self.root/'consumed')

    def test_changed_bytes_after_package_copy_are_refused(self):
        record=self.retain();original=packages.consume
        def tamper(*args):
            copied=original(*args)
            (Path(copied['package_directory'])/'feed.zip').write_bytes(b'changed')
            return copied
        with patch.object(packages,'consume',side_effect=tamper):
            with self.assertRaisesRegex(ValueError,'recorded private regular file'):inputs.consume(record,self.root/'consumed')


if __name__=='__main__':unittest.main()
