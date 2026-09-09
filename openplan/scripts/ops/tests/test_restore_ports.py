import importlib.util
from pathlib import Path
import socket
import os
import unittest

spec = importlib.util.spec_from_file_location('restore_ports', Path(os.environ.get('RESTORE_PORTS_TEST_SOURCE', Path(__file__).resolve().parents[1] / 'restore_ports.py')))
ports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ports)


class RestorePortTests(unittest.TestCase):
    def test_skips_an_occupied_block_without_disturbing_its_owner(self):
        first = ports.choose_ports()
        second = ports.choose_ports(excluded=first)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as owner:
            owner.bind(('0.0.0.0', first[1]))
            owner.listen()
            chosen = ports.choose_ports(candidates=[first[2], second[2]])
            self.assertEqual(chosen, second)
            with socket.create_connection(('127.0.0.1', first[1]), timeout=1):
                connection, _ = owner.accept()
                connection.close()

    def test_avoids_ephemeral_and_source_ports_and_fails_without_a_free_candidate(self):
        first = ports.choose_ports()
        second = ports.choose_ports(excluded=first)
        self.assertEqual(ports.choose_ports([first[2], second[2]], excluded=first), second)
        self.assertEqual(ports.choose_ports([first[2], second[2]], ephemeral=(min(first), max(first))), second)
        with self.assertRaisesRegex(RuntimeError, 'No unused'):
            ports.choose_ports([first[2]], excluded=first)

    def test_preserves_the_six_service_positions_and_reads_the_kernel_range(self):
        selected = ports.choose_ports()
        self.assertEqual(tuple(p-selected[2] for p in selected), (1, 2, 0, 3, 4, 7))
        low, high = ports.ephemeral_range()
        self.assertTrue(all(not low <= p <= high for p in selected))
