"""Exact archive acquisition preserves supplied, URL, operator and bundled origins."""
import hashlib,os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
import requests
import gtfs_skim as gs
import test_transit_feed_handoff as fixtures


class ArchiveAcquisitionTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup);self.root=Path(temporary.name)
        self.raw=fixtures._feed_bytes()
        self.local=self.root/'operator.zip';self.local.write_bytes(self.raw)
        environment=patch.dict(os.environ,{'GTFS_URL':'','GTFS_PATH':'','GTFS_CACHE_DIR':str(self.root/'cache')})
        environment.start();self.addCleanup(environment.stop)

    def test_supplied_bytes_ignore_operator_urls_and_paths(self):
        with patch.dict(os.environ,{'GTFS_URL':'https://unused.invalid/feed','GTFS_PATH':'/missing'}),patch.object(requests,'get',side_effect=AssertionError('Unexpected download')):
            result=gs.acquire_feed_archive(raw=self.raw,source_url='original-source',source_name='Original')
        self.assertEqual(result,(self.raw,'original-source','Original'))
        self.assertFalse((self.root/'cache').exists())

    def test_downloaded_bytes_are_the_exact_cached_archive(self):
        url='https://synthetic.invalid/transit.zip'
        with patch.object(requests,'get',return_value=Mock(status_code=200,content=self.raw)) as get:
            result=gs.acquire_feed_archive(url=url)
        self.assertEqual(result,(self.raw,url,None));get.assert_called_once_with(url,timeout=120)
        cache=self.root/'cache'/('gtfs_feed_'+hashlib.md5(url.encode()).hexdigest()[:16]+'.zip')
        self.assertTrue(cache.is_file());self.assertEqual(cache.read_bytes(),self.raw)
        with patch.object(requests,'get',side_effect=AssertionError('Unexpected second download')):
            self.assertEqual(gs.acquire_feed_archive(url=url),result)

    def test_operator_path_and_bundled_default_keep_local_identity(self):
        with patch.dict(os.environ,{'GTFS_PATH':str(self.local)}):
            self.assertEqual(gs.acquire_feed_archive(),(self.raw,None,'operator.zip'))
        with patch.object(gs,'_DEFAULT_GTFS_PATH',str(self.local)):
            self.assertEqual(gs.acquire_feed_archive(),(self.raw,None,'operator.zip'))

    def test_existing_url_precedence_over_path_is_preserved(self):
        url='https://synthetic.invalid/explicit.zip'
        with patch.object(requests,'get',return_value=Mock(status_code=200,content=self.raw)) as get:
            result=gs.acquire_feed_archive(path=str(self.local),url=url)
        self.assertEqual(result,(self.raw,url,None));get.assert_called_once()

    def test_loader_parses_exact_acquisition_result_without_second_read(self):
        with patch.object(gs,'acquire_feed_archive',return_value=(self.raw,None,'Retained source')) as acquire:
            los=gs.load_feed(path='parent-path',url='parent-url')
        acquire.assert_called_once_with('parent-path','parent-url',raw=None,source_url=None,source_name=None)
        self.assertEqual(los.source_name,'Retained source');self.assertIsNone(los.source_url)
        self.assertEqual(los.n_routes,1);self.assertEqual(los.n_stops,3)


if __name__=='__main__':unittest.main()
