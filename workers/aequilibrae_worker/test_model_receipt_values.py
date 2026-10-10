"""JSON value checks and isolated controls; these do not contact a database."""
import inspect
import unittest
import model_receipt_values as values


class ValueTests(unittest.TestCase):
    def test_json_values(self):
        for left, right in [(False, 0), (True, 1), (None, 0), ('1', 1),
                            ({'nested': [False]}, {'nested': [0]}), ([1], [1, 2]),
                            ({'a': 0}, {'b': 0}), (float('inf'), float('inf')),
                            (float('nan'), float('nan')), ((1,), (1,))]:
            self.assertFalse(values.same_json_value(left, right), 'different JSON kinds or values accepted')
        for left, right in [(None, None), (False, False), (True, True), (1, 1.0),
                            ({'a': [0, None, False], 'b': 3}, {'b': 3.0, 'a': [0.0, None, False]})]:
            self.assertTrue(values.same_json_value(left, right), 'equal JSON values refused')

    def test_harmless_and_value_kind_faults(self):
        original = values.same_json_value
        source = inspect.getsource(original)
        cases = [(source + '\n# Harmless receipt comparison control.\n', True),
                 (source.replace('if isinstance(left, bool) or isinstance(right, bool):', 'if False:'), False),
                 (source.replace('return len(left) == len(right) and all(same_json_value(a, b) for a, b in zip(left, right))', 'return left == right'), False),
                 (source.replace('and all(same_json_value(left[key], right[key]) for key in left)', 'and left == right'), False)]
        try:
            for changed, passes in cases:
                scope = dict(values.__dict__)
                exec(compile(changed, values.__file__, 'exec'), scope)
                values.same_json_value = scope['same_json_value']
                if passes:
                    self.test_json_values()
                else:
                    with self.assertRaisesRegex(AssertionError, 'different JSON kinds or values accepted'):
                        self.test_json_values()
        finally:
            values.same_json_value = original
        self.test_json_values()


if __name__ == '__main__':
    unittest.main()
