"use client";

import { useMemo, useState } from "react";
import { inspectHiddenCharacters, type TextLanguageContext } from "@/lib/engagement/hidden-character-inspection";

/** Keep the readable source separate from optional, local formatting diagnostics. */
export function EngagementTextInspection({ text, label, language, script }: { text: string; label: string } & TextLanguageContext) {
  const inspection = useMemo(() => inspectHiddenCharacters(text, { language, script }), [text, language, script]);
  const [expanded, setExpanded] = useState(false);
  const kinds = new Set(inspection.counts.map(entry => entry.kind));
  return <div className="min-w-0 space-y-2">
    <p className="text-xs font-medium">{label}</p>
    <p aria-label={`${label}, readable text`} lang={language ?? undefined} dir="auto" className="whitespace-pre-wrap break-words" style={{ unicodeBidi: "plaintext" }}>{inspection.original}</p>
    <details className="min-w-0 rounded border p-2 text-sm" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2">
        Inspect hidden characters in {label}: {inspection.total} {inspection.total === 1 ? "occurrence" : "occurrences"}
      </summary>
      {expanded ? <div className="mt-2 space-y-2">
        <p>Formatting observations do not determine intent or a moderation decision. This inspection does not establish prompt-injection resistance.</p>
        <p>Contribution language: {inspection.language ?? "not recorded in this view"}. Explicit script: {inspection.script ?? "not recorded in this view"}.</p>
        <p>Observed script letters: {inspection.observedScripts.join(", ") || "none from the inspected script set"}. Script does not identify a language.</p>
        {kinds.has("joining") ? <p>Joiners can preserve Arabic-script shaping, including Persian and Shahmukhi, and Indic forms, including Gurmukhi Punjabi, Hindi and Bengali. They also occur in emoji. Their presence alone is not a violation.</p> : null}
        {kinds.has("boundary") ? <p>Word and line boundaries can be intentional, including zero-width spacing in Thai, Myanmar and Khmer. No boundary character is removed.</p> : null}
        {kinds.has("direction") ? <p>Direction controls affect display order and can support bidirectional writing. Review their placement in context; the diagnostic shows their stored order.</p> : null}
        {kinds.has("tag") ? <p>Tag characters can carry text that is not visibly rendered. They also occur in emoji tag sequences; this inspection does not validate those sequences.</p> : null}
        {kinds.has("variation") ? <p>Variation selectors can request language-specific glyphs or emoji presentation. This inspection does not validate those sequences.</p> : null}
        {inspection.total === 0 ? <p>No characters from this inspection&apos;s coverage were found. This is not a content safety assessment.</p> : <ul className="space-y-1">
          {inspection.counts.map(entry => <li key={entry.codePoint} className="break-words"><code>{entry.codePoint}</code> {entry.name}: {entry.count}</li>)}
        </ul>}
        <p>Escaped inspection view. Markers use {"\\u{HEX}"}; literal backslashes appear doubled. Readable text above remains unchanged. Tabs and newlines remain readable.</p>
        <pre aria-label={`${label}, escaped inspection`} dir="ltr" className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs" style={{ unicodeBidi: "isolate" }}>{inspection.escaped}</pre>
      </div> : null}
    </details>
  </div>;
}
