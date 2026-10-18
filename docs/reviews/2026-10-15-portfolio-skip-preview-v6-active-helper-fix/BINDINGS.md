# Fixed V6 seals and parent handoff

These hashes identify preparation only. Independent ROUND3 has not yet accepted
this packet. No operating stage runs in this followup.

| Artifact | SHA-256 |
| --- | --- |
| Public manifest | `bd8ff7c66be0e7869ed6553bb9fce51b2a313ebf5d2452d41a69fc768bdb830d` |
| Private operation-files.sha256 | `1bd2e70cc13cc1d9af8944ef96d4856da162db6b5dbc42d423a62340aaa73e3c` |
| Literal parent_recipe.sh | `5342df59072e6083353151f410e9ce73f3cb3a1cedfa75a263eee8a6181a9168` |
| V6 runner | `b83ca1554fcecbe8ae2d5e9806717c53b5cec6e4cb3c7474ba3a65b9e318f7db` |
| V6 helper | `0d58b5523890386d0758abe311dbe50d6fcbcea4661f4e31646fa5060b6e1bf9` |
| Fixed host observer | `2ebe4e3b238413db916d211181bab81fbd2337da063f2b0a8e1badf73c008a36` |
| Fixed host transport | `1fe4ac37961be1b4429ae4285dfbad3a9a6473e02a466d4b6e543782830ebcd3` |
| Exact active identity binding | `566a52886f660564e915cb4c822e8b34bf6cc0d9d763aff1cce2828d5de3c765` |
| Complete fixed CHECK definitions | `f183f73a620735ce517b5b3c42084cac094de52d0ef3f454990e854cff131809` |
| Frozen V5 packet inventory | `44f5265ee34b8c43c8e3f3267e0e6d93787dfafb39d2154ba83ad112f0f4dd5e` |

The private root is
`/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6`.
The [manifest](manifest.json) lists all 34 sealed inputs. The executable
[parent script](parent_recipe.sh) externally pins both checksum list and runner,
checks every sealed input, admits one review commit and dispatches exactly one
stage under the shared lock. The commit identifier is a custody input; root must
read and accept the actual fresh review before using it.

Use the [full stage and journey recipe](PARENT_RECIPE.md). Root must inspect each
actual receipt and failure before requesting the next stage. A lost acknowledgement
or reserved name requires investigation. No automatic retry or alternate binding
is authorized. The durable final post-journey result remains required after the
actual desktop and 390px journey.
