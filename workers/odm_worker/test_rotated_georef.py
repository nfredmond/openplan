"""Read full raster cell vectors from actual classic TIFF transform tags."""
import math
from pathlib import Path
import struct
import tempfile
import unittest

import georef
import test_georef as fixtures


def transformed_tiff(a, b, e, f):
    """Replace the fixture scale tag with an original affine matrix tag."""
    data = bytearray(fixtures.build_geotiff())
    count = struct.unpack_from('<H', data, 8)[0]
    offset = len(data)
    matrix = (a, b, 0, 0, e, f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
    for index in range(count):
        start = 10+12*index
        if struct.unpack_from('<H', data, start)[0] == georef.TAG_MODEL_PIXEL_SCALE:
            struct.pack_into('<HHII', data, start, georef.TAG_MODEL_TRANSFORMATION, 12, 16, offset)
            break
    else:
        raise AssertionError('Synthetic TIFF must have its scale entry')
    data.extend(struct.pack('<16d', *matrix))
    return bytes(data)


class Checks(unittest.TestCase):
    def parse(self, a, b, e, f):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'declared-transform.tif'
            path.write_bytes(transformed_tiff(a, b, e, f))
            return georef.parse_geotiff(path)

    def test_rotated_vectors_have_their_full_native_lengths(self):
        parsed = self.parse(3, 4, 4, -3)
        self.assertEqual(parsed['pixel_size'], (5, 5), 'Rotated cells require both model-axis components')

    def test_quarter_turn_cannot_report_zero_spacing(self):
        parsed = self.parse(0, -2, 3, 0)
        self.assertEqual(parsed['pixel_size'], (3, 2), 'Quarter-turn cells retain positive declared spacing')

    def test_sheared_row_keeps_its_own_vector_length(self):
        parsed = self.parse(2, 1, 0, 3)
        self.assertEqual(parsed['pixel_size'][0], 2)
        self.assertAlmostEqual(parsed['pixel_size'][1], math.sqrt(10), msg='Sheared row spacing includes its horizontal component')

    def test_reflected_vectors_do_not_change_positive_lengths(self):
        parsed = self.parse(-3, -4, -4, 3)
        self.assertEqual(parsed['pixel_size'], (5, 5), 'Reflection preserves native cell vector lengths')

    def test_axis_aligned_transform_keeps_declared_spacing(self):
        parsed = self.parse(.05, 0, 0, -.1)
        self.assertEqual(parsed['pixel_size'], (.05, .1), 'Axis-aligned spacing remains the original declared scale')

    def test_asymmetric_vectors_use_columns_instead_of_matrix_rows(self):
        parsed = self.parse(3, 4, 12, -5)
        self.assertEqual(parsed['pixel_size'], (math.sqrt(153), math.sqrt(41)),
            'Raster steps use matrix columns rather than horizontal matrix rows')


if __name__ == '__main__':
    unittest.main()
