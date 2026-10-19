# High-injury network requested-year correction

The loader now applies exact requested-year membership on every crash page, intersected with optional range bounds. Missing, invalid or disjoint selections refuse computation. Existing low-level range-only callers retain their behavior. Sparse years display individually in the Safety panel and report; they no longer imply that intervening years were selected.

Final focused checks pass 225 tests and scoped lint. Harmless controls survive. Targeted wrong behaviors fail for membership, invalid years, forwarding, range bounds, sparse-year disclosure, observation caveats and page projections, with exact restoration. Prior reader/preflight failures remain failed and preserved privately. The checked application source is commit fd8595f; this follow-on adds only this status note.

Requested years do not establish complete observations, an annual denominator, zero crashes in unavailable years, CMF applicability or scientific validity. Fake-query and jsdom checks do not prove actual SQL/RLS, provider/year completeness, visible map/layout behavior or usable exported artifacts. Those workflow checks remain pending. Safety journey 04 stays partial. This is not full v1 acceptance.
