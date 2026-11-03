"""Diagnose the closed evaluator using new synthetic data only.

This test preserves the frozen evaluator. Its successful read is a recipe for
a separately preregistered successor, not authority to rerun the closed study.
"""
import tempfile
from pathlib import Path
import unittest

import numpy as np
from aequilibrae.matrix import AequilibraeMatrix


class NativeOmxTests(unittest.TestCase):
    def test_loaded_omx_requires_public_core_reader(self):
        expected = np.array([[0., 2.], [3., 0.]])
        with tempfile.TemporaryDirectory(prefix="s2-synthetic-omx-") as directory:
            path = Path(directory) / "synthetic.omx"
            source = AequilibraeMatrix()
            source.create_empty(zones=2, matrix_names=["travel_time"], memory_only=True)
            source.index[:] = [101, 102]
            source.matrix["travel_time"][:, :] = expected
            source.export(str(path))
            source.close()
            loaded = AequilibraeMatrix()
            loaded.load(str(path))
            try:
                # This is the frozen evaluator's access pattern and its native failure.
                with self.assertRaisesRegex(KeyError, "travel_time"):
                    loaded.matrix["travel_time"]
                np.testing.assert_array_equal(loaded.get_matrix("travel_time", copy=True), expected)
                np.testing.assert_array_equal(loaded.index, [101, 102])
            finally:
                loaded.close()


if __name__ == "__main__":
    unittest.main()
