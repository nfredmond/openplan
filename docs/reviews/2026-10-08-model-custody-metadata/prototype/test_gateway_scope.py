"""Proof-target guards stop before Docker; no database is accessed here."""
import unittest
from unittest.mock import patch
import isolated_postgrest as gateway


class Scope(unittest.TestCase):
    def test_unowned_database_stops_before_docker(self):
        with patch.object(gateway.subprocess, 'check_output', side_effect=AssertionError('Docker reached for unowned database')):
            with self.assertRaises(ValueError):
                with gateway.gateway('public', database='postgres'):
                    self.fail('Unowned database accepted')

    def test_unowned_schema_stops_before_docker(self):
        with patch.object(gateway.subprocess, 'check_output', side_effect=AssertionError('Docker reached for unowned schema')):
            with self.assertRaises(ValueError):
                with gateway.gateway('auth', database='openplan_attempt_cli_' + 'a' * 32):
                    self.fail('Unowned schema accepted')

    def test_owned_public_database_reaches_setup(self):
        with patch.object(gateway.subprocess, 'check_output', side_effect=RuntimeError('owned setup reached')):
            with self.assertRaisesRegex(RuntimeError, 'owned setup reached'):
                with gateway.gateway('public', database='openplan_attempt_cli_' + 'a' * 32):
                    self.fail('Expected setup sentinel')


if __name__ == '__main__':
    unittest.main()
