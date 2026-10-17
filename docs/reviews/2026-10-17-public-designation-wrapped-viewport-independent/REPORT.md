# Independent exact-candidate source and saved-data review

October 17, 2026. Reviewer: GPT-6.1 Sol, high reasoning, as identified by the live injected T3/Codex runtime. No nested agent participates. This declaration is runtime metadata, not an independent provider attestation.

## Verdict: no new source blocker found within this review

**SOURCE/DATA REVIEW ONLY.** I find no introduced defect that warrants a blocking source finding in the exact 11-file candidate. The production delta follows the approved dedicated-RPC, symmetric-seam and numeric-ceiling design. The retained saved data supports the stated focused pure/mocked evidence, with the historical failures and reader limitations below.

This verdict does not establish executable SQL, installed permissions, actual camera behavior, browser usability or deployment readiness. It grants no next operation. ROOT retains disposition. M1, KI-2026-10-12-025 and full v1 remain open. No source is repaired, no checkout is switched, and no commit is made.

There are **zero new blocking findings and zero new advisory defect findings**. The limitations in this report are evidence boundaries or inherited scope, not invented candidate failures. No native reproduction occurred.

## Exact identities and ownership

| Item | Independently read identity |
| --- | --- |
| Review checkout | `/home/nathaniel/.t3/worktrees/openplan/t3-7b8b9243` |
| Review branch | `t3/review-public-designation-wrapped-viewport` |
| Review HEAD | `05dd3e8da4a4572437f06e771b0a2477873e681f` |
| Review application tree, not the candidate | `1e0b6522002b2485d37086790808c0217ff77cfe` |
| Read-only candidate checkout | `/home/nathaniel/.t3/worktrees/openplan/t3-dd1f8bad` |
| Candidate branch | `t3/public-designation-wrapped-viewport-design` |
| Candidate commit | `98833fbffc78a693bd5ce6bd8b3ab6e227835a28` |
| Candidate parent | `d264d69149ae2f9d589840e5a543b798ae4718ec` |
| Candidate application tree | `a238785cf72fce241237bb7691e4e4ea4907c3b4` |
| Candidate root tree | `0edb86988a99db2d54a9c46002c2eb1b0349185d` |
| Package | `0.68.0` |
| Candidate status at readback | Clean |

The candidate changes exactly 33 paths relative to its parent: six application files, four tests, one new migration and 22 preparation/review documents. Current bytes match all 33 committed objects. The 11 source hashes match `SOURCE11.sha256`. Every original migration matches its parent bytes, across all 425 paths. The only added migration is number 426 in filename order.

I own only NEW `REPORT.md`, `VALIDATION.md` and `EVIDENCE_PINS.json` in this review directory, plus NEW private metadata under `/home/nathaniel/.local/state/openplan/public-designation-wrapped-viewport-independent-20261017`. That private directory is mode 0700 and its files are mode 0600. Candidate, ROOT combined, prior packets and saved receipts remain read-only. No process, manager, lock or active-runtime probe occurs. Worktree metadata establishes checkout separation; it does not establish process inactivity.

## The original mission and boundaries remain intact

The original defect independently clips camera longitudes to plus/minus 180. An ordered camera view of 170 through 190 loses its western interval. A view of 190 through 210 becomes invalid while old shapes remain. Missing camera bounds fabricate world coverage. Two public routes also convert blank coordinate tokens to zero through `Number`.

The accepted correction must separate raw camera copies from canonical wire coordinates and strict stored extents. It must handle ordinary, crossing, seam-touching and full-world longitude views; retain actual latitude; refuse nonfinite, unsafe, collapsed and direction-ambiguous input; and use no epsilon. ROOT approves `Number.MAX_SAFE_INTEGER` as a refusal ceiling, with fractional precision at extreme raw magnitudes explicitly unproved.

One dedicated invoker RPC must select source feature-envelope overlap with OR across seam intervals. It must count each feature row once, include both physical plus/minus 180 edges, count before draw limiting, and draw all or none at the cap. It must not replace or overload the old workspace GIS RPC. All three routes must share a nonempty complete-token parser. The loader must make one RPC call, retain complete safe counts, reject duplicate IDs and partial replies, preserve projections and public attributes, and use truthful density wording.

