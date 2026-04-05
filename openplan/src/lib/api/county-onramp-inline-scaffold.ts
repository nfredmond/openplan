import { countyOnrampManifestSchema, type CountyOnrampManifest } from "@/lib/models/county-onramp";

export function getCountyInlineScaffoldCsvContent(manifest: CountyOnrampManifest | null | undefined): string | null {
  const scaffold = manifest?.summary?.scaffold;
  if (!scaffold) {
    return null;
  }

  const candidate = (scaffold as Record<string, unknown>).inline_csv_content;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export function withCountyInlineScaffoldCsvContent(
  manifest: CountyOnrampManifest,
  csvContent: string | null | undefined
): CountyOnrampManifest {
  const scaffold = manifest.summary.scaffold;
  if (!scaffold) {
    return manifest;
  }

  const nextScaffold = { ...(scaffold as Record<string, unknown>) };
  if (typeof csvContent === "string" && csvContent.length > 0) {
    nextScaffold.inline_csv_content = csvContent;
  } else {
    delete nextScaffold.inline_csv_content;
  }

  return countyOnrampManifestSchema.parse({
    ...manifest,
    summary: {
      ...manifest.summary,
      scaffold: nextScaffold,
    },
  });
}

export function preserveCountyInlineScaffoldCsvContent(
  existingManifest: CountyOnrampManifest | null | undefined,
  nextManifest: CountyOnrampManifest
): CountyOnrampManifest {
  const nextInlineCsv = getCountyInlineScaffoldCsvContent(nextManifest);
  if (nextInlineCsv) {
    return nextManifest;
  }

  const existingInlineCsv = getCountyInlineScaffoldCsvContent(existingManifest);
  if (!existingInlineCsv) {
    return nextManifest;
  }

  if (!existingManifest || existingManifest.artifacts.scaffold_csv !== nextManifest.artifacts.scaffold_csv) {
    return nextManifest;
  }

  return withCountyInlineScaffoldCsvContent(nextManifest, existingInlineCsv);
}
