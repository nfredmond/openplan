# V6 closes N1 within the source and fixture boundary

Fresh independent ROUND3, October 15, 2026. **No P1 or P2 finding in the assigned V6 correction.** I accept the N1 correction at the source and pure-fixture tier. R1, R2 and R3 retain their bounded resolutions from ROUND2. This review establishes no operating-stage success or current service availability. A review commit's existence does not approve a stage.

The subject is `02ec7bcbd391088477390a738eb21d5aad34d3b3`, public directory `docs/reviews/2026-10-15-portfolio-skip-preview-v6-active-helper-fix`, and private root `/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6`. Independent file readback matches these external pins:

| Artifact | SHA-256 |
| --- | --- |
| Manifest | `bd8ff7c66be0e7869ed6553bb9fce51b2a313ebf5d2452d41a69fc768bdb830d` |
| Operation list | `1bd2e70cc13cc1d9af8944ef96d4856da162db6b5dbc42d423a62340aaa73e3c` |
| Literal parent recipe | `5342df59072e6083353151f410e9ce73f3cb3a1cedfa75a263eee8a6181a9168` |
| Helper | `0d58b5523890386d0758abe311dbe50d6fcbcea4661f4e31646fa5060b6e1bf9` |

## N1 rejects inactive helpers before baseline capture and the final writer

The original defect hashes helper configuration while omitting runtime state. A stopped or paused helper can retain that configuration. V6 retains that digest and adds an independent active identity map and typed state checks.

In subject `templates/helper.py:354–368`, `active_helper_identities` binds the four role-to-ID pairs to the original recovery receipt's fixed path and SHA-256. It requires the exact four roles, four distinct 64-character lowercase hexadecimal IDs, and equality to the original receipt. My file audit independently confirms the source hash and all four pairs. The new baseline cannot replace this map.

At `templates/helper.py:371–378`, `require_active_helper` requires a dictionary descriptor, its exact returned `Id`, a dictionary `State`, and boolean `Running=true`, `Paused=false`, `Restarting=false`. The actual `policy.exact` checks each value's type before equality. Numeric zero and one therefore cannot substitute for booleans. Extra Docker observation fields remain permitted.

At `templates/helper.py:399–420`, preservation validates the baseline's exact role map and configuration ID set, inspects the independently pinned IDs, checks runtime state, and retains the original configuration digest comparison. It records the current typed states. At `:455–467`, preflight repeats the state checks immediately before constructing its baseline. A healthy earlier acquisition cannot promote a later paused observation into that baseline. Historical `OLD_IDS` still receive their inherited configuration checks through `unchanged_inputs`; they need not run.

The independent [driver](review_controls.py) extracts the actual functions and executes `post_journey -> verify_services/source_check/unchanged_inputs -> preserve -> writer`. Runtime I/O and final writes use explicit stand-ins. Each of the four active helpers separately refuses stopped, paused and restarting observations. Wrong-type, null and absent state fields, an unreadable inspect, returned-ID mismatch, role-map swap and extra baseline ID refuse before the final writer. Source, protected-database, configuration and V5-packet drift also refuse. Healthy fixtures with inactive retired helpers reach the writer. Healthy preflight captures the fixed map, while late bad observations refuse before either baseline or readiness write.

[Results](controls.json) contain 48 observations: three harmless or healthy survivors, 40 intended refusals and five killed code faults. Five refusal rows exercise detectors before mutation; these counts are observations, not 48 distinct operating scenarios. Removing each state predicate, the preservation state call, or the explicit late-preflight state call defeats its detector with the expected `missing-refusal` assertion. A harmless comment mutation survives first. All code and specimen changes stay in memory and restore in `finally`. Deliberately broken code may reach the in-memory writer; unchanged code's fault observations do not. No actual helper stops or pauses.

N1 is resolved within this boundary. An inspect observes one instant. These checks cannot prove uninterrupted availability, stable PID/start identity, application-level health of the old helper, or immunity to a state change after inspection. The packet makes no such claim.

## R1, R2 and R3 retain their stated resolutions

I read both prior full reports, ROUND1 `b037efc892359dcbd5350eb64438604610713ca5` and ROUND2 `0257e77b1a4d76d42e9bdb621e05374b83db613e`. V6's seven regenerated diffs and mechanical module comparison establish these bounded dispositions:

