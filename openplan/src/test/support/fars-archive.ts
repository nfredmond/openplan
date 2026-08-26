import JSZip from "jszip";

const HEADERS = [
  "STATE",
  "ST_CASE",
  "PEDS",
  "YEAR",
  "LATITUDE",
  "LONGITUD",
  "FATALS",
] as const;

export type FarsArchiveRow = Partial<Record<(typeof HEADERS)[number], string | number>>;

export async function farsArchiveResponse(rows: FarsArchiveRow[]): Promise<Response> {
  const csv = [HEADERS.join(","), ...rows.map((row) => HEADERS.map((key) => row[key] ?? "").join(","))].join(
    "\n"
  );
  const archive = new JSZip();
  archive.file("FARS2024NationalCSV/accident.csv", csv);
  const bytes = await archive.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  return new Response(bytes, { status: 200, headers: { "content-type": "application/zip" } });
}
