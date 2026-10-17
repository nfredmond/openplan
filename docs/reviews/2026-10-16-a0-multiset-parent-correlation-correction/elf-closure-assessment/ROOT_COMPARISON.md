# Independent result compared with Root's saved binary audit

The author sealed INDEPENDENT_SEAL.json before reading /home/nathaniel/.local/state/openplan/a0-python-elf-root-static-audit-20261016/STATIC_ELF_AUDIT.json. Root's audit.py was read as source, not imported or executed. Root's READER_ERROR01.json remains original. Full descriptor joins and exact set differences are retained in private ROOT_CROSSCHECK.json.

The57 seed path sets and86 resolved-object path sets are identical. Every object agrees on SHA256/length/mode/UID/GID, machine, PT_INTERP, ordered DT_NEEDED, SONAME, RPATH/RUNPATH, version-needs names/weak flags and version-definition names. The140 tuples of source/name/logical alias/resolved object match exactly. The author's142 total edges additionally count two PT_INTERP edges; Root reports only140 DT_NEEDED edges. The29 required regular-file sets match exactly.

Root labels30 paths as aliases absent from direct CONFIG input/symlink keys. These are not30 new symlinks. The full classification is:

| Root alias category | Count | Required addition |
| --- | ---: | --- |
| Actual host symlink absent from retained namespace aliases | 25 | Exact proposed new symlink |
| libdb-5.3.so, libssl.so.3, libtcl8.6.so, libtk8.6.so | 4 | Regular files already counted among29 objects |
| /lib64/ld-linux-x86-64.so.2 | 1 | No new link; retained /lib64 -> usr/lib64 plus /usr/lib64/ld-linux-x86-64.so.2 -> ../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 resolves to retained loader |

The author's namespace simulation checks the existing interpreter chain rather than testing only exact CONFIG keys. Therefore the minimum explicit addition is29 regular files and25 symlinks. There is no required file/link disagreement. The old seven links remain, for32 total proposed symlinks.

Root searches an additional /usr/lib64 default directory. The author's policy follows the requested two directories, /usr/lib/x86_64-linux-gnu and /usr/lib. No chosen DT_NEEDED candidate requires Root's additional directory, and every resolved edge still matches. The PT_INTERP alias path remains separately explicit. This does not authorize a broader search rule in a future wrapper.

Root checks nonweak required version-name availability. The author also compares weak version requirements, ELF version hashes and4050 versioned undefined direct-provider symbol names/versions. Both produce no static disposition issue. Neither comparison proves loader execution, ABI, dlopen, conditional resource availability, mounts, capabilities or94 control outcomes. Both python.o reader-scope errors remain retained as metadata errors, not trial failures.
