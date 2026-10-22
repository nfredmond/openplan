"""Stream one original engine archive under owned request supervision.

The caller owns current application access and validates the resulting archive.
A complete HTTP body is not requested-product or quality acceptance.
"""
import copy
import ipaddress
from urllib.parse import urlencode, urlsplit

from draft_custody import original_plan
from draft_http import finite_deadline
from engine_effects import same
from url_transport import Transport as StreamingTransport


class _CompleteWriter:
    """Refuse a short or unconfirmed local write before reporting complete bytes."""
    def __init__(self, output):
        self.output = output

    def write(self, payload):
        written = self.output.write(payload)
        if type(written) is not int or written != len(payload):
            raise ValueError('Original archive writer did not retain the complete chunk')
        return written


class Transport:
    def __init__(self, plan, resolve, attest, *, cancelled=lambda: False, ca_file=None):
        if not all(callable(value) for value in (resolve, attest, cancelled)):
            raise ValueError('Original archive supervision requires explicit adapters')
        self.plan = original_plan(copy.deepcopy(plan))
        parts = urlsplit(self.plan['engine']['endpoint'])
        try:
            address = ipaddress.ip_address(parts.hostname)
        except ValueError:
            raise ValueError('Original archive endpoint needs a captured literal address') from None
        self.network = str(ipaddress.ip_network(str(address) + '/' + str(address.max_prefixlen)))
        self.port = parts.port or (443 if parts.scheme == 'https' else 80)
        self.resolve = resolve
        self.attest = attest
        self.cancelled = cancelled
        self.ca_file = ca_file

    def _check(self, deadline, owned):
        decision = owned()
        if type(decision) is not bool:
            raise ValueError('Original archive ownership must be a boolean')
        if not decision:
            raise InterruptedError('Original archive ownership ended')
        cancellation = self.cancelled()
        if type(cancellation) is not bool:
            raise ValueError('Original archive cancellation must be a boolean')
        if cancellation:
            raise InterruptedError('Original archive download cancelled')
        finite_deadline(deadline)

    def _attest(self, deadline, owned):
        self._check(deadline, owned)
        if self.attest(copy.deepcopy(self.plan['engine']), deadline) is not True:
            raise ValueError('Original archive engine check refused')
        self._check(deadline, owned)

    def __call__(self, plan, output, max_bytes, deadline, *, owned):
        """Return bounded complete body length from the captured task's fixed route."""
        if not callable(owned):
            raise ValueError('Original archive ownership adapter is required')
        self._check(deadline, owned)
        if not same(original_plan(copy.deepcopy(plan)), self.plan):
            raise ValueError('Original archive request plan differs')
        if type(max_bytes) is not int or not 0 < max_bytes <= 2**63 - 1 or not callable(getattr(output, 'write', None)):
            raise ValueError('Original archive needs a bounded byte writer')
        self._attest(deadline, owned)
        try:
            token = self.resolve(self.plan['engine']['credentialReference'])
        except Exception:
            raise ValueError('Original archive credential resolution failed') from None
        if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):
            raise ValueError('Original archive credential value differs')
        endpoint = self.plan['engine']['endpoint'].rstrip('/')
        url = endpoint + '/task/' + self.plan['taskUuid'] + '/download/all.zip'
        if token is not None:
            url += '?' + urlencode({'token': token})
        def interrupted():
            self._check(deadline, owned)
            return False
        transport = StreamingTransport(allowed_networks=(self.network,), allowed_ports=(self.port,),
            max_redirects=0, cancelled=interrupted, ca_file=self.ca_file)
        self._check(deadline, owned)
        count = transport(url, _CompleteWriter(output), max_bytes, deadline)
        self._attest(deadline, owned)
        if type(count) is not int or not 0 < count <= max_bytes:
            raise ValueError('Original archive complete byte count differs')
        return count
