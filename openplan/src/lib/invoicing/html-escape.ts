/**
 * HTML text escaping for the invoicing document builders.
 *
 * WHY THIS FILE EXISTS AT ALL. `esc` was a private function inside
 * `invoice-pdf.ts`. The moment a second document builder needed it, the choice
 * was to import it from inside one of its two callers or to copy it — and a
 * copied escaper is the recorded defect class in this repository: "a shared
 * capability living inside one of its two callers will be reimplemented wrongly
 * by the other". Two escapers drift, and the one that drifts is the one that
 * stops escaping something. So it moved out here, where both callers import the
 * same five replacements.
 *
 * WHAT IT IS FOR. Every string that came from a person — an award title, an
 * invoice number, a vendor label, a cost description — is text, not markup.
 * These documents are paper an agency hands its funder; markup smuggled into a
 * description must arrive as visible characters, never as tags.
 *
 * WHAT IT IS NOT FOR. Attribute-value contexts beyond quoted attributes, URLs,
 * and inline script/style are not covered — nothing in the invoicing documents
 * puts user text in those positions, and if something ever does, it needs its
 * own encoder rather than this one stretched.
 *
 * (`src/lib/reports/html.ts` still carries its own identical copy. It is
 * outside the invoicing lane and is left alone deliberately rather than
 * refactored in passing; the two are byte-identical today.)
 */

/** Escape a string for use as HTML text content or inside a quoted attribute. */
export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