The original frozen designation, published packet, review release, historical report, authorization, version, workspace, hash and field-filtering chain must remain. Worldwide extensibility, all 50 states and DC, California depth, territory assessment and tribal/overlapping authority remain. This viewport correction creates no legal claim, geographic applicability inference or second geography selector. No test result, resource budget or review date narrows the full product destination.

All nine expressly requested preparation documents were read in full. The additional CLI, source and control supersession records are indexed in `EVIDENCE_PINS.json` and the history section below. Historical preparation statements describe their dated stage. The final candidate `REPORT.md`, `VALIDATION.md`, `EVIDENCE.json`, checkpoint and ROOT acceptance govern what subsequently occurred. A historical statement that a migration did not yet exist does not contradict the final generated candidate.

## Source trace and review conclusions

All paths and line numbers in this section refer to the exact candidate, not this review checkout's application.

### Query helper preserves distinct input contracts

`openplan/src/lib/geo/wgs84-query-viewport.ts:4` reads exactly four explicit slots. Sparse slots therefore reach the number/finite test instead of disappearing through sparse-array iteration. Both latitude endpoints are range checked, with positive height.

The numeric wire reader at line 14 accepts only canonical longitude endpoints. Equal endpoints and `[180,south,-180,north]` refuse zero circular width. West greater than east expresses a crossing. West plus 180 and east minus 180 normalize to their equivalent seam endpoints only after the zero-width refusal. `[-180,south,180,north]` remains full longitude coverage. Signed zero canonicalization does not widen a view.

The parser at line 26 requires four trimmed, nonempty tokens before full `Number` conversion. It refuses blank parts, numeric suffixes, nonfinite results and out-of-range camera copies. It intentionally retains the prior complete numeric-conversion semantics, including exponent notation; this is not a new decimal-only grammar.

The camera adapter at line 40 first checks finite coordinates, latitude and absolute raw-longitude ceilings. Reversed input delegates to the canonical reader, refusing reversed noncanonical copies. Ordered input measures width before modulo, checks its finite/positive/safe range, and classifies widths at least 360 as full longitude coverage with the actual latitude band. Already canonical endpoints avoid unnecessary offset arithmetic. Normalized collapsed endpoints refuse; a narrow view cannot be promoted to the full-world tuple.

The source yields the intended 170..190 crossing, 190..210 western ordinary interval, negative copies and seam aliases by inspection. These are source deductions, not newly evaluated examples. Neither the ceiling nor the existing exact integer example proves sub-degree precision near huge raw offsets. No narrower ceiling is imposed against ROOT's decision.

### Invalid view clears shapes and invalidates old responses

`openplan/src/components/land-use-plans/public-designation-map.tsx:30` catches missing or throwing bounds/getters and returns unavailable. `refresh` at line 65 increments the generation before reading bounds. It obtains the source and clears it for unavailable bounds at lines 69–72, displays the retry notice, and sends no request. Successful response handling checks the generation at line 77; the catch path checks it again at line 93. An older pending reply cannot redraw an invalidated view. A later valid move can fetch and clear the unavailable notice through the existing success path.

The source retains strict stored-extent framing, the map-engine selection, layer setup, label handling and teardown generation increment. No world query substitutes for unreadable bounds. This review does not claim that either installed SDK emits a specific example, renders repeated worlds correctly, or shows usable desktop/mobile labels.

### The three routes retain their access paths

The published route and review-token route each replace only the parser import and bbox read. Their `route.ts:15` identifier checks precede parsing; lines 19–23 retain the packet loader, frozen content forwarding and 404/503 mapping. The review token remains constrained to 48 lowercase hexadecimal characters. No new service-role call bypasses the retained packet loaders.

The report route replaces only the parser import and bbox read. At `openplan/src/app/api/reports/[reportId]/land-use-map/[designationId]/route.ts:18`, identifiers and bbox validation remain ahead of session creation. Lines 22–38 retain authentication, report access, role permission, exact artifact metadata projection, historical snapshot resolution, scoped session/workspace forwarding, report/version/hash response fields and private no-store response.

