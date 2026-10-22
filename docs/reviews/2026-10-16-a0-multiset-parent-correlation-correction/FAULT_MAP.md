# Proposed fault paths are unexecuted and need root selection

fault-map.json records each selected source-text anchor, its occurrence count,
intended supplied case and exact future oracle label. Those are source facts
and planned outcomes, not accepted mutation results or runnable controls.

| Boundary | Reachable proposed oracle path | Coverage limit |
| --- | --- | --- |
| Header inventory | Valid first header plus a foreign second header; omit count guard | Not a generic regex error |
| Header whole line | Relax regex to accept specified trailing text | Removing match check alone yields a wrong TypeError path |
| Result/main | Omit exact list comparison for a recognized wrong or duplicate marker | Each has a separate expected label |
| Zero suffix | Direct grammar case with all other lines valid | Does not claim independent ACK acceptance |
| Suffix/ACK | Valid nonzero but different suffix and ACK | Absent/matching survivors remain required |
| Raw versus recorded properties | Wrong recorded property with raw/entry valid | Other custody tags stay coherent |
| Raw MainPID/entry | Raw/recorded property changed together; entry unchanged | No postshow or recorded-dict-only authority |
| ACK custody | Wrong six-file hash with underlying files unchanged | Hash guard distinct from field schemas |
| Four UID slots/resources | One entry value drifts; raw manager and actual UID remain valid | Boolean scalar redundancy disclosed |
| Request intent | One supplied array/time/env value drifts with other fixtures coherent | Do not allow earlier setup failure to count |
| Input bytes |004 input differs while intent carries reviewed SHA | Exact byte gate must catch actual data |
| Helper PID | Zero helper PID with other entry/client identities valid | Bool/PID overlaps remain intact-only where needed |
| Clean terminal | Cleanup-only/UNKNOWN data with code0 and coherent records | One overlapping logical status guard |
| Terminal record status | File exists but recording/durability indication is false/error | Removing combined guard must expose acceptance |
| Ready prefix | Only ready.stdout differs from raw stdout/JSON | Full phase checks otherwise remain valid |
| Dependent source input | SQL bytes differ and dependent intent hashes those supplied bytes | Reviewed source input remains independent |
| Dependent backend | Wrong dependent-intent PID with valid readiness | No connection/default substitution |
| Retained full R | All three current maps drift consistently, keeping inventory/shape | Normal parent must refuse R!=D |
| Output custody | Persisted nonsecret metadata differs from raw response | Object/byte checks are one logical guard |
| Current inventory | After-only ordinary r/p or positive OID drift | No prior kind oracle is invented |
| Complete flags/unresolved | Wrong false flag or positive but different unresolved list | Exact-complete guard is shared, not multiple unique guards |
| Unknown definition | Nonsecret supplied unknown raw-data label | Normal no-wire consumer must refuse |
| JSON reader | Duplicate keys/nonfinite/oversize/type errors | Direct reader tests, not generic exception kills |
| Authority new joins | Missing/extra source pin, wrong fresh risk/preflight/root intent | Kill paths held until redundancy is resolved |
| Primary plus fsync | Original read error survives separate fsync error | New collector source only, no old capture regrade |
| Partial open/owned close | Second output open fails; first FD still closes | Finally restores survivor FDs |
| Cleanup-only | Code0 with supplied fsync/close error stays UNKNOWN | Does not relabel a process exit |
| Terminal attempt/record failure | Independent attempt after primary, with explicit recording error | No nonexistent hash/durability claim |
| Record primary plus close/sync | Original write/fsync remains primary; cleanup separate | Under total record failure only bounded diagnostics may survive |

Each chosen mutant must produce exactly AssertionError:<its full oracle label>.
Wrong-refusal suffixes and generic exceptions never qualify. Unique source
occurrence does not prove a reachable kill. Before authoring controls, root must
dispose the source/reader/input-oracle/cleanup contracts and the inert file-path
adapter. No test/runner/grant request or campaign result is supplied here.
