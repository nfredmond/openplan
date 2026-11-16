# Census Bureau Gazetteer names, 2026

What each Census id is called, for the proven job checker
(`openplan/scripts/ops/capability-evidence.mjs`, `checkPlaceName`). The
checker compares a record's place label with the name here for its id, so a
record cannot name one place and carry another place's id.

## Source

U.S. Census Bureau, 2026 U.S. Gazetteer Files, national files, read on
November 16, 2026 from
`https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/`.
The Gazetteer files are a work of the United States government and are in
the public domain.

| Table here | Downloaded file | Member | SHA-256 of the downloaded zip | Rows | SHA-256 of the table here |
|---|---|---|---|---|---|
| `counties.tsv` | `2026_Gaz_counties_national.zip` | `2026_Gaz_counties_national.txt` | `6a99ca00efbc0be5112e225d4102704c51d5ce3b16e3afd6e4159460595fd12a` | 3,222 | `4f8ab9b4f91ee1365a3253d2e47f55bf457cc37324ff08567e30d82408e48d07` |
| `places.tsv` | `2026_Gaz_place_national.zip` | `2026_Gaz_place_national.txt` | `af678e2d990827c89ee39b98c82de6e90b693c7361ff0e559ae3076670dd2863` | 32,363 | `371450b158bf40cb657316478555dd646569ab22c42420bb8c67c3f21ef83180` |
| `cousubs.tsv` | `2026_Gaz_cousubs_national.zip` | `2026_Gaz_cousubs_national.txt` | `9d528b39b70a27075c863b1572f27eadaf24484d5435fac17fc3b4cdd36434c2` | 36,381 | `7ff8fbaa59a88944e0f666a36642d0ab0a9ef2b908132cd07a9fdeb0c819ac5b` |
| `aiannh.tsv` | `2026_Gaz_aiannh_national.zip` | `2026_Gaz_aiannh_national.txt` | `772bf000da15423d1d5220ace14fda05907d6c915b0a98f7961a7fcf898035ef` | 704 | `4148c9a81734a2983ef77bb57122520ba0fc8025ac53a857c9ac2aff67e23441` |

## How the tables were made

Each downloaded file is pipe-delimited text with a header row. For each row
the id (`GEOID`), the state's postal code (`USPS`, where the file has one)
and the name (`NAME`) were kept, with surrounding spaces removed; every other
column (land and water area, interior point) was dropped. Rows are sorted by
id. Nothing was renamed, merged or corrected. The tribal areas file has no
state column, because an area can lie in more than one state, and its id is
the four-digit Census code that covers the reservation and its
off-reservation trust land together.

## What these tables are not

They are names for ids in one year's Gazetteer, not boundaries, populations
or a statement of any government's status. A place created or renamed after
the 2026 files is not here, and the checker refuses a record that names one:
replace these tables with the next year's files, by the steps above, and say
so in the checker's known issues.
