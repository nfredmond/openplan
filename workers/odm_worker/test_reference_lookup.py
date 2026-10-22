"""Original-reference lookup uses the existing private SQLite journal."""
import copy
import json
import unittest
from dataclasses import replace
from unittest.mock import patch
from admission_journal import Journal
import test_admission_journal as fixtures

class Checks(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Checks();self.f.setUp();self.addCleanup(self.f.tearDown)
        self.entry,_=self.f.admit()
    def test_original_reference_reloads_complete_row(self):
        found=self.f.journal.get_reference(self.entry.job_reference)
        self.assertEqual(found,self.entry,'Reference lookup preserves every original admission field')
    def test_missing_reference_returns_no_admission(self):
        self.assertIsNone(self.f.journal.get_reference('missing-original-reference'),'Unknown reference cannot select another admission')
    def test_invalid_reference_refuses_before_connection(self):
        for value in ('',None,True,'x'*257):
            with self.assertRaisesRegex(ValueError,'original reference lookup differs'):self.f.journal.get_reference(value)
    def test_corrupted_original_admission_refuses(self):
        changed=copy.deepcopy(self.entry.admission);changed['requestId']='another-request'
        self.f.alter('UPDATE admissions SET admission_json=?',(json.dumps(changed),))
        with self.assertRaisesRegex(ValueError,'Stored ODM admission identity differs'):
            self.f.journal.get_reference(self.entry.job_reference)
    def test_started_reference_keeps_original_context_after_reopen(self):
        first,_=self.f.journal.start(self.entry.request['requestId'],self.entry.job_reference,{'original':'context'})
        found=Journal(self.f.root).get_reference(self.entry.job_reference)
        self.assertEqual(found,first,'Reference lookup keeps the original started context after restart')

    def test_foreign_reloaded_reference_refuses(self):
        foreign=replace(self.entry,job_reference='different-original-reference')
        with patch.object(Journal,'read',return_value=foreign),self.assertRaisesRegex(ValueError,'original reference lookup differs'):
            self.f.journal.get_reference(self.entry.job_reference)

if __name__=='__main__':unittest.main()