The unchanged access chain was read as source. `public.ts:49` requires the adopted published pointer and content identity, including a matching decision hash. `public.ts:101` resolves the review token, excludes withdrawn releases and checks release/version/frozen identity. `frozen-identity.ts:16` checks identity, version number, frozen content hash and context validity. `report-snapshot.ts:16` scopes the historical version to plan and workspace; lines 20–25 require the report type, allowed retained state, report pointer and matching frozen hash. `reports/api.ts:144` reads membership by both workspace and user. These source guards remain unmodified. Mocked route results do not establish their live enforcement.

### The loader keeps one complete, filtered response

`openplan/src/lib/land-use-plans/public-map.ts:40` validates direct caller coordinates before creating a client. Lines 42–60 retain the frozen designation/version/hash checks, exact `id, workspace_id, feature_hash, ingest_status` projection, ready filter, and optional workspace predicate plus returned-row check.

Lines 62–66 make exactly one call to `workspace_gis_features_in_query_viewport`, with the retained version and shared draw cap. Lines 71–86 require a nonnegative safe count, consistent row counts, complete returned feature count below the cap and unique feature IDs. Missing or malformed counts cannot become a zero finding. Equal geometries under different IDs remain separate features. Public attributes still come from the retained field allowlist at lines 48–50 and 81–83. No field projection or allowlist broadening occurs.

Above the cap, no geometry reaches the public payload. At line 100, the complete density sentence says that feature bounds overlap the view. This matches the requested source predicate. The inherited empty-result component sentence uses intersection language; a verified empty envelope match is consistent with no exact feature intersection. The change does not claim exact-shape positive intersection.

### Migration 426 expresses the intended atomic query

`openplan/supabase/migrations/20261017052401_public_designation_query_viewport.sql` hashes to `ceaba34c98472c086e8f8e56d758d73a9200c60f0e3a926c398f73ea387c960c`. Its body after the first three comment lines equals the reviewed template byte for byte. The actual empty filename came from the accepted CLI generation; SQL authoring followed separate authorization. This review reads that custody and does not repeat the CLI.

Lines 5–23 declare one new six-argument function with explicit built-in types, the existing return shape, `STABLE`, `SECURITY INVOKER` and `search_path = pg_catalog, public`. There is no overload, replacement of the old RPC, table grant, index, stored-extent or geometry change.

Lines 29–35 reject null version/coordinates/limit, noncanonical ranges, bad latitude order, equal/equivalent seam endpoints and negative limits before envelope construction. PostgreSQL 17 documents floating NaN as greater than non-NaN values. Consequently a NaN coordinate cannot satisfy the finite upper bounds; infinities also fall outside these ranges. This is a documented source inference, not an installed-server probe. See [PostgreSQL 17 numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html).

Lines 38–53 apply the same seam canonicalization as TypeScript. The one-row windows CTE constructs an ordinary envelope, two crossing envelopes, or the necessary opposite physical seam edge for seam-touching ordinary views. Latitude values stay unchanged. No query-area epsilon appears. Full-world input uses the ordinary envelope.

Lines 55–65 select feature rows from the exact version with OR over the windows. The one-row cross join does not multiply features. A row whose envelope touches multiple windows still enters `matched` once. The schema's feature primary key and unique `(version_id, feature_index)` support the subsequent ID join and stable feature-index ordering. Counting precedes the lateral draw limit at lines 69–75; its left join preserves the count-only zero/over-cap row. There is no sum of capped windows, client deduplication, partial union or `UNION ALL`.

