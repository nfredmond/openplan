"""Real child socket exchange with parent-owned journal and mocked HTTP."""
import json,os,socket,struct,subprocess,sys
from pathlib import Path
import unittest
from unittest.mock import patch
from model_engine_channel import Channel,ChannelStopped,ProgressParent,ProgressClient,MAX_FRAME
import model_command_journal as journal
import test_model_attempt_writer as fixtures


class EngineChannelTests(unittest.TestCase):
    setUp=fixtures.WriterTests.setUp
    response=fixtures.WriterTests.response

    def pair(self):
        parent,child=socket.socketpair()
        parent.settimeout(5);child.settimeout(5)
        self.addCleanup(parent.close);self.addCleanup(child.close)
        return ProgressParent(parent,self.writer),Channel(child)

    def request(self,sequence=1,**extra):
        return {'version':1,'sequence':sequence,'operation':'progress','log_tail':'Native iteration',**extra}

    def test_real_child_waits_for_parent_confirmed_write(self):
        parent,peer=self.pair()
        code='''
import socket,sys
from model_engine_channel import ProgressClient
connection=socket.socket(fileno=int(sys.argv[1]));connection.settimeout(5)
channel=ProgressClient(connection)
try:
 channel.progress('Native iteration 1')
 channel.progress('Native iteration 2')
 print('confirmed')
finally:channel.stop()
'''
        child=subprocess.Popen([sys.executable,'-B','-c',code,str(peer.connection.fileno())],
            pass_fds=(peer.connection.fileno(),),cwd=Path(__file__).parent,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        peer.connection.close()
        try:
            parent.serve_one();parent.serve_one()
            out,err=child.communicate(timeout=10)
            self.assertEqual(child.returncode,0,err)
            self.assertEqual(out.strip(),'confirmed')
            self.assertEqual(self.post.call_count,2)
            self.assertEqual(self.post.call_args.kwargs['json']['p_attempt_id'],self.writer.context.attempt_id)
            self.assertEqual(self.post.call_args.kwargs['json']['p_log_tail'],'Native iteration 2')
            self.assertEqual(journal.pending(self.directory,self.cmd['destination']),[])
        finally:
            if child.poll() is None:child.terminate()
            child.communicate(timeout=10)

    def test_duplicate_sequence_stops_without_second_write(self):
        parent,peer=self.pair();peer.send(self.request());parent.serve_one();peer.receive()
        peer.send(self.request())
        with self.assertRaises(ChannelStopped):parent.serve_one()
        self.assertEqual(self.post.call_count,1)
        self.assertTrue(self.writer.stopped)

    def test_child_identity_and_terminal_requests_refused(self):
        for request in (self.request(stage_id='foreign'),self.request(operation='succeeded')):
            self.writer.stopped=False
            parent,peer=self.pair();peer.send(request)
            with self.assertRaises(ChannelStopped):parent.serve_one()
        self.post.assert_not_called()

    def test_uncertain_write_closes_channel_and_keeps_pending_command(self):
        parent,peer=self.pair();self.post.side_effect=TimeoutError('Synthetic lost receipt')
        peer.send(self.request())
        with self.assertRaises(Exception):parent.serve_one()
        with self.assertRaises(ChannelStopped):peer.receive()
        self.assertTrue(self.writer.stopped)
        self.assertEqual(len(journal.pending(self.directory,self.cmd['destination'])),1)

    def test_lost_response_stops_after_one_confirmed_write(self):
        parent,peer=self.pair();peer.send(self.request())
        with patch.object(parent,'send',side_effect=BrokenPipeError('Synthetic response loss')):
            with self.assertRaises(BrokenPipeError):parent.serve_one()
        self.assertTrue(self.writer.stopped)
        self.assertEqual(self.post.call_count,1)
        self.assertEqual(journal.pending(self.directory,self.cmd['destination']),[])
        with self.assertRaises(ChannelStopped):peer.receive()

    def test_oversize_frame_refused_before_body_or_write(self):
        parent,peer=self.pair();peer.connection.sendall(struct.pack('!I',MAX_FRAME+1))
        with self.assertRaisesRegex(ValueError,'frame exceeds'):parent.serve_one()
        self.post.assert_not_called();self.assertTrue(self.writer.stopped)

    def test_client_refuses_wrong_acknowledgement(self):
        parent,peer=self.pair()
        client=ProgressClient(peer.connection)
        parent.send({'version':1,'sequence':2,'confirmed':True})
        with self.assertRaisesRegex(ChannelStopped,'acknowledgement differs'):
            client.progress('Native iteration')
        self.assertTrue(client.stopped)
        self.post.assert_not_called()

    def test_log_bound_refuses_before_write(self):
        parent,peer=self.pair();peer.send(self.request(log_tail='x'*20001))
        with patch.object(self.writer,'patch_stage',return_value={}) as write:
            with self.assertRaises(ChannelStopped):parent.serve_one()
        write.assert_not_called()
        self.post.assert_not_called()

    def test_duplicate_json_field_refused(self):
        parent,peer=self.pair();body=b'{"version":1,"version":1}'
        peer.connection.sendall(struct.pack('!I',len(body))+body)
        with self.assertRaisesRegex(ValueError,'Duplicate'):parent.serve_one()
        self.post.assert_not_called()


if __name__=='__main__':unittest.main()
