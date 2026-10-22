# PR328 main joins the reviewed PR329 candidate

October 15, 2026 UTC. This local merge joins fetched main
`4ea6a8ca3b43c6712952fc4e527a8538237a9adb` into exact PR329 head
`29d2dbd22239274de74ac36d3dbb08a7aca3e373`. Those commits are the second
and first parents, respectively. The assigned checkout remains on
`t3/pr329-main-join-328` at
`/home/nathaniel/.t3/worktrees/openplan/t3-17a4fd37`.

The merge has no conflicts and needs no manual source resolution. The parent
owns the actual PR branch, push, PR description and subsequent acceptance.
The original `work/t3-roadmap-integration-20261015` checkout remains untouched.
Canonical `.directory`, `COORDINATION.md` and `supabase/` remain unrelated
untracked entries. The leading operational PR328 delivery hold stays on.
This work makes no main-branch or hosted change.

## The automatic merge preserves both evidence sets

The merge imports 66 files relative to PR329. Of these, 63 match fetched main
byte for byte. Their complete path and SHA-256 manifest appears below.
The three combined documents contain these additions from main:

- `docs/ROADMAP.md` adds the second-secret candidate link to M3's evidence
  column. The Node process-observation link and every T3 planning entry remain.
- `docs/README.md` adds the integration-secret rotation checkpoint paragraph.
- `docs/archive/ROADMAP_EVIDENCE_LOG_2026-08-24_TO_2026-10-12.md` adds the
  dated integration-secret rotation candidate entry. Existing Node and T3
  entries retain their original bytes and historical claims.

Removing those exact additions reproduces the three documents at `29d2dbd22`.
Removing the second-secret and earlier Node links from the current roadmap
reproduces its entire text at approved source `af90a3890`. All 48 status cells,
including milestone names and IDs, match both checkpoints. No product scope,
completion grade, milestone definition or next action changes in this join.

The contract, milestone definitions, core requirements ledger, capability matrix,
capability registry and two-month plan match both `29d2dbd22` and `af90a3890`.
All 113 files already present under the T3 research, T3 roadmap, malformed-receipt,
reader-projection and final independent-review directories match `29d2dbd22`.
That preserves the collector, strict cache policy, both actual readers, all 25
unit cases, fault controllers and prior reports. It also preserves the separate
round-three [independent review](../2026-10-15-pr329-reader-projection-independent/REVIEW.md).

The earlier [main join](MAIN_JOIN.md), [approval](REVIEW.md) and
[validation record](VALIDATION.json) remain frozen. Their hashes describe their
original dated documents. The three combined documents have the new hashes
below; this note does not assign their current bytes an earlier approval hash.
The 13,199-record inventory and 72 selected PRs remain historical research.
No fresh strict 72-PR live recapture occurs here.

## Focused checks and runner correction

Before the join, `npm run product:direction:check` passes from `openplan/`.
After the join, the following existing suites pass serially:

- Collector: `python3 -I -B -m unittest discover -s
  docs/reviews/2026-10-15-t3code-concepts/scripts -p test_fetch_pr_details.py -v`,
  25 tests, no failures.
- Documents: the active-roadmap, mechanical-cross-reference and product-direction
  guard suites, 14 tests across three files, one worker and no file parallelism.
- Nested `npm run product:direction:check`, with existing age, version and
  intervening-change reminders. Historical review dates remain unchanged.
- Scoped staged `git diff --check` and exact byte/status comparisons above.

Both test attempts run with `MemoryMax=1G` and `MemorySwapMax=0`, network
isolation, read-only repository/dependency mounts and private temporary/Vite
caches. Dependencies come from the existing canonical installation; no install
or shared cache write occurs. No test, assertion or guard is authored or edited.
Existing harmless-survivor and named-fault records remain bound to their unchanged
sources; this join does not claim a new fault campaign.

Attempt 01 runs all 25 collector tests successfully, then the document suites
report eight passes and six failures. Its read-only root mount also makes
`/dev/null` read-only. Git reports `could not open '/dev/null' for reading and
writing: Permission denied`; the review checker consequently reports the
reviewed commit unavailable. This is a runner error, not a product correction.
The failed attempt peaks at 204.1 MiB with zero swap.

Attempt 02 adds a private device mount, keeping the same source, dependencies,
private caches and resource limits. All 14 document tests and direction pass.
The successful attempt peaks at 223.6 MiB with zero swap. Transient test units
are `openplan-pr329-join328-checks-20261015` and
`openplan-pr329-join328-docs-20261015-02`. The private runner and comparison
receipt remain in `/tmp/openplan-pr329-join328-20261015-hhb8_bcy/`.