| Finding | ROUND3 disposition and remaining boundary |
| --- | --- |
| R1, imported bus and namespace failure | The fixed observer/transport, clean application and attestor environments, and outer wrapper retain V5 behavior. Only the fixed packet root, observer unit and derived hashes change. Hash edges connect helper to transport, transport to observer, app to helper/policy, and attestor to app. ROUND2's four context observations remain historical evidence. No V6 context unit or host-observer transport runs here. The same-user tools, bus and user manager remain trusted control-plane capabilities. |
| R2, missing final preservation | `post_journey` remains unchanged at `templates/helper.py:527–548`. It verifies new helpers, reacquires source and protected state, requires the complete old database set, and writes its one-shot result afterward. My full-chain fixtures exercise the new N1 checks through that writer boundary. The new preview database remains excluded from old-data comparison because browser writes are intentional. The result's phase label does not establish journey success. |
| R3, weak initial CHECK receipt | `upgraded`, `upgrade_ready`, the complete independently sealed CHECK definitions, candidate SQL and upgrade expectations remain byte-identical or mechanically identical to reviewed V5. The full-string comparison precedes initial receipt publication and fresh-state equality. Actual PostgreSQL-17 normalization remains untested. A mismatch must fail closed and retain evidence, without recapturing the target as its oracle. A post-commit readback failure does not undo the migration transaction. |

## Integration and custody match the bounded change

The independent [file audit](file_audit.py) checks all 36 public files against the subject commit, all 34 sealed inputs and modes, the exact operation-list membership, seven public/private templates, all seven diffs, and the internal and external hash graph. All module behavior matches V5 after explicit fixed root/name/hash substitutions, except `preserve`, `preflight` and the two added N1 functions reviewed above. Seventeen inherited sealed inputs remain byte-identical. Plan and private Auth/REST/Storage/Kong data change only their permitted root/helper-name bindings; credentials and role URIs are not printed.

The unchanged app `acquire` path calls `unchanged_inputs`, so active-check, checkout, build and start receive N1. The unchanged attestor reaches it through `a.acquire` twice. Helper restore, upgrade and service paths also call `unchanged_inputs`. The literal parent gate, predecessor checks, append-only admission, shared flock and runner request reservation retain V5 semantics with ROUND3/root/hash substitutions. Parent must read and dispose of this report, invoke one stage, inspect its actual receipt and failure state, and then decide whether to continue. Commit syntax and object existence do not inspect approval content.

[Source bindings](source-bindings.json) record all 66 entries, including 54 files, in the complete V6 private packet before and after controls. They match exactly. The 202 entries across the complete V4/V5 public and private packets and all 280 fixed inputs also match their frozen records. V5's independent public/private bindings match. No 51,233-entry old-cache campaign is repeated. The historical whole-root inventory remains historical.

Application source equals exact APP49 `49e3fa2004c1336ffa36c134a8f21bcc2d72d327`. Candidate 17 retains SHA-256 `b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`. The retained dump still has 16,232,305 bytes and SHA-256 `181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398`. The source anchor remains `82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547`. These are file/source observations, not a fresh database census.

I read the full V6 STATUS, recipe, manifest, BINDINGS, preparation source, seven diffs, assembled changed functions and importing paths, both control drivers and results, audit/readback drivers and results, execution records and retained failure. The author's 70 plus 15 observations are prior fixture evidence, not rerun results. The first audit fails at `AST-unrelated-change:policy.py`. Its retained source lacks normalization of the bare policy packet name; the corrected source adds that explicit replacement. The failure is retained and supplies no pass. Original V4/V5 failures remain frozen.

## Operating evidence remains open

The proposed target remains `openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90`, API `http://127.74.19.11:29949`, web `http://127.74.19.11:3586`. I make no live absence or readiness claim. No preflight or DB/Docker/HTTP observation runs. The private execution directory remains empty and operating artifacts remain absent.

Root still owns exclusive absence checks, restore from the fixed 419 dump, exact additive 17/history transaction to 420, new services, a fresh APP49/420 build, strict host attestation, normal front-door mixed-CSV desktop/390px journey, artifacts and final post-journey receipt. The old 215/419 preview and native-proof database receive no operation. Existing native SQL and compiler results remain separate supplied evidence, including the first unattributed catalog difference and temporary-grant warning. This review establishes no native normalization, restore, ACL, recovery, practitioner/public, workbook, scientific, hosted or production acceptance.

The assigned clean review checkout fast-forwards locally to the subject. I use Sol at high reasoning, no nested delegation, and only this report directory plus the new private proof root `/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-independent-round3-20261015-4cefaf52`. AGENTS, shared coordination, planner-writing, prove-it and Supabase/Postgres guidance inform this assigned review. No new product lane or direction campaign is selected. [Execution](execution.json) records serial pure checks under the shared flock, 512 MiB memory, zero swap, CPU 50 percent, private HOME/cache and Python `-B`. No event-counter result is inferred. Commit locally only. No push, PR, operating stage, browser, main merge or release occurs.
