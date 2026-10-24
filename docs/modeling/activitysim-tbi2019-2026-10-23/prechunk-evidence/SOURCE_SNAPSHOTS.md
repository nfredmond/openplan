# Installed source custody

The tracked `.py.gz` files preserve the installed source bytes, including
upstream whitespace. Raw `.py` copies remain locally available and ignored.
`source-snapshot-custody.json` verifies lossless decompression and both hashes.
Source line references in the reports use the original decompressed files.
For example, `gzip -dc installed-source/core/assign.py.gz | nl -ba` shows the
cited assignment lines without changing any installed package.

The initial staged whitespace check reports one trailing-space line in the
verbatim upstream `core/configuration/top.py:781`. No source byte is changed
to remove it. Lossless gzip custody keeps this external source separate from
authored Python helpers. Licenses remain beside the corresponding snapshots.
