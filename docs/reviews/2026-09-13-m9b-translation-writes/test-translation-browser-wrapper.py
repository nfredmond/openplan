"""Controlled process-boundary tests; no browser or database is started here."""
import importlib.util,json,re,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock,patch
spec=importlib.util.spec_from_file_location('translation_browser_wrapper',Path(__file__).with_name('run-translation-editor-browser.py'))
wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
STATE={'count':337,'latest':'20261014000018','command':True,'anonymousCommand':False,'directWrites':False,'tableAcl':'synthetic-table-acl','commandAcl':'synthetic-function-acl'}

class WrapperTests(unittest.TestCase):
    def run_wrapper(self,before,after,code=0,error=None):
        sink=MagicMock()
        with patch.object(wrapper,'sql',side_effect=[json.dumps(before),json.dumps(after)]) as sql, patch.object(wrapper.subprocess,'run',return_value=SimpleNamespace(returncode=code),side_effect=error) as child, patch.object(wrapper,'base',sink):
            try:
                result=wrapper.main()
                return result,sink,sql,child
            finally:
                # The actual wrapper must only read state, even on failures.
                for call in sql.call_args_list:
                    query=call.args[0].strip()
                    self.assertTrue(query.startswith('SELECT jsonb_build_object('))
                    self.assertNotRegex(re.sub(r"'(?:[^']|'')*'", "''", query),r'\b(?:GRANT|REVOKE|ALTER|UPDATE|DELETE|INSERT INTO)\b')
    def test_normal_and_abrupt_children_preserve_installed_state(self):
        for code in [0,23]:
            with self.subTest(code=code):
                result,sink,sql,child=self.run_wrapper(STATE,STATE,code)
                self.assertEqual(result,code);self.assertEqual(sql.call_count,2);child.assert_called_once()
                report=json.loads(sink.__truediv__.return_value.write_text.call_args.args[0])
                self.assertTrue(report['installedPermissionsPreserved']);self.assertEqual(report['childExit'],code)
    def test_wrong_installation_never_launches_child(self):
        for key,value in [('count',331),('latest','20261014000012'),('command',False),('anonymousCommand',True),('directWrites',True)]:
            with self.subTest(key=key), patch.object(wrapper,'sql',return_value=json.dumps({**STATE,key:value})), patch.object(wrapper.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as child, patch.object(wrapper,'base',MagicMock()):
                with self.assertRaisesRegex(AssertionError,'Expected installed|Installed translation permissions differ'):wrapper.main()
                child.assert_not_called()
    def test_child_cannot_silently_change_installed_state(self):
        for key,value in [('command',False),('tableAcl','changed-table-acl'),('commandAcl','changed-function-acl'),('latest','20261014000019')]:
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError,'Browser child changed installed'):self.run_wrapper(STATE,{**STATE,key:value})
    def test_launch_error_still_checks_installed_state(self):
        with patch.object(wrapper,'installed_state',return_value=STATE) as state, patch.object(wrapper.subprocess,'run',side_effect=OSError('SYNTHETIC child launch failure')), patch.object(wrapper,'base',MagicMock()):
            with self.assertRaisesRegex(OSError,'SYNTHETIC child launch failure'):wrapper.main()
            self.assertEqual(state.call_count,2)

if __name__=='__main__':unittest.main()
