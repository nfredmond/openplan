/**
 * Aerial mission imagery — storage naming, the per-file ceiling, and the EXIF
 * evidence reader.
 *
 * THE EXIF POSTURE, WHICH IS THE WHOLE POINT OF THE PARSER BEING HERE. Every
 * value this module extracts is EVIDENCE — what the photo's own bytes recorded
 * — and the honest answer for anything the file did not record is null, which
 * the UI then discloses ("no location recorded in this photo"). Nothing is
 * defaulted, estimated, or inferred:
 *
 *   * A capture time is stored only when the file names an actual INSTANT:
 *     DateTimeOriginal plus the OffsetTimeOriginal tag, or the GPS date/time
 *     stamps (UTC by the EXIF specification). A bare wall-clock time with no
 *     named zone is NOT an instant — interpreting it as UTC would silently
 *     misplace the capture by up to a day's worth of hours — so it yields null.
 *   * A location is a latitude AND a longitude, converted from the file's own
 *     degree/minute/second rationals. Half a coordinate, an out-of-range value,
 *     or a malformed tag yields null for BOTH (the table's gps_pair CHECK makes
 *     the half-coordinate state unstorable anyway).
 *   * Camera make/model are free text passed through as the file spelled them.
 *     They are data, not a registry — no vendor list exists to normalise
 *     against, on purpose.
 *
 * A file that is not a JPEG/TIFF, is truncated, or carries garbage tags parses
 * to all-nulls rather than throwing: at upload time "this photo told us
 * nothing" is a storable, disclosable outcome, not an error.
 */

export const AERIAL_IMAGERY_BUCKET = "aerial-imagery";

export const AERIAL_IMAGE_MAX_BYTES_ENV = "OPENPLAN_AERIAL_IMAGE_MAX_BYTES";

/**
 * 64 MiB per photo by default — comfortably above a 45–61 MP still (a Phase
 * One IQ4 frame is ~80 MB only as uncompressed raw; delivered JPEG/TIFF frames
 * from mapping drones run 8–40 MB). Deployments flying medium-format raw
 * raise the env var; the refusal names it. Kept equal to
 * BODY_LIMITS.aerialImageRaw (src/lib/http/body-limit.ts) so the documented
 * transport default and the domain default cannot drift apart — the upload
 * route streams against the RESOLVED ceiling, so raising the env raises the
 * enforced limit with it.
 */
export const DEFAULT_AERIAL_IMAGE_MAX_BYTES = 64 * 1024 * 1024;

export function resolveAerialImageMaxBytes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env[AERIAL_IMAGE_MAX_BYTES_ENV];
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_AERIAL_IMAGE_MAX_BYTES;
}

/**
 * Every column the table has, by name. The Supabase clients are untyped, so
 * this string is the only place a dropped column would surface — the route
 * test asserts on it directly and the migration test proves each name exists.
 */
export const AERIAL_IMAGERY_COLUMNS =
  "id, workspace_id, mission_id, storage_bucket, storage_path, original_filename, " +
  "byte_size, checksum_sha256, content_type, captured_at, gps_lat, gps_lon, " +
  "gps_altitude_m, camera_make, camera_model, uploaded_by, created_at, updated_at";

export type AerialImageryRow = {
  id: string;
  workspace_id: string;
  mission_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  byte_size: number;
  checksum_sha256: string;
  content_type: string | null;
  captured_at: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_altitude_m: number | string | null;
  camera_make: string | null;
  camera_model: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Object basename: the uploader's own filename, restricted to characters that
 * are safe in a storage key and a Content-Disposition header. Anything else
 * becomes `_`; a name that sanitises to nothing (or to dots alone) falls back
 * to "photo" so the path never ends in an empty or traversal-shaped segment.
 */
export function sanitizeImageryFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  const capped = cleaned.slice(0, 160);
  return capped && !/^\.+$/.test(capped) ? capped : "photo";
}

/** `<workspace_id>/<mission_id>/<imagery_id>/<sanitized-filename>` */
export function buildAerialImageryStoragePath(input: {
  workspaceId: string;
  missionId: string;
  imageryId: string;
  filename: string;
}): string {
  return `${input.workspaceId}/${input.missionId}/${input.imageryId}/${sanitizeImageryFilename(input.filename)}`;
}

export type SniffedImageFormat = {
  format: "jpeg" | "png" | "tiff";
  contentType: string;
};

/**
 * What the BYTES are, from their magic numbers — never the Content-Type
 * header, which cameras and transfer tools routinely mislabel. TIFF covers
 * DNG and most aerial raw containers. Returns null for anything else; the
 * upload route refuses those by naming what it saw, because a "photo" that no
 * photogrammetry pipeline can read is a mistake worth catching at the door.
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "jpeg", contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { format: "png", contentType: "image/png" };
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return { format: "tiff", contentType: "image/tiff" };
  }
  return null;
}

export type AerialImageExif = {
  /** ISO-8601 instant, only when the file named one (offset tag or GPS UTC stamps). */
  capturedAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAltitudeM: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
};

