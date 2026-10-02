# Review finding disposition

This branch corrects the demonstrated findings from the October 1 independent review of commit `891a0d89a848133d44b9e4f314a76a922cd71ace`. The original review and its coverage limits remain preserved in `/home/nathaniel/.local/state/openplan/independent-review-20261001-01/docs/reviews/2026-10-01-independent-code-review/`. Review IDs below refer to that record. These corrections do not complete the remaining v1 contract or establish acceptance of the unfinished prototype.

| Finding | Implemented correction | Evidence and remaining boundary |
|---|---|---|
| SEC-01, altered Storage paths | Refuse ambiguous raw object references before privileged Storage access; stop trimming retained object names | Real installed client transport and path mutations. [Security record](SECURITY_FIXES.md). No private foreign bytes retrieved. |
| SEC-02, viewer artifact writes | Restrictive INSERT policy requires a current writer role for the two artifact buckets | Native role, wrong-tenant, revocation and policy-removal checks. Initially a source concern, now independently exercised. |
| PROV-01, financial approval binding | Exact raw-body allowlists, nullable unlink refusal, signed registry fields and insert-only approved profile creation | Real registry/route/verifier composition, query projections and targeted faults. [Provider record](PROVIDER_FIXES.md). Approval and business writes still use separate transactions. |
| PROV-02, invalid retained output recovery | Durable terminal failure for invalid output and same-attempt failure journal after definitive envelope rejection | Lost acknowledgement, changed identity, cancellation and durable replay tests. No fresh provider call. Physical power loss remains untested. |
| FIN-01, negative allocation rounding | Distribute a negative rounding residual over available recipient amounts | Tiny, ordinary and zero-weight-recipient cases plus clamp-removal fault. [Financial record](FINANCE_AND_READS.md). |
| FIN-02, mismatched financial parents | Three composite foreign keys and locked exact-parent validation before replacement | Native authenticated writes, empty replacements, additive upgrade, preservation and removed-constraint faults. Historic bad records require source-based reconciliation. |
| FIN-03, short-page report truncation | Continue to empty page, advancing actual returned rows; refuse ceiling or read failure | Reduced-cap transport tests and truncation mutation. Multi-request snapshot consistency is not established. |
| UI-01, dashboard submittal query | Join through the actual project relationship | Native own/foreign rows, projection assertion, desktop and 390px navigation. Full accessibility and practitioner usefulness are not established. |
| SCI-01, HTTP worker execution configuration | Require operator token/roots and refuse request-selected execution settings | Actual HTTP wrapper tests and faults. [Science record](SCIENCE_FIXES.md). Optional operator deployment configuration changes are documented. |
| SCI-02, surviving cancelled descendants | Terminate the owned POSIX process group, escalate and bound collection | Real child/grandchild cancellation and stubborn-process cases. Detached daemons and container-engine ownership remain outside this boundary. |
| SCI-03, directional scientific comparison | Successor matcher and legacy extraction guard refuse unproven directional comparisons | Directional fixtures and faults. No consumed holdout or frozen artifact changed; no new accuracy claim. |
| Adjacent read concerns | Complete generated evidence collections and preparation/source/extraction history | Real JSON builder bytes under a simulated cap, stable ordering and late-page refusal. Native geographic application acceptance remains separate. |

Specialists independently reviewed the financial/migration and provider/authorization paths. Disagreements and test limitations remain in their reports. The correction uses two additive migrations; it does not delete existing records, change national coverage, combine modeling engines, add a paid tier, or change the roadmap.


## Findings in intervening main commits

These findings concern development changes integrated through `d72c1109`, not the published v0.66.0 baseline.

| Finding | Correction and evidence | Remaining boundary |
|---|---|---|
| UI-02, unsupported public receipt and ineffective retry, Medium / demonstrated | Neutral error wording and fresh document request. Real Server Component fault recovers after the fault is removed; the original reset-only control does not. [Evidence](UI_RECOVERY_FIXES.md). | No participant or screen-reader acceptance claim. |
| UI-03, malformed authentication destination, Medium / demonstrated | Catch invalid caller paths and preserve same-origin fallback, query and fragment behavior. Real URL parser tests and targeted faults. [Evidence](UI_RECOVERY_FIXES.md). | Full authentication-provider exchange is not exercised by the focused test. |
| MAP-01, unavailable ACS rates shown as zero, Medium / demonstrated | Retain source availability for four numeric overlays, propagate it through engagement geometry, and distinguish income zero from missing income. Actual parser-to-style tests and seven fault/control pairs. [Evidence](MAP_DATA_FIXES.md). | Legacy records, aggregates and proxy classifications need broader availability design; physical map rendering is not established. |
