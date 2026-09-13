# Translation history after scope migration 327

The unchanged history prototype passed its baseline and harmless control on the
installed schema 327. All five targeted failures still failed as intended, and
every transaction rolled back the prototype table and synthetic rows. See
history-after-scope-mutations.json. This verifies compatibility of the prototype,
not an installed history feature or a finished write/recovery workflow.

Two helper defects now have executable reproductions at source
6ee8c438da9e5c100bb6c1588e29d5248b46cac7. The diagnostic fixture uses the actual
translateEngagementText helper with a synthetic SDK boundary and no API call:

- Complete short output passes its positive control.
- A valid 5000-character source loses its end marker before reaching the model.
- Output with finishReason length is returned as available AI text, rather than
  refused as incomplete. The helper currently ignores finishReason altogether.

The two desired-behavior assertions fail on current code. The temporary app test
was removed after execution; the preserved fixture here is not part of CI. Copy
it into app/src/test only for the focused reproduction. The existing response
schema permits 5000-character source fields, the helper slices at 4000 and requests
1500 output tokens. A hash of the whole source cannot make a translation of its
prefix complete. Refuse incomplete completion and preserve the full supported
source while implementing durable generation and exact publication; retain manual
translation when generation is unavailable. Account for output bounds in spending
estimates. Do not silently repeat a billable generation after a lost response.

Follow NEXT.md for full private custody, exact source/translation versions,
reasoned atomic writes, request receipts and the existing editor integration.
The history prototype records source hashes, not unknown historical source words.
New writes should preserve the exact checked source; do not invent older words
from a hash or promote machine authorship to a human author on acceptance.