const EMPTY_EXIF: AerialImageExif = {
  capturedAt: null,
  gpsLat: null,
  gpsLon: null,
  gpsAltitudeM: null,
  cameraMake: null,
  cameraModel: null,
};

// TIFF field types this reader understands. Sizes in bytes per component.
const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL (two LONGs)
};

type IfdEntry = {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset (within the TIFF view) of the value bytes. */
  valueOffset: number;
};

class TiffReader {
  constructor(
    private readonly view: DataView,
    private readonly littleEndian: boolean
  ) {}

  u16(offset: number): number {
    return this.view.getUint16(offset, this.littleEndian);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, this.littleEndian);
  }

  inBounds(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset + length <= this.view.byteLength;
  }

  /** Parse one IFD into a tag map. Malformed entries are skipped, not fatal. */
  readIfd(ifdOffset: number): Map<number, IfdEntry> {
    const entries = new Map<number, IfdEntry>();
    if (!this.inBounds(ifdOffset, 2)) return entries;
    const count = this.u16(ifdOffset);
    for (let index = 0; index < count; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      if (!this.inBounds(entryOffset, 12)) break;
      const tag = this.u16(entryOffset);
      const type = this.u16(entryOffset + 2);
      const componentCount = this.u32(entryOffset + 4);
      const size = TYPE_SIZES[type];
      if (!size) continue;
      const byteLength = size * componentCount;
      // Values 4 bytes or smaller live inline in the entry; larger ones live
      // at the offset the entry's value field points to.
      const valueOffset = byteLength <= 4 ? entryOffset + 8 : this.u32(entryOffset + 8);
      if (!this.inBounds(valueOffset, byteLength)) continue;
      entries.set(tag, { tag, type, count: componentCount, valueOffset });
    }
    return entries;
  }

  ascii(entry: IfdEntry | undefined): string | null {
    if (!entry || entry.type !== 2 || entry.count < 1) return null;
    if (!this.inBounds(entry.valueOffset, entry.count)) return null;
    let text = "";
    for (let index = 0; index < entry.count; index += 1) {
      const code = this.view.getUint8(entry.valueOffset + index);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    const trimmed = text.trim();
    return trimmed || null;
  }

  rationals(entry: IfdEntry | undefined, expected: number): number[] | null {
    if (!entry || entry.type !== 5 || entry.count < expected) return null;
    const values: number[] = [];
    for (let index = 0; index < expected; index += 1) {
      const offset = entry.valueOffset + index * 8;
      if (!this.inBounds(offset, 8)) return null;
      const numerator = this.u32(offset);
      const denominator = this.u32(offset + 4);
      if (denominator === 0) return null;
      values.push(numerator / denominator);
    }
    return values;
  }

  byte(entry: IfdEntry | undefined): number | null {
    if (!entry || entry.type !== 1 || entry.count < 1) return null;
    if (!this.inBounds(entry.valueOffset, 1)) return null;
    return this.view.getUint8(entry.valueOffset);
  }

  long(entry: IfdEntry | undefined): number | null {
    if (!entry) return null;
    if (entry.type === 4 && entry.count >= 1) return this.u32(entry.valueOffset);
    if (entry.type === 3 && entry.count >= 1) return this.u16(entry.valueOffset);
    return null;
  }
}

// IFD0
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
// Exif IFD
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
// GPS IFD
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;
const TAG_GPS_ALT_REF = 0x0005;
const TAG_GPS_ALT = 0x0006;
const TAG_GPS_TIMESTAMP = 0x0007;
const TAG_GPS_DATESTAMP = 0x001d;

function dmsToDegrees(dms: number[] | null, ref: string | null): number | null {
  if (!dms || dms.length !== 3) return null;
  const [degrees, minutes, seconds] = dms;
  if (![degrees, minutes, seconds].every((part) => Number.isFinite(part))) return null;
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  const sign = ref === "S" || ref === "W" ? -1 : 1;
  const value = sign * magnitude;
  return Number.isFinite(value) ? value : null;
}

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, "0");
}

/** "YYYY:MM:DD HH:MM:SS" + "+HH:MM"/"-HH:MM"/"Z" -> ISO instant, or null. */
function instantFromDateTimeAndOffset(dateTime: string | null, offset: string | null): string | null {
  if (!dateTime || !offset) return null;
  const dateMatch = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateTime);
  const offsetMatch = /^(?:Z|[+-]\d{2}:\d{2})$/.exec(offset.trim());
  if (!dateMatch || !offsetMatch) return null;
  const [, year, month, day, hour, minute, second] = dateMatch;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetMatch[0]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** GPSDateStamp + GPSTimeStamp are UTC by the EXIF specification. */
