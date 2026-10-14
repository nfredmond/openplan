# Independent running progress review, October 14

Read-only review identifies three defects before publication. The generic
receiver classifier accepts an ignored or incomplete running reply. A running
classifier now requires `ok: true` with `status: running`; ignored terminal or
superseded replies hold work and malformed replies remain pending.

A later progress refusal can omit an already retained engine terminal fact.
Failure recovery now reads the validated original selection without another
engine request. It preserves that reported fact in the private local failure.

A valid publisher temporary left before the original command can block progress
recovery. Preparation now calls the existing temporary validator and cleanup
under the writer lock before checking the namespace. Unknown names, symlinks,
hardlinks and unsafe files remain refused. Canonical records remain preserved.

The reviewer confirms all three corrections and identifies no further concrete
defect in this bounded adapter. The reviewer performs no execution or edits.
Application receiver, native, default operation and acceptance stay outside
this review. Source and native campaign results are recorded separately.
