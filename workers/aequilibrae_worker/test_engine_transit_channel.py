"""Real reserved child consumes and skims parent-confirmed selected feed bytes."""
import json,os,socket,sys
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
from model_engine_channel import Channel,ChannelStopped,ProgressParent
from model_engine_process import EngineProcess
import model_command_journal as journal
import test_managed_transit_retention as fixtures
from test_model_skip_dispatch import aeq

CHILD='''
import json
from pathlib import Path
from model_engine_channel import inherited_progress_client
client=inherited_progress_client()
try:
 client.create_outputs()
 result=client.prepare_selected_transit()
 if result['status']=='retained':
  import numpy as np
  import gtfs_skim as gs
  import model_transit_inputs as inputs
  import model_transit_skim as transit
  _,raw,meta,settings=inputs.consume(result['record'],Path.cwd()/'child-transit')
  los=gs.load_feed(raw=raw,source_url=meta['source_url'],source_name=meta['source_name'])
  meta,skim,_=transit.skim_prepared_feed_version(los,meta,np.array([-121.050,-121.070]),np.array([39.200,39.220]),settings=settings)
  result={'status':'skimmed','available':bool(skim['available'][0,1]),'checksum':meta['feed_checksum_sha256']}
 Path('transit-result.json').write_text(json.dumps(result))
finally:client.stop()
'''


class TransitChannelTests(unittest.TestCase):
    setUp=fixtures.ManagedTransitTests.setUp
    response=fixtures.ManagedTransitTests.response

    def prepare(self):
        row=fixtures.ManagedTransitTests.prepare(self)
        Path(self.output).rmdir()
        self.callback=Mock(side_effect=aeq.prepare_managed_selected_transit_for_engine)
        return row

    def pair(self):
        left,right=socket.socketpair();left.settimeout(5);right.settimeout(5)
        self.addCleanup(left.close);self.addCleanup(right.close)
        return ProgressParent(left,self.writer,output_name='run_output',transit_preparer=self.callback),Channel(right)

    def request(self,parent,peer,operation,sequence,**extra):
        peer.send({'version':1,'sequence':sequence,'operation':operation,**extra})
        with patch.object(aeq,'requests',self.fake):parent.serve_one()
        return peer.receive()['result']

    def launch(self):
        handle=EngineProcess(self.writer,[sys.executable,'-B','-c',CHILD],
            env={'PATH':os.environ.get('PATH','/usr/bin'),'PYTHONPATH':str(Path(__file__).parent),
                 'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},
            progress=True,output_name='run_output',transit_preparer=self.callback)
        handle.progress.connection.settimeout(5)
        def cleanup():
            handle.progress.stop()
            if handle.process.poll() is None:handle.process.terminate()
            handle.process.wait(timeout=10)
        self.addCleanup(cleanup)
        return handle

    def test_child_consumes_registered_bytes_and_skims(self):
        self.prepare();handle=self.launch()
        with patch.object(aeq,'requests',self.fake):handle.progress.serve_one();handle.progress.serve_one()
        self.assertEqual(handle.process.wait(timeout=10),0,(handle.directory/'engine.log').read_text())
        receipt=handle.confirm_exit();self.assertFalse(receipt['execution_ready'])
        result=json.loads((self.root/'transit-result.json').read_text())
        self.assertEqual(result['status'],'skimmed');self.assertTrue(result['available'])
        self.assertEqual(result['checksum'],self.fake.version_rows[0]['checksum_sha256'])
        self.post.assert_called_once();self.assertFalse(journal.pending(self.directory,self.writer.context.destination))

    def test_lost_registration_never_reaches_child_skim(self):
        self.prepare();self.post.side_effect=TimeoutError('Synthetic lost reply');handle=self.launch()
        with patch.object(aeq,'requests',self.fake):
            handle.progress.serve_one()
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):handle.progress.serve_one()
        self.assertNotEqual(handle.process.wait(timeout=10),0)
        self.assertFalse((self.root/'transit-result.json').exists());self.assertFalse((self.root/'child-transit').exists())
        self.assertTrue(self.writer.stopped);self.assertEqual(len(journal.pending(self.directory,self.writer.context.destination)),1)

    def test_uncertain_write_not_reported_as_feed_unavailable(self):
        failure=aeq.WorkerStateWriteUnconfirmed('Synthetic uncertain custody')
        with patch.object(aeq,'retain_managed_selected_transit',side_effect=failure):
            with self.assertRaises(aeq.WorkerStateWriteUnconfirmed) as caught:
                aeq.prepare_managed_selected_transit_for_engine('unused')
        self.assertIs(caught.exception,failure)

    def test_selection_refusal_is_unavailable_without_stopping_writer(self):
        self.prepare();self.fake.version_rows[0]['workspace_id']='foreign'
        parent,peer=self.pair();self.request(parent,peer,'create_outputs',1)
        result=self.request(parent,peer,'prepare_selected_transit',2)
        self.assertEqual(result,{'status':'unavailable','no_feed_reason':'selected_feed_not_found'})
        self.assertFalse(self.writer.stopped);self.post.assert_not_called()

    def test_repeat_refused_before_second_preparation(self):
        self.prepare();parent,peer=self.pair();self.request(parent,peer,'create_outputs',1)
        self.request(parent,peer,'prepare_selected_transit',2)
        self.callback.side_effect=None;self.callback.return_value={}
        with self.assertRaisesRegex(ChannelStopped,'already requested'):self.request(parent,peer,'prepare_selected_transit',3)
        self.callback.assert_called_once()

    def test_child_cannot_override_selected_version(self):
        self.prepare();parent,peer=self.pair();self.request(parent,peer,'create_outputs',1)
        with self.assertRaises(ChannelStopped):self.request(parent,peer,'prepare_selected_transit',2,feed_version_id='foreign')
        self.callback.assert_not_called();self.post.assert_not_called()


if __name__=='__main__':unittest.main()