function instantFromGpsStamps(dateStamp: string | null, timeStamp: number[] | null): string | null {
  if (!dateStamp || !timeStamp || timeStamp.length !== 3) return null;
  const dateMatch = /^(\d{4}):(\d{2}):(\d{2})$/.exec(dateStamp.trim());
  if (!dateMatch) return null;
  const [hours, minutes, seconds] = timeStamp;
  if (![hours, minutes, seconds].every((part) => Number.isFinite(part) && part >= 0)) return null;
  const iso = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function parseTiff(view: DataView): AerialImageExif {
  if (view.byteLength < 8) return EMPTY_EXIF;
  const order = view.getUint16(0, false);
  const littleEndian = order === 0x4949;
  if (!littleEndian && order !== 0x4d4d) return EMPTY_EXIF;
  const reader = new TiffReader(view, littleEndian);
  if (reader.u16(2) !== 42) return EMPTY_EXIF;

  const ifd0 = reader.readIfd(reader.u32(4));

  const cameraMake = reader.ascii(ifd0.get(TAG_MAKE));
  const cameraModel = reader.ascii(ifd0.get(TAG_MODEL));

  let capturedAt: string | null = null;
  const exifIfdOffset = reader.long(ifd0.get(TAG_EXIF_IFD));
  if (exifIfdOffset !== null) {
    const exifIfd = reader.readIfd(exifIfdOffset);
    capturedAt = instantFromDateTimeAndOffset(
      reader.ascii(exifIfd.get(TAG_DATETIME_ORIGINAL)),
      reader.ascii(exifIfd.get(TAG_OFFSET_TIME_ORIGINAL))
    );
  }

  let gpsLat: number | null = null;
  let gpsLon: number | null = null;
  let gpsAltitudeM: number | null = null;
  const gpsIfdOffset = reader.long(ifd0.get(TAG_GPS_IFD));
  if (gpsIfdOffset !== null) {
    const gpsIfd = reader.readIfd(gpsIfdOffset);
    const lat = dmsToDegrees(reader.rationals(gpsIfd.get(TAG_GPS_LAT), 3), reader.ascii(gpsIfd.get(TAG_GPS_LAT_REF)));
    const lon = dmsToDegrees(reader.rationals(gpsIfd.get(TAG_GPS_LON), 3), reader.ascii(gpsIfd.get(TAG_GPS_LON_REF)));
    // A location is BOTH halves, in range — anything less is null for both.
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      gpsLat = lat;
      gpsLon = lon;
    }
    const altitude = reader.rationals(gpsIfd.get(TAG_GPS_ALT), 1);
    if (altitude && Number.isFinite(altitude[0])) {
      gpsAltitudeM = reader.byte(gpsIfd.get(TAG_GPS_ALT_REF)) === 1 ? -altitude[0] : altitude[0];
    }
    if (capturedAt === null) {
      capturedAt = instantFromGpsStamps(
        reader.ascii(gpsIfd.get(TAG_GPS_DATESTAMP)),
        reader.rationals(gpsIfd.get(TAG_GPS_TIMESTAMP), 3)
      );
    }
  }

  return { capturedAt, gpsLat, gpsLon, gpsAltitudeM, cameraMake, cameraModel };
}

/** Walk the JPEG's segments to the APP1 "Exif" payload, which is a TIFF. */
function parseJpegExif(bytes: Uint8Array): AerialImageExif {
  let offset = 2; // past SOI
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return EMPTY_EXIF;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return EMPTY_EXIF; // image data / end: no EXIF found
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return EMPTY_EXIF;
    if (marker === 0xe1 && segmentLength >= 8) {
      const payloadStart = offset + 4;
      const header = String.fromCharCode(...bytes.subarray(payloadStart, payloadStart + 6));
      if (header === "Exif\0\0") {
        const tiffStart = payloadStart + 6;
        const tiffLength = segmentLength - 2 - 6;
        if (tiffLength > 0 && tiffStart + tiffLength <= bytes.length) {
          return parseTiff(new DataView(bytes.buffer, bytes.byteOffset + tiffStart, tiffLength));
        }
        return EMPTY_EXIF;
      }
    }
    offset += 2 + segmentLength;
  }
  return EMPTY_EXIF;
}

/**
 * EXIF evidence from a photo's bytes. All-nulls for a format with no EXIF
 * (PNG), a file that recorded nothing, or bytes too damaged to read — absence
 * and unreadability are both, honestly, "the file told us nothing".
 */
export function extractAerialImageExif(bytes: Uint8Array): AerialImageExif {
  try {
    const sniffed = sniffImageFormat(bytes);
    if (sniffed?.format === "jpeg") return parseJpegExif(bytes);
    if (sniffed?.format === "tiff") {
      return parseTiff(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    }
    return EMPTY_EXIF;
  } catch {
    return EMPTY_EXIF;
  }
}