These checks cover synthetic collector behavior, mechanical document references,
status cells and exact integration bytes. They cannot establish authenticated
upstream provenance, an exhaustive upstream snapshot, product usability, legal
applicability, independent scientific accuracy or delivery. Fresh exact-head CI,
parent QA and main CI/web/worker delivery remain separate. No full suite, build,
database, browser, application service, install, provider job, delegated review,
PR metadata update, push, release tag or main merge runs for this task.

## Current document and protected source hashes

SHA-256 values below describe the joined working tree before this note is added.
All listed source and document bytes remain unchanged when the note is committed.

```text
9e1b9205948b9dea581a0326c262c67abb8364683f24d9237bf82d8a415b1668  docs/README.md
5634ff62ebc543f17b6bd2a493f2210887f437159b315bb7b8b3678cd3fd6ef9  docs/ROADMAP.md
c4473f6c60a15ec058d4beaeb1bebb4a216133b9f9c0cc79ecdeb177eb52b7a7  docs/archive/ROADMAP_EVIDENCE_LOG_2026-08-24_TO_2026-10-12.md
304094a6bf6d8813a0f31b905d4959bfa11defb9a22275d4963ea4fede7356be  docs/product/V1_PRODUCT_CONTRACT.md
0f88f25810777d226d2f953689cf92070d41b8054f5553ee212d4c9db1e38fc4  docs/product/MILESTONES.md
543d7c3c822db5bff4d3d68ab3f4a47530a7ff6252b16b39cc66b1ce7352a78e  docs/product/CORE_REQUIREMENTS_LEDGER.md
adff647cacbd6ce12b4ca51bf2f5e25ba3da95a22f3dd831ae2b3e6552843105  docs/product/US_PLANNING_CAPABILITY_MATRIX.md
814be7ca7fa7a7dd49f98f77262fe50459ed60c6158ca8d5132b2b8f93b21335  docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
d2a239c93c5258216d6571323fd43662cfe5f50b134e8d929dde9e12e5226da9  docs/reviews/2026-10-12-two-month-review/PLAN.md
2febd9fb6f7bdda760ed243a2511da6b44ff0eb12b49bf4de426d791c2162907  docs/reviews/2026-10-15-t3code-concepts/scripts/fetch_pr_details.py
1e859aa5c66833d4e6744c3fb22a80579aa2c20d49324c15863adb5216b17fb6  docs/reviews/2026-10-15-t3code-concepts/scripts/full_text.py
e8055314fb0dc691eeabb0dffe5f55cad7d411b64864af43e0fa76a58b697d85  docs/reviews/2026-10-15-t3code-concepts/scripts/write_findings.py
bd42edf969fc53d34308e04267b1abb8fad2919a4336257dba5eddd91027a401  docs/reviews/2026-10-15-t3code-concepts/scripts/test_fetch_pr_details.py
250df40f90c8239eca68c12c9f702a7721a9a7b626d1408327897086d3c234dd  docs/reviews/2026-10-15-t3code-concepts/scripts/verify_collector_controls.py
```

## All 66 files imported by the merge

These paths differ from first parent `29d2dbd22`. This note is the sole new
integration-authored file and is outside this imported-file manifest.

