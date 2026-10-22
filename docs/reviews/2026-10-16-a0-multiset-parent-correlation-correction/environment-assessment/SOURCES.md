# Exact installed and primary-source pins

All source snapshots are data in the private environment-assessment/sources directory. SOURCE_FETCHES.json, SOURCE_FETCHES_02.json and EXACT_COMMIT_SOURCE_JOINS.json retain URLs, retrieval timestamps, lengths and SHA256. No downloaded source is imported, compiled or executed. No source archive is fetched or parsed. INSTALLED_SOURCE_BINDINGS.json pins package stanzas, binaries, headers and local metadata. The local package MD5 joins establish recorded metadata consistency, not a reproducible or signed-source-to-binary build.

| Installed package | Immutable Ubuntu applied commit | Reviewed files |
| --- | --- | --- |
| bubblewrap0.11.1-1ubuntu0.3 amd64 | 4442b57f802c6a6199b1c3224295e44c6bb8afa5 | bubblewrap.c; utils.c |
| python3.14 and related runtime packages3.14.4-1ubuntu0.2 amd64 | eff79ec60abd2754089eba5bacb4beda5f898226 | Python/preconfig.c; Python/initconfig.c; Python/pylifecycle.c; Modules/posixmodule.c; Lib/os.py |

The applied-version source files match seven separate immutable-commit downloads exactly. The installed os.py matches the reviewed applied source. Installed patchlevel.h names3.14.4; the architecture-specific pyconfig header records locale coercion support. None is a claim that arbitrary compiler or frozen-module output was reproduced.

Upstream tags are also pinned through annotated tag-object metadata: bwrapv0.11.1 resolves to124c4cdf4321f63ef17a1cb0ce8f9dd45bd7adbe, CPythonv3.14.4 to23116f998f6789d8c2fbe5ed5b8146854c8c2a4f. Reviewed Python files and bwrap utils.c are byte-identical across those upstream and exact Ubuntu source versions. The retained Ubuntu bwrap diff changes privilege-drop behavior and a diagnostic outside the environment construction. No claim about those changes or namespace behavior is added.

Primary exact-source links:

- [Ubuntu bwrap source and environment parser](https://git.launchpad.net/ubuntu/+source/bubblewrap/tree/bubblewrap.c?id=4442b57f802c6a6199b1c3224295e44c6bb8afa5#n2514), with late PWD assignment at line3546.
- [Ubuntu bwrap clear/set helpers](https://git.launchpad.net/ubuntu/+source/bubblewrap/tree/utils.c?id=4442b57f802c6a6199b1c3224295e44c6bb8afa5#n287).
- [Python preconfiguration](https://git.launchpad.net/ubuntu/+source/python3.14/tree/Python/preconfig.c?id=eff79ec60abd2754089eba5bacb4beda5f898226), especially-I parsing at205/246 and locale selection at674-710.
- [Python command-line configuration](https://git.launchpad.net/ubuntu/+source/python3.14/tree/Python/initconfig.c?id=eff79ec60abd2754089eba5bacb4beda5f898226), with-B and-S cases indexed in SOURCE_REASONING.json.
- [Python locale startup](https://git.launchpad.net/ubuntu/+source/python3.14/tree/Python/pylifecycle.c?id=eff79ec60abd2754089eba5bacb4beda5f898226#n194), nonempty LC_ALL guard and coercion routine.
- [POSIX environment conversion](https://git.launchpad.net/ubuntu/+source/python3.14/tree/Modules/posixmodule.c?id=eff79ec60abd2754089eba5bacb4beda5f898226#n1753) and [os environment mapping](https://git.launchpad.net/ubuntu/+source/python3.14/tree/Lib/os.py?id=eff79ec60abd2754089eba5bacb4beda5f898226).

The actual binary pins are80424-byte /usr/bin/bwrap SHA523da3e7399044be5163aee6f57a77a6bef7454376e28f0a0627920bae1b76b6 and7477160-byte /usr/bin/python3.14 SHA52e0a13e60a981d8c4b6478be2ba5176f69da07948a056bf49cf6f077e30cb41. Full mode/UID/GID are private pinned metadata. These match the frozen trial03 input/tool records. Exact source comparisons support the conditional inference; the missing TEST03 raw environment remains unproved.

The web source reader initially returned Internal Error for Ubuntu cgit. Direct primary-source retrieval succeeded, including immutable commit checks. This access issue is not a candidate/runtime failure. Historical root draft/path/UID reader errors and author ET_REL parser errors remain original and are not regraded here.
