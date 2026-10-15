# Integration encryption secret rotation

October 15, 2026. Unreleased candidate on main `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.
This is Stage A operating work under roadmap M3. No migration or hosted secret
change is included.

## Behavior

New ciphertext uses `OPENPLAN_INTEGRATION_KEY_SECRET`. Reads authenticate with
that primary first, then the optional `OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET`.
A missing or short primary still disables encryption and decryption. Invalid
second secrets do not supply a read key. Both use the existing trimmed,
minimum-length configuration rules. The encryption formats, KDF, GCM tags and
workspace binding stay unchanged.

The existing v1, v2 and v3 formats remain readable under either configured
secret. No database row, sealed credential or journal is re-encrypted on read.
The translation and API revision consumers keep their identity/configuration
refusals. This change neither chooses another payer nor dispatches a provider
request.

The self-hosting procedure prepares both secrets on every reader before any
process writes with the new primary. It refuses replacing an occupied second
slot while retained records still require it. Two slots cannot preserve three
required secrets. Operators must retain the old secret while live records,
saved requests, journals or required restore points need it. There is no bulk
re-encryption or inventory command in this candidate.

## Checks and their boundaries

The local source controls run real Node crypto, without mocking the crypto
module. Four cohorts of 13 cases pass: baseline, harmless comment, restored
after the comment and final restored source. Fourteen targeted variants fail
at their named assertions. These cover all three retained formats, primary-only
writes, preparation for mixed processes, missing primary, short/trimmed second
secret, workspace binding, GCM tag authentication, an authenticated empty value,
and exact translation/API credential identities. The classifier accepts two
positive examples and rejects seven unrelated result shapes. See
[controls](controls.json), [classifier controls](oracle-controls.json),
[tested source bindings](source-bindings.json) and
[controller](verify_controls.py).

The first controller attempt rejected the authentication mutant because the
combined test hit its workspace assertion before reaching the tag assertion.
The workspace and tag cases were split, and the full controls were repeated.
That failed attempt remains in the private proof directory. It is not counted
as an intended tag failure. The intermediate two-format and first 12-case
reports are historical; the current source report contains 13 cases.

A read-only independent source review found an occupied-second-slot omission
in the first operating instructions and a missing targeted rolling-read fault.
Both are corrected. The reviewer found no additional defect on that follow-up
and ran no tests or services.

These checks cannot establish deployed configuration consistency, actual queue
recovery, a provider response, a restored installation, hosted key rotation or
human acceptance. Legacy v1/v2 ciphertext retains its existing weaker workspace
binding. A successful decrypt is not authorization for a new provider call.
The feature is read compatibility during a planned rotation, not provider-key
revocation or a complete response to a disclosed encryption secret.

The existing authentication behavior follows Node 24's
[GCM finalization](https://nodejs.org/docs/latest-v24.x/api/crypto.html#decipherfinaloutputencoding)
and [associated-data interface](https://nodejs.org/docs/latest-v24.x/api/crypto.html#deciphersetaadbuffer-options).
The change introduces no new cryptographic algorithm.

Scoped types, changed-source strict lint, 201 related shuffled cases under seed
20261015 and product direction pass. The owned service peaks at 321,462,272
bytes under its 1 GiB cap, with swap disabled and zero recorded OOM events.
The initial narrow type configuration could not resolve the installed Node
ambient declarations from the outside-repository proof directory. The corrected
configuration names the application's actual type root; no application type
errors are suppressed. The failed report remains retained privately.

The [independent reports](REVIEW.md) preserve both review rounds. A dedicated
GitHub workflow repeats the source controls. Full GitHub CI passes on
`1f004f0894067225df75574d939968ecffac56ad`. No production setting or hosted
secret has changed.

## Recovery instruction correction after review

October 15, 2026. GitHub review identified that the canonical local and hosted
recovery procedures still named only the primary secret. Both now require
protected capture and restoration of the second secret when retained workspace
keys or sealed worker credentials depend on it. They require every reader to
receive the secrets before work resumes and preserve keys needed by retained
recovery points. This corrects instructions, without changing runtime code or
establishing an actual restore. The amended head needs fresh CI.
