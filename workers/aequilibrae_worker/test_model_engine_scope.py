"""Project cleanup on partial open, computation failure and interruption."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
import model_engine_scope as scope
from test_model_skip_dispatch import aeq


class EngineScopeTests(unittest.TestCase):
    def test_success_closes_once(self):
        project=Mock()
        with scope.project_scope(lambda:project,'/synthetic') as opened:self.assertIs(opened,project)
        project.open.assert_called_once_with('/synthetic');project.close.assert_called_once_with()

    def test_creation_failure_still_closes(self):
        project=Mock();failure=ValueError('partial create');project.new.side_effect=failure
        with self.assertRaises(ValueError) as caught:
            with scope.project_scope(lambda:project,'/synthetic',create=True):self.fail('Entered failed create')
        self.assertIs(caught.exception,failure);project.close.assert_called_once_with()

    def test_partial_open_closes_and_stops_managed_writer(self):
        project=Mock();project.open.side_effect=ValueError('partial open');writer=Mock(stopped=False)
        with patch.object(scope.model_attempt_writer,'current',return_value=writer),self.assertRaises(ValueError):
            with scope.project_scope(lambda:project,'/synthetic'):self.fail('Entered failed open')
        project.close.assert_called_once_with();self.assertTrue(writer.stopped)

    def test_interrupt_closes_and_preserves_exception(self):
        project=Mock();failure=KeyboardInterrupt('synthetic interruption')
        with self.assertRaises(KeyboardInterrupt) as caught:
            with scope.project_scope(lambda:project,'/synthetic'):raise failure
        self.assertIs(caught.exception,failure);project.close.assert_called_once_with()

    def test_cleanup_failure_propagates_with_original_error(self):
        project=Mock();cleanup=OSError('close failed');project.close.side_effect=cleanup
        original=ValueError('computation failed');writer=Mock(stopped=False)
        with patch.object(scope.model_attempt_writer,'current',return_value=writer),self.assertRaises(BaseException) as caught:
            with scope.project_scope(lambda:project,'/synthetic'):raise original
        self.assertIs(caught.exception,cleanup);self.assertIs(caught.exception.__context__,original)
        self.assertTrue(writer.stopped)

    def test_actual_setup_closes_after_download_failure(self):
        import aequilibrae
        project=Mock();project.network.create_from_osm.side_effect=ValueError('synthetic download failure')
        with tempfile.TemporaryDirectory() as temp,patch.object(aequilibrae,'Project',return_value=project),patch.object(aeq,'sb_patch_stage'):
            with self.assertRaisesRegex(ValueError,'synthetic download failure'):
                aeq.stage_setup('run','stage',temp,(-122,38,-121,39),str(Path(temp)/'package'))
        project.close.assert_called_once_with()

    def test_actual_assignment_closes_after_graph_failure(self):
        import aequilibrae
        project=Mock();project.network.build_graphs.side_effect=ValueError('synthetic graph failure')
        with tempfile.TemporaryDirectory() as temp,patch.object(aequilibrae,'Project',return_value=project),patch.object(aeq,'sb_patch_stage'),patch.object(aeq,'sb_get_run',return_value={}),patch.object(aeq,'retain_assignment_counts',return_value={'counts_path':'/synthetic/counts.csv','counts_status':'unavailable'}):
            with self.assertRaisesRegex(ValueError,'synthetic graph failure'):
                aeq.stage_assignment('run','stage',temp,{'centroid_map':{}},str(Path(temp)/'package'),counts_path_override='/synthetic/counts.csv')
        project.open.assert_called_once();project.close.assert_called_once_with()

    def test_project_log_closes_without_touching_unrelated_handler(self):
        import logging
        with tempfile.TemporaryDirectory() as temp:
            logger=logging.Logger('synthetic-owned-project')
            owned=logging.FileHandler(Path(temp)/'aequilibrae.log')
            unrelated=logging.FileHandler(Path(temp)/'unrelated.log')
            self.addCleanup(unrelated.close);self.addCleanup(owned.close)
            logger.addHandler(owned);logger.addHandler(unrelated)
            project=Mock(logger=logger);project.close.side_effect=OSError('native close failed')
            with self.assertRaisesRegex(OSError,'native close failed'):
                with scope.project_scope(lambda:project,temp):pass
            self.assertIsNone(owned.stream)
            self.assertNotIn(owned,logger.handlers)
            self.assertIsNotNone(unrelated.stream)
            self.assertIn(unrelated,logger.handlers)


if __name__=='__main__':unittest.main()
