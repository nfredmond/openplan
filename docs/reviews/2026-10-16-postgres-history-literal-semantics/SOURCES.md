# Primary source register

Access date for every entry: October 16, 2026. Sources are PostgreSQL Global Development Group documentation or the upstream `postgres/postgres` release source. The `/docs/17/` manual can receive corrections; its pages are not frozen PostgreSQL 17.6 documentation. Source files use the `REL_17_6` release tag. This research does not establish that a vendor image has no patches. Private snapshots retain the retrieved bytes and hashes.

## PostgreSQL 17 documentation

- [PostgreSQL 17 Documentation: 4.1 Lexical Structure](https://www.postgresql.org/docs/17/sql-syntax-lexical.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `7a3ed79d39f3a6dd6689fa52ee202c596e97acf57db9ee8cceb08158d286bde5`.
- [PostgreSQL 17 Documentation: psql](https://www.postgresql.org/docs/17/app-psql.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `44cf88abea6476baf5fcc51086fe717e59b66b16e7e5cd49a85fd2f51dc871f8`.
- [PostgreSQL 17 Documentation: 53.2 Message Flow](https://www.postgresql.org/docs/17/protocol-flow.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `fee7d91874e84d696fa0f6f87bce83a62b6e1d949a86b975ee57f5c199091fb6`.
- [PostgreSQL 17 Documentation: 9.5 Binary String Functions and Operators](https://www.postgresql.org/docs/17/functions-binarystring.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `5f6b55f3abebba9f6c955a4c398ca3ed65f40968b0359bf1535d6b0bc8fa42ae`.
- [PostgreSQL 17 Documentation: SET](https://www.postgresql.org/docs/17/sql-set.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `08cfb74223734f4029ed8e5f0fc5a2801f7db82208d702f9378f560e21aa1d35`.
- [PostgreSQL 17 Documentation: SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `a453b7f5a5e3a73c3a3c2eff355a9262f546f4097027ce5592034790e151c30e`.
- [PostgreSQL 17 Documentation: 19.13 Version and Platform Compatibility](https://www.postgresql.org/docs/17/runtime-config-compatible.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `6540551d89ec9ba684f1f9085d394d0602f93d257021422ad517747a75136aa2`.
- [PostgreSQL 17 Documentation: 32.2 Connection Status Functions](https://www.postgresql.org/docs/17/libpq-status.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `b98f5e4031dd91484b32af04a437f577e090e3971832375eda4ba2a3562af096`.
- [PostgreSQL 17 Documentation: 32.3 Command Execution Functions](https://www.postgresql.org/docs/17/libpq-exec.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `c241f58ed50b75beadfa7447735dfd38b1026f3a223aa7fddd4564e2ad130685`.

- [PostgreSQL 17 Documentation: 9.19 Array Functions and Operators](https://www.postgresql.org/docs/17/functions-array.html). Version: 17 manual. Accessed 2026-10-16. Snapshot SHA-256 `b872a2ed4a30bc6c3d23331d45d6ac01e69aae5e28242669e390b63417551447`.

## PostgreSQL 17.6 implementation source

- [PostgreSQL REL_17_6 src/bin/psql/mainloop.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/bin/psql/mainloop.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `8d08a81c505571c39c0bc238816bdbd1edf9990d9364d6d7a40d70cb2bd6dcab`.
- [PostgreSQL REL_17_6 src/bin/psql/common.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/bin/psql/common.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `29fe648c0057e3d41eca6810d410171f6d3795c13482a9ff238872e85aa960b6`.
- [PostgreSQL REL_17_6 src/fe_utils/psqlscan.l](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/fe_utils/psqlscan.l). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `32db95d95e9e66f3e4ab2675424fba2c822409a570052d8c1158ef0998f0f068`.
- [PostgreSQL REL_17_6 src/interfaces/libpq/fe-exec.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/interfaces/libpq/fe-exec.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `a6566327548e056dadc4cb693c0487e80d063bdf4335b7eacdf78e90478169dd`.
- [PostgreSQL REL_17_6 src/interfaces/libpq/fe-protocol3.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/interfaces/libpq/fe-protocol3.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `4de496c52a4e83cb39375605278b000544bd8b9be499411fcfbaedc93c819fce`.
- [PostgreSQL REL_17_6 src/backend/parser/scan.l](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/backend/parser/scan.l). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `11729c526c464dab20e0b6a500cfc432243c8fab04e5c2afa45ea5101c924f39`.
- [PostgreSQL REL_17_6 src/backend/tcop/postgres.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/backend/tcop/postgres.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `801793541d67065a5e658e6eaf55f72ca70e30d3f23a8778b6205c9516b23832`.
- [PostgreSQL REL_17_6 src/backend/utils/misc/guc_tables.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/backend/utils/misc/guc_tables.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `0e52049e9f9a7d7a6784d9ddd817a84c1ca2359c701bb1ad588ddb6b6c9e26a7`.
- [PostgreSQL REL_17_6 src/backend/utils/mb/mbutils.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/backend/utils/mb/mbutils.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `f964bd5246139f0f6d24192691ddbfb498d01d46a23641e4e2850d0867e0b061`.
- [PostgreSQL REL_17_6 src/backend/utils/adt/encode.c](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/backend/utils/adt/encode.c). Version: REL_17_6. Accessed 2026-10-16. Snapshot SHA-256 `a3c0d39d1bc2a968a59b23a0404bb4fee11e73a36700f65ca8796ab9d57887f9`.

## Local subject and preserved evidence

The full independent source finding, exact R6 authored files, retained R6 template comparisons, original migration bytes and retained pre17 function descriptor are indexed in [source-pins.json](source-pins.json). These local materials establish the reviewed source path and retained claims. They are not PostgreSQL authority or fresh native observations.

The new private directory is `/home/nathaniel/.local/state/openplan/postgres-history-literal-semantics-20261016`. It contains primary-source snapshots, local byte copies and a nonoperational custody manifest. It contains no target connection, archive extraction, diagnostic run or executable correction.
