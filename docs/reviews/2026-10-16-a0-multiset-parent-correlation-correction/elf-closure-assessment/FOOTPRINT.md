# Proposed fixed additions, not a runtime manifest

Keep all1218 declared runtime files. Add exactly29 regular ELF objects,13510272 bytes, and25 symlinks. The source-only table files ADDED_FILES.tsv and ADDED_SYMLINKS.tsv give complete path/hash/size/mode/UID/GID and path/target metadata. Private INDEPENDENT_FOOTPRINT.json contains their full typed records plus exact alias resolution. This document does not amend CONFIG or produce a wrapper request.

The resulting proposed selected-runtime total is1247 regular files and32 symlinks. All29 objects and25 new links live under /usr/lib/x86_64-linux-gnu. No new root, default directory, environment patch, device, mutable path, network endpoint, service, credential, installation or resource dataset is proposed. Regular objects stay individually pinned and read-only in any later source proposal. Symlink targets must be created exactly; a namespace owner-equivalence claim cannot follow from host UID/GID.

The existing six-system-object projection expands to35 system objects while retaining one interpreter and50 extension objects,86 loadable objects total. python.o remains selected data but outside the loadable-root graph. The Tcl/Tk/X11 portion follows the selected _tkinter module. It grants no GUI or display access.

The interpreter directly needs libm.so.6, libz.so.1, libexpat.so.1 and libc.so.6. This explains why selecting six objects based on earlier assumptions missed startup closure. Every selected extension and the recursive dependencies were parsed independently. No observed native response becomes a baseline.

A later source proposal must preserve all frozen94 cases and limits. Full static graph/name/version matching does not remove dynamic/resource/ABI, memory, descriptor-count, mount-cost or blocking-I/O uncertainty. Root must choose this footprint before any new wrapper or request is authored. No grantable packet exists here.