The operator remains `&&`, which documents two-dimensional bounding-box overlap or touching, rather than exact geometry intersection. See [PostGIS geometry overlap](https://postgis.net/docs/geometry_overlaps.html). Multipart envelopes can match a gap between parts. That is inherited selection semantics, explicitly retained. The [envelope constructor documentation](https://postgis.net/docs/ST_MakeEnvelope.html) supports the ordinary minimum/maximum input contract; it does not substitute for native zero-width seam testing.

Lines 82–83 revoke default execution from PUBLIC and anon and grant authenticated/service-role execution on the exact signature. PostgreSQL documents invoker privileges and default PUBLIC function execution in [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html). Tables and PostGIS calls are schema qualified. The `&&` operator resolves through the pinned path. Source convention places PostGIS in public; installed namespace placement remains unqueried.

The unchanged feature migration enables RLS, scopes reads through workspace membership, revokes anon table access and grants authenticated read. The unchanged version policy also scopes reads through membership. Later immutable-version/hash triggers remain. Public published/review loaders intentionally use the service role after packet authorization, so invoker security does not itself provide public packet filtering. The report path retains its session client and workspace scope. No source change silently substitutes one boundary for the other.

## The tests exercise their claimed subjects, within mocked boundaries

The helper suite imports the actual new helper and strict stored-bound readers. The component suite imports the actual component and does not mock its viewport helper; the SDK, fetch and sizing boundary are synthetic. The route suite invokes all three actual GET handlers with the actual parser, while packet/access/snapshot/map dependencies are mocked. The loader group invokes the actual loader through the actual report path with fake Supabase responses; it does not stub its own loader subject.

The loader tests explicitly assert projection strings and scoped filters. They cover exact one-call arguments, cap equality, over-cap and zero sentinels, short replies, duplicate IDs, unsafe/inconsistent/missing counts, retained readiness/hash/workspace checks and private-attribute suppression. Source review does not convert mocked returned columns into a native projection check. The selected mutations provide bounded sensitivity, as detailed in `VALIDATION.md`.

The four SQL controls compare bytes with reviewed intent. No dedicated semantic SQL test runs in this packet. A wrong SQL body can fail equality without any PostgreSQL parser, planner or permission check. This limitation is correctly retained in the final report.

## Historical failures, responses and unresolved boundaries stay visible

1. **Original Units01..04:** the original startup/selection failures and holds remain preserved, with no retrospective pass. The indexed Trial04/window01 audit records `__dirname` failure under the runner config; window02 records `EAI_AGAIN localhost`; window03 records a zero-assertion selection failure. Subsequent source/control preparation does not regrade those events. The indexed preliminary Packet10 disposition remains distinct from an operating grant.
2. **Old03 accepted18:** these are historical scoped results only: four baselines, four harmless controls and 10 named faults. The extra physical old19 remains rejected with zero executed assertions. It is neither a kill nor an adopted result. No historical prefix is replayed here.
3. **Unit05:** permanently FAILED1, newAccepted0. Its first Node command is not adopted. Strict-wrap legitimately fails three selected tests: the canonical crossing case and the `not_found`/`incomplete` status cases, because all use that wrapped bbox. The old regex allowed only the canonical-query prefix. This is a control-oracle failure, not a candidate or native defect.
4. **Approved finite amendment:** only the three strict-wrap `expectedTestRegex` fields change. All 31 source transforms, assertions, fixtures and 20 planned Node argv remain exact. Packet15 adds the complete full-name/status/counter vector validator and narrow amendment guard, with 23 controls. Packet16 supplies the compatible outer/request. Its retained exact inverse recovers Packet13, and the capture prefix plus full parent/finally suffix remain unchanged. Independent byte/data comparisons support these stated boundaries; no source is executed in this review.
5. **Window06:** one ROOT dispatch, outer session 74826, terminal 0, invocation `84739bb6237a491eb9facca0d4e4d85c`. The 38 in-process calls comprise 11 validator, four reader and 23 finite/admission controls. Harmless cases come first in each subgroup. The two new omission controls reach exact AssertionErrors `FINITE_MISSING_EXPECTED_FAILURE_ACCEPTED` and `FINITE_UNAUTHORIZED_ORACLE_ACCEPTED`; suffix, wrong-reason and generic exceptions are rejected. Thirteen Node mutant invocations yield 36 expected assertion-failure observations across full predetermined vectors. These are not 36 distinct test names. Seven final Node checks follow.
6. **Parent reader boundary:** the unchanged 453-byte predicate does not inspect the new 23 rows. Its success permits provisional continuation, not acceptance of those rows. ROOT's independent row-by-row saved-data audit supplies the acceptance. Old15 results or parent exit 0 alone cannot do so. This review independently compares every new finite row with the saved expectations and does not strengthen that parent predicate.
7. **Mutation-source capture:** no independent per-case raw mutated-source body capture exists. The body derivation rests on frozen originals, literal worker transforms and actual control flow. Restored overlay bytes and final source hashes are available. Overlapping guards and selected omission controls do not establish universal sensitivity or every conjunct.
8. **Metadata-reader corrections:** ROOT initially appended a duplicate outputFile expectation to an already complete frozen argv. The initial audit remains `METADATA_ONLY_HOLD`. The correction compares the exact plan and independently reconstructs selection plus ONE output flag. No subject, control, runtime or replay changes. The author's argument-length and JSON key-order reader holds also remain. This review's own path-resolution and exploratory reader errors are retained in private metadata and `VALIDATION.md`; none is relabeled as a product failure.
9. **Resources and custody:** the recorded cap is 2 GiB, zero swap, CPU 50 percent and TasksMax64. Service runtime is 74.043 seconds, CPU 36.923 seconds and rounded reported peak 510.2M. Worker-final sampled memory.peak is 535,064,576 bytes, pids.peak37 and events0. It is not an independent final whole-unit peak observation. ROOT reports terminal donor52201, visibility20069 and original1783 body comparisons. This review rehashes all 2,470 saved outputs, totaling 12,634,410 bytes, against their descriptors. It does not independently rescan the live donor or claim current full visibility equals the pre-cleanup set. The two authorized config scaffolds are now absent.
10. **Direction:** Window06's direction exit0 retains expired review reminders, review/package version mismatch and intervening substantive commits. No review date, source pin or scope is washed. No new direction execution occurs.
11. **Frozen migrations:** original migration424 `20261017014010_land_use_plan_context_geography.sql` remains at SHA `b083241e879913afe93e848f4bb81191acf5439569c8226a86e14852bf3ee002`, including its known historical parser defect. ROOT combined separately adds two parentheses; this candidate does not adopt that repair. Migration425 remains frozen and migration426 remains unapplied. The inherited 424 problem is outside this correction and remains a native-chain prerequisite, not a new 426 finding.

## Evidence gaps do not become source defects or acceptance

No native migration424/425/426, PostGIS parser/planner/deparser, seam/edge/count execution, RLS/ACL, performance, Auth, HTTP, full build, identified desktop/390px browser journey, map-provider runtime, practitioner, hosted, release or full-v1 acceptance is established. SQL source review cannot show plans, actual seam envelopes or installed grants. Pure/mocked controls cannot show actual map-camera values, rendering, network/cache behavior or public usability.

No hostwide confinement, namespace owner equivalence, hard aggregate artifact quota, hard filesystem I/O deadline, arbitrary durability or complete capture/cleanup fault coverage is claimed. The differing donor/candidate lockfiles do not establish transitive dependency parity. Saved final source checks do not provide a new operating grant.

The product contract's states/DC, California, territory and tribal requirements remain unchanged. The roadmap M1 row remains partial, KI-025 remains open, and the capability matrix retains unassessed cells. WGS84 physical limits are coordinate-system rules, not jurisdiction-specific assumptions. No second selector, entitlement gate or legal-applicability promotion appears.

## Original records remain indexed in place

`EVIDENCE_PINS.json` supplies paths, hashes and byte counts for the 33 candidate changes, relevant unchanged access/schema/caller sources, all 22 preparation documents, selected original failure/source/amendment records, ROOT disposition16, checkpoint seals, acceptance and the new private review readbacks. It indexes existing artifacts without copying old corpora.

For the complete original brief and initial choices, use candidate `DESIGN.md`, `SOURCES.md`, `TEST_PLAN.md` and `ROOT_DISPOSITION.md`. For application and control preparation, use `SOURCE_DELTA.md`, `SOURCE_CONTROL_PLAN.md`, `CANDIDATE_MIGRATION_AND_FOCUSED_CHECKS_01.md` and the preserved CLI/outer/mountpoint supersessions. For outcome-name objections and the response, use private Packet14 `ASSESSMENT_AND_ORACLE_DESIGN.md`, Packet15 `PACKET_15_SOURCE_HANDOFF.md`, Packet16 `PACKET_16_SOURCE_HANDOFF.md` and ROOT `source-review-16/SOURCE_DISPOSITION_16.json`. For terminal authority, use ROOT `ACCEPTANCE.json`, `WINDOW06_SAVED_DATA_AUDIT_FINAL.json`, both retained metadata-audit correction records and checkpoint17. `VALIDATION.md` states what this new review independently checks and what it merely reads as dated evidence.

The source/data review is complete at this evidence tier. ROOT disposition is pending. No local commit or successor operation is authorized by this report.
