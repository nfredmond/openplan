"""The restore drill's curl headers for a legacy JWT key and a Supabase secret key.

Runs the function definition taken from the real drill script under bash, so a
change to the script changes what this test exercises. Blind category: does not
start Supabase or prove that a local stack accepts either key.
"""
from pathlib import Path
import re
import subprocess
import unittest

DRILL = Path(__file__).resolve().parents[1] / 'disposable-restore-drill.sh'
# Synthetic values: a JWT-shaped string with a made-up signature and a string
# that only borrows the documented secret-key prefix.
LEGACY_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c3ludGhldGljLXNpZ25hdHVyZQ'
SECRET_KEY = 'sb_secret_synthetic-unit-test-only_0000'


def curl_headers(key):
    match = re.search(r'^service_key_curl_headers\(\) \{\n.*?^\}\n', DRILL.read_text(), re.S | re.M)
    assert match, 'service_key_curl_headers is missing from the drill'
    script = match.group(0) + 'set -euo pipefail\nservice_key_curl_headers HEADERS "$1"\nprintf "%s\\n" "${HEADERS[@]}"\n'
    result = subprocess.run(['bash', '-c', script, 'drill-headers', key], check=True, text=True,
                            stdout=subprocess.PIPE)
    return result.stdout.splitlines()


class DrillServiceKeyHeaders(unittest.TestCase):
    def test_legacy_jwt_keeps_both_headers_in_the_original_order(self):
        self.assertEqual(curl_headers(LEGACY_JWT),
                         ['-H', 'Authorization: Bearer ' + LEGACY_JWT, '-H', 'apikey: ' + LEGACY_JWT])

    def test_secret_key_goes_only_on_apikey(self):
        self.assertEqual(curl_headers(SECRET_KEY), ['-H', 'apikey: ' + SECRET_KEY])

    def test_every_service_key_curl_uses_the_helper(self):
        text = DRILL.read_text()
        self.assertNotRegex(text, r'Bearer \$(SOURCE|TARGET)_SERVICE_KEY')
        self.assertEqual(len(re.findall(r'"\$\{(SOURCE|TARGET)_KEY_HEADERS\[@\]\}"', text)), 5)


if __name__ == '__main__':
    unittest.main()
