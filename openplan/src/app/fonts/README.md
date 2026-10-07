# Bundled application fonts

OpenPlan uses Space Grotesk 2.000 for body and display text, and JetBrains Mono
2.211 for monospaced text. `layout.tsx` loads the unmodified variable TTF files
through `next/font/local`. It requests weights 400–700 and 400–500 respectively,
with the existing CSS variables and swap behavior.

Each family directory includes the original SIL Open Font License 1.1 notice.
`provenance.json` pins the Google Fonts repository commit, download URLs, sizes
and SHA-256 values. The two font files total 323,884 bytes before transport
compression. Full font coverage replaces the previous downloaded subsets.

The local files remove the build's Google Fonts network dependency. Next.js
still emits font assets served by the application. See the official
[local font documentation](https://nextjs.org/docs/app/api-reference/components/font#local-fonts).

For an update, retain the new upstream license and provenance, verify font
identity and character coverage, and review the rendered application before
claiming typography acceptance. Do not replace a source file based solely on
its filename or an unverified download.
