# Source admission and custody

Access date: October 23, 2026. The lead authorizes the public Metropolitan
Council TBI 2019 release for development research. No account, payment or
agreement was required. No alternate survey, restricted geography or other wave
is acquired.

The [official catalog](https://www.arcgis.com/sharing/rest/content/items/15cdcdd4d7684ac0a091cd4ca65fe838?f=pjson)
states exactly:

> None. This dataset is public domain under the Minnesota Government Data Practices Act (Minnesota Statutes Chapter 13).

The retained [catalog response](evidence/catalog.json) also contains the agency's
accuracy/currentness disclaimer and recommendation to retain metadata and the
disclaimer with redistributed data. We commit aggregate research records and
source receipts. The raw household roster and assignment identifiers stay local.
Public availability does not establish survey/model comparability.

## Exact source objects

URLs, access timestamps and byte counts accompany every hash in the three
manifests. Roster query URLs explicitly project only `hh_id,home_county,survey_year`.
They use no mode, weight, person-day or trip field. Eight pages contain the
7,516-household roster. Two count requests bound acquisition; both return 7,516.
The service is dynamic, not a transactional immutable release. Matching counts,
unique IDs and exact response hashes establish this captured roster, not proof
that the live service can never change.

| File | SHA-256 | Meaning |
|---|---|---|
| `catalog.json` | `a1f558c22f17d8519981d2b7241abebe3ce94675e704b312bbba8327c54fe4c2` | Official metadata |
| `schema-0.json` | `458401d60df0b7e501064b62dfa01f35cc719526fc6d681474dd190d868bd105` | Schema only |
| `schema-1.json` | `f3100aa000f03ba52e76870f7b3b723595ffe169413726d97d048a199388a7e1` | Schema only |
| `schema-2.json` | `3d2486b06e0d9005d78696d8c74df33c5e4142d5819140466810d06c64c012a2` | Schema only |
| `schema-4.json` | `7f5dd2511b85713995b55cb88ffe401ad4be3fab715592bbcccd81745d8ed9a9` | Schema only |
| `schema-9.json` | `f35102f9f586975ebf5da09380b183482b14fbae6a56c0619cfda4f8641e0db1` | Failed metadata request: service error 404, Layer not found |
| `schema-10.json` | `f35102f9f586975ebf5da09380b183482b14fbae6a56c0619cfda4f8641e0db1` | Failed metadata request: service error 404, Layer not found |
| `weighting.html` | `15410edc8f7389c23c1d6fffb7c101bdef675eba83a4abe57bfc9c810cf1d3d6` | Published methodology and aggregate illustrations, not respondent records |
| `users-guide.html` | `09301b0f55b1f1bafc1c77e4072e130191e07ddf8c11faa8290c2616dd7336b6` | Published methodology and aggregate illustrations, not respondent records |
| `count-before.json` | `d55790053cc34ac5667f90c519a3357b1860b9cb95bc5b13e008cbe618526fd4` | Household count only |
| `roster-000000.json` | `e9e1fc8436718884e65da6560ad0c74bbe62cb0a82ae9abc792054ec2d76cffd` | Outcome-free household projection, local only |
| `roster-001000.json` | `8dc3c97db1648f5b7378c30258550cfa487b42094cb1e5ac5b015be2bce2b3ba` | Outcome-free household projection, local only |
| `roster-002000.json` | `2a394112310eb3e1cf403bac8357455f0a06bb0da530ee89b8f8526984f76a41` | Outcome-free household projection, local only |
| `roster-003000.json` | `3e29f378f044353e5a0bdc5979ea57fee8da634ec8ff7491e6c36828f2c0e6e8` | Outcome-free household projection, local only |
| `roster-004000.json` | `613c937f6eba160f2dd7d2c36558798e97c338f48b349c36fb5ffd4cc99ebc49` | Outcome-free household projection, local only |
| `roster-005000.json` | `d5c29d90ffad71e589421b62c54b6cfa51d294e007ba1ca9aa99eacd6cec70a1` | Outcome-free household projection, local only |
| `roster-006000.json` | `374ae66df04223066b74965c8803b2588fea4a380573376e3d92ab1425f3b10d` | Outcome-free household projection, local only |
| `roster-007000.json` | `79e6abc453f4d510c255dd6f2293c6e30dd57b9d299734783765f0ca8dbd709c` | Outcome-free household projection, local only |
| `count-after.json` | `d55790053cc34ac5667f90c519a3357b1860b9cb95bc5b13e008cbe618526fd4` | Household count only |

The two failed metadata requests probed table IDs present in the previously
reviewed 2023 service. The 2019 service exposes tables 0 through 7. These errors
returned no survey records and are not successful schema evidence. No retry
changed the failure record.

## Prior access and frozen inputs

The source-assessment branch is `298f10afcf6433fc019c69b815e6cae19c2d959e`. Its main assessment file
has SHA-256 `014352ed77c8625ce0e7bdcd17fe2ea35cb03d5e8a430fcb7ca2e4b7eb283c60`.
The main assessment and its northern appendix report documentation and
server-side aggregate counts, not prior TBI respondent-level outcome access.
The record does not prove absence of unknown external access. The donor uses
SEMCOG's 2015 survey; the default has MTC lineage. No inspected source identifies
TBI 2019 as their estimation sample, but a complete donor-lineage audit remains
unverified. No independence claim follows.

The coefficient base is `1a99efd966af00ac5d6e3c71a00e9857b3333cfb` from PR #376.
The candidate overlay SHA-256 is
`537e54811e4b6ca9fec0662085777e9679a634bd312bb7c64df6e58ff60c7490`.
Its upstream donor coefficient SHA-256 remains
`4e7b7ed7e37672ec76ed0a3aa877708cb723207586074923946831c41dec482c`.
Existing frozen records, accepted components and worker defaults remain unchanged.
No NHTS source or reserved 2017/2009 record is opened.

The split specification hash is
`89949004a378fb0f54fb1bbb8b3d281b1843049d9f60b40b7a15653305bcef43`.
The canonical private assignment hash is
`d00206802218a92d31dceea4c108c74cab540dadd8c90d9d1f21e8b11b99c392`.
The [roster manifest](evidence/roster-source-manifest.json) hash is
`9b919bf1e5ce1a02916e0a0c23bcc62dad5abb3489a01ff68247d43e48d8b4fc`.

Original response bytes and private assignments are retained under
`/home/nathaniel/.local/state/openplan/tbi2019-development-20261023/`.
The original execution paths remain under `/tmp/openplan-tbi2019-20261023/`.
Do not rerun the consumed synthetic lock. No real TBI outcome lock or receipt
exists because historical input and mapping admission failed before opening.