```text
17577fbffb58613a2ede7ed9500d89e3ccb6e332d8b9e16c0fed5d74b0111a98  .github/workflows/integration-secret-rotation.yml
4d8f3b99346f1955a36fd71d57cb1cdb7ae69194bbfe1692272d5b9d0e8f1ee0  CHANGELOG.md
9e1b9205948b9dea581a0326c262c67abb8364683f24d9237bf82d8a415b1668  docs/README.md
5634ff62ebc543f17b6bd2a493f2210887f437159b315bb7b8b3678cd3fd6ef9  docs/ROADMAP.md
c4473f6c60a15ec058d4beaeb1bebb4a216133b9f9c0cc79ecdeb177eb52b7a7  docs/archive/ROADMAP_EVIDENCE_LOG_2026-08-24_TO_2026-10-12.md
b3cff93b475952fcfbb04eb494c57b323d347c63e13956dc496f9dcd1cf7a4d0  docs/reviews/2026-10-15-integration-rotation-consumer-independent/STATUS.md
4cc32314e793558d4a26e131da377a3e45f7f487077fb69b6b73e94f5aad7a8f  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/baseline.json
c800657882764fde9568fa1f61d76a5f81c99bf20a9c26c43b75b63ed6a7c1dd  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/classifier-controls.json
02fc86dbaebfc17f893eafd52f20ba39f76e0357b2fdcf22c504639b9852234f  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/controls.json
327e86a65895bd4c2f5abc4eec2e1388017d5069f299418b9c1ee1aadcf7aafd  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/fallback-payer-after-row-decrypt-fails.json
de649ab7b3af54aff31f09ee5e30eb83cde15a950c13c051c5eb27829d6b61af  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/harmless.json
931f6f981faf963939cbbf3cb8f207cea5fd3896de9e5397adf755c33a8743ba  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/ignore-encrypted-api-configuration-hash.json
15374dd0f77431e55fac11e985914131060ca86751cf3c939f90a00d6c9773f6  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/ignore-outer-api-configuration-hash.json
e64500f748f8463a74e534723f06fcb912f3ca66debd9e9656d2f95e448b0da7  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/ignore-retained-ciphertext-digest.json
780d293cc0072ffdd218e18ca2af41609ddba466182b57476953e5e9b00c54c0  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/independent-source-bindings.json
0b676c30582cccc9763b1c8f41e515ed0be8883f10e8963cbd84e023630a016f  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/no-previous-secret-read.json
bd3f5f3a76b8652c828c501c77a67242293d5f47b04ab7706f1af99f155e47de  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/omit-selected-workspace-column.json
42ce33bc51d9a30ead21b4a3dfcc8f660f000ce8d488b22bdae3818545c3f5de  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/plaintext-instead-of-stored-digest.json
7dbb1f1998c1f1cccadc20de6630e6f3f84ff9ddc440d2062b0f9faf12e16311  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/resources.json
88a9a00afe96dc386ad6ce488f6e30e726d0c1faee8d39d33cad222d976ac1ae  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/restored-after-harmless.json
a41d03c165c6ec09c28ccc97d89fd5cc282cb7f3c54c2ce828eca584df4fa54a  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/restored-final.json
008a9c60ac07f2ee31b78384990b7b2e409b301eb9b31f30d25fbd54a62f9f9c  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/review-checks.json
400abfecc792a3c4ea40861a56b4dfb26a529058c0fb9f7b6e280ec4b90b32a0  docs/reviews/2026-10-15-integration-rotation-consumer-independent/evidence/source-bindings.json
d5c3bc36cdbf30823d02de9373b081976dd942cb3894eb2a60162cb8f05f1b25  docs/reviews/2026-10-15-integration-rotation-consumer-tests/STATUS.md
8c9f186eead7f5ede1e9db9896e17064ba980085c04e02e6ab63fac4c3f044d5  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/baseline.json
f4987039fe63a4721666869fb9113de295bc12c7a46173823cc32e64b5bbce0e  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/checks.json
c800657882764fde9568fa1f61d76a5f81c99bf20a9c26c43b75b63ed6a7c1dd  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/classifier-controls.json
02fc86dbaebfc17f893eafd52f20ba39f76e0357b2fdcf22c504639b9852234f  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/controls.json
57b4f41849e6e22922e15d14bbc4245073ae5ada40f26f0ba525e20bd8e8e3af  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/failed-trials.json
bd78d9d6d5ebd08c55837055c5bf1ddb3169aad145dedf62910e201d533012c9  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/fallback-payer-after-row-decrypt-fails.json
780d293cc0072ffdd218e18ca2af41609ddba466182b57476953e5e9b00c54c0  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/final-bindings.json
5fde7dc9b0df851131cd89a7e1bc2c05a84ca72ca6b15bda4e9479b245829ee7  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/harmless.json
fba89d5756ee5447f5fa3b51eef6d8fe60d4eac454e460db9e1bfab517b87230  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/ignore-encrypted-api-configuration-hash.json
a5101dfa82f70eaaf7488fa351ddd3e404ea465cfb2d64441d1eca3f401e5e4b  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/ignore-outer-api-configuration-hash.json
e726a9a4bc3efe264504a74fbdd9d592e8dece572ec31cfe795708a6a91dff49  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/ignore-retained-ciphertext-digest.json
a30178e5b01d1369afa32c0206355147bf42f27d814b52877e4b7f0037f61c82  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/no-previous-secret-read.json
e0efb1b27f8663211474edad1c78a230bdefd738d4ebfe0ff941d249df4cd5c8  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/omit-selected-workspace-column.json
e538bcbfeb29ab0f3e5d45d90bb1422b95f2f53dd31867d1da195d77d9be05e1  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/plaintext-instead-of-stored-digest.json
603addbb77e9593aec1497aae9b6b4dadb719b354942c547e0a9629881b41958  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/resources.json
7d26cfa086171f1ec0478c172dcbc42ccbb95de8867f825483739bd40f57e931  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/restored-after-harmless.json
838fd791e30feb65ea41fd216c46622a944cb3ffc6e3ccb35b0175dc76151d2b  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/restored-final.json
400abfecc792a3c4ea40861a56b4dfb26a529058c0fb9f7b6e280ec4b90b32a0  docs/reviews/2026-10-15-integration-rotation-consumer-tests/evidence/source-bindings.json
6fca036c968e7dc2cad9dd880b0f71cda9fe582b6cda240b685bd245637c2a00  docs/reviews/2026-10-15-integration-rotation-consumer-tests/verify_controls.py
417e4a32b1dad72891582c53aa0a47a76f779cd181f1ced0b3f7f5b6f27d0863  docs/reviews/2026-10-15-integration-secret-rotation/INDEPENDENT_ROLLBACK_REVIEW.md
96fc26054ea79f7e055a6ce95eda7e0e9209437ae033a7075a81178ab3d5f6a0  docs/reviews/2026-10-15-integration-secret-rotation/MAIN_JOIN.md
d8e6e26b4f0f9458185a8b6dda27dc9a7cb4b5f91d18c2b5f1c4ea7c1f2db9fd  docs/reviews/2026-10-15-integration-secret-rotation/REVIEW.md
7bdc1f27df92c1851fb48e98868ba7e21b5caffb4a6ab5ea42b1bc29b560383f  docs/reviews/2026-10-15-integration-secret-rotation/STATUS.md
f8c3daee7461ca0e7583b9099f416f34b52714dbb19cbd08a6017664b913d986  docs/reviews/2026-10-15-integration-secret-rotation/candidate-source-bindings.json
c65e6e73e3de411fb01ff88acac02db63e305eb008e0a63277174370c591b119  docs/reviews/2026-10-15-integration-secret-rotation/controls.json
f8a0cdab1f2139a08e26fbeb0d13187a37d565de2f44785ed6d7daeed058bd9f  docs/reviews/2026-10-15-integration-secret-rotation/final-checks.json
9dc330cea599a9d5859eda788e1842b587929d5f338d3e8c78f90e77c3ac72cf  docs/reviews/2026-10-15-integration-secret-rotation/final-resources.json
b3d8da92834c265112e476b0806ca2e4d32e31c3d18c18d5ad0581d8727e6b89  docs/reviews/2026-10-15-integration-secret-rotation/oracle-controls.json
16c71a5cb32029d365617fda72446b5528d75f82d7bb2fb0e9c2619ff1d525ec  docs/reviews/2026-10-15-integration-secret-rotation/regression-summary.json
5390bad71e0f543237c8c72709b2a8507d88955b65ad2a3924a96e107f0a7c74  docs/reviews/2026-10-15-integration-secret-rotation/restoration-controls.json
46710348eb4b4fbd988574ce78a1de3a1590393bf1f6184d20b7ea6f9a3409e4  docs/reviews/2026-10-15-integration-secret-rotation/rollback-doc-controls.json
d055eb01e1311d896dc70a7b636dd546db5f27019a1e7d2a4b08f3f9b9c53729  docs/reviews/2026-10-15-integration-secret-rotation/source-bindings.json
6ef0eae00dffd7734b5869eb8a8a41f6bd40f61ff8406e0ce7049e1d4a52678c  docs/reviews/2026-10-15-integration-secret-rotation/verify_controls.py
4542892421bb5811690d197d14dde2ae29c11948d26d028759542cd73d84b386  openplan/.env.example
90053933d65cfb5e1d761ec1afa97f37e146b0af4c21161fd0b1141b0934ade0  openplan/docs/SELF_HOSTING.md
3b43d427ba165fcf82c372701d967c782d9d200d552174346b5e57f6fce0ae15  openplan/docs/ops/BACKUP_AND_RESTORE.md
eac75dae31e056d81bfdd676a97e6612fb829a2dadfd8e1b14e78a9ba45663e3  openplan/docs/ops/HOSTED_OPERATIONS.md
b93e59cde0ad0c2d1768273b29ace4bade93b104c3b146e04b4c97d62e479e95  openplan/docs/ops/HOSTED_RECOVERY.md
298f8b2218e578af8c6e6c050011d7839002c801aa68daf25df1411b42a7d274  openplan/src/lib/integrations/key-crypto.ts
bcdf738f9c0b4e77d89c78670e329f6bd6226beacb4b25384debfb2e7db5850e  openplan/src/test/integration-key-rotation.test.ts
004a0cdf3cd71592bf6469eceea3e69e93c73b2b8baf4e34143aa2b5dfcb2522  openplan/src/test/integration-rotation-consumer-chain.test.ts
9175b73a58e46187c978058ccc3b717f9aecd581da31d38365029c33a101a3ac  workers/hosted-node/DEPLOY.md
```
