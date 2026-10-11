# Bundled application fonts

OpenPlan uses Public Sans 2.001 for body and interface text, Space Grotesk 2.000
for page titles and large figures, and JetBrains Mono 2.211 for monospaced text.
`layout.tsx` loads the unmodified variable TTF files through `next/font/local`.
It requests weights 400–700, 400–700 and 400–500 respectively, with swap
behavior. Public Sans was added on October 10, 2026 (decision D7 of the
October 1 UI review): it is the U.S. Web Design System typeface, drawn for
long government text, where Space Grotesk's display letterforms slowed reading.
Public Sans comes from the same pinned Google Fonts commit as the other two.

Each family directory includes the original SIL Open Font License 1.1 notice.
`provenance.json` pins the Google Fonts repository commit, download URLs, sizes
and SHA-256 values. The three font files total 427,200 bytes before transport
compression. Full font coverage replaces the previous downloaded subsets.

The local files remove the build's Google Fonts network dependency. Next.js
still emits font assets served by the application. See the official
[local font documentation](https://nextjs.org/docs/app/api-reference/components/font#local-fonts).

For an update, retain the new upstream license and provenance, verify font
identity and character coverage, and review the rendered application before
claiming typography acceptance. Do not replace a source file based solely on
its filename or an unverified download.
