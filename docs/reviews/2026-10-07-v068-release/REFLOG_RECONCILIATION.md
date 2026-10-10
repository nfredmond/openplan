# Recent reflog reconciliation

The October 7 integration audit also inspects 799 distinct commits referenced
by reflog entries since September 7. Sixteen are unreachable from current refs.
Eight have exact stable patch IDs matching commits in candidate ancestry. The
remaining eight are superseded by the specific changes below, established by
single-commit range comparisons and the redaction fixup diff.

No unique application behavior is found in these sixteen discarded commits.
Do not merge the discarded history merely to make those hashes reachable. In
particular, preserve the diagnostic-token redaction already present in the
candidate. Current ref ancestry and this historical patch comparison prove
different things. Neither recovers unsaved buffers or unknown external clones.

| Discarded commit | Retained commit | Disposition |
| --- | --- | --- |
| `18c584ad` | `04974b9b` | Exact stable patch matches candidate ancestry. |
| `3c5dc71b` | `04974b9b` | Exact stable patch matches candidate ancestry. |
| `4ff47214` | `8cb534f5` | Later commit adds closed-campaign and shared-page browser evidence; application patch unchanged. |
| `57f4dd65` | `6eb041f5` | Later commit removes test whitespace and records documentation checks with the updated test hash. |
| `5f4d55bd` | `9921944c` | Later commit redacts a public map-provider token in captured diagnostics. |
| `6c87c6d6` | `42976a78` | Later commit removes trailing blank lines from verification logs; application patch unchanged. |
| `7ed9126d` | `9921944c` | Later commit redacts a public map-provider token in captured diagnostics. |
| `8722efaf` | `61e82460` | Later mutation script names the immutable legacy commit instead of mutable HEAD. Application patch unchanged. |
| `8e395d5b` | `a77b3cc5` | Later commit removes a blank SQL line and updates its proof hash and formatting note. |
| `b53dbad9` | `db48f48d` | Exact stable patch matches candidate ancestry. |
| `bca572eb` | `9921944c` | Redaction fixup is folded into 9921944c; do not restore the unredacted predecessor. |
| `cc129d88` | `e15e2b93` | Exact stable patch matches candidate ancestry. |
| `cd37b146` | `b878d35d` | Exact stable patch matches candidate ancestry. |
| `d35c000c` | `24022411` | Exact stable patch matches candidate ancestry. |
| `dc824caa` | `e15e2b93` | Exact stable patch matches candidate ancestry. |
| `ec9e4acc` | `49deefd0` | Exact stable patch matches candidate ancestry. |

The machine-readable record and redacted comparisons remain in the private
`v068-release-20261007-proof/reflog-audit.json` and `reflog-*.diff` files.
The retained commits are ancestors of `834ac66c`. This does not declare final
integration into main or a release. The separate documentation checkpoint and
obligation-review follow-up still require their recorded integration steps.
