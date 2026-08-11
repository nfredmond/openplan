/**
 * Synthetic EXIF fixtures for the aerial imagery tests.
 *
 * Builds real TIFF byte structures (header, IFDs, overflow value area) and
 * wraps them in a minimal JPEG APP1 segment, so the parser under test walks
 * the same encoding a camera writes — both endiannesses included — without a
 * binary fixture file checked into the repo.
 */

type AsciiTag = { tag: number; type: 2; ascii: string };
type RationalTag = { tag: number; type: 5; rationals: Array<[number, number]> };
type LongTag = { tag: number; type: 4; long: number };
type ByteTag = { tag: number; type: 1; bytes: number[] };
export type TiffTag = AsciiTag | RationalTag | LongTag | ByteTag;

function valueLength(tag: TiffTag): number {
  switch (tag.type) {
    case 2:
      return tag.ascii.length + 1; // trailing NUL
    case 5:
      return tag.rationals.length * 8;
    case 4:
      return 4;
    case 1:
      return tag.bytes.length;
  }
}

function componentCount(tag: TiffTag): number {
  switch (tag.type) {
    case 2:
      return tag.ascii.length + 1;
    case 5:
      return tag.rationals.length;
    case 4:
      return 1;
    case 1:
      return tag.bytes.length;
  }
}

function ifdByteLength(tags: TiffTag[]): number {
  const overflow = tags.reduce((sum, tag) => {
    const length = valueLength(tag);
    return sum + (length > 4 ? length : 0);
  }, 0);
  return 2 + tags.length * 12 + 4 + overflow;
}

function writeValue(view: DataView, at: number, tag: TiffTag, littleEndian: boolean): void {
  if (tag.type === 2) {
    for (let index = 0; index < tag.ascii.length; index += 1) {
      view.setUint8(at + index, tag.ascii.charCodeAt(index));
    }
    view.setUint8(at + tag.ascii.length, 0);
    return;
  }
  if (tag.type === 5) {
    tag.rationals.forEach(([numerator, denominator], index) => {
      view.setUint32(at + index * 8, numerator, littleEndian);
      view.setUint32(at + index * 8 + 4, denominator, littleEndian);
    });
    return;
  }
  if (tag.type === 4) {
    view.setUint32(at, tag.long, littleEndian);
    return;
  }
  tag.bytes.forEach((byte, index) => view.setUint8(at + index, byte));
}

/** Encode one IFD at absolute offset `ifdStart` within the TIFF. */
function encodeIfd(tags: TiffTag[], ifdStart: number, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(ifdByteLength(tags));
  const view = new DataView(out.buffer);
  view.setUint16(0, tags.length, littleEndian);
  let overflowAt = 2 + tags.length * 12 + 4;
  tags.forEach((tag, index) => {
    const entryAt = 2 + index * 12;
    view.setUint16(entryAt, tag.tag, littleEndian);
    view.setUint16(entryAt + 2, tag.type, littleEndian);
    view.setUint32(entryAt + 4, componentCount(tag), littleEndian);
    const length = valueLength(tag);
    if (length <= 4) {
      writeValue(view, entryAt + 8, tag, littleEndian);
    } else {
      view.setUint32(entryAt + 8, ifdStart + overflowAt, littleEndian);
      writeValue(view, overflowAt, tag, littleEndian);
      overflowAt += length;
    }
  });
  // next-IFD pointer stays zero.
  return out;
}

export type ExifFixtureInput = {
  littleEndian?: boolean;
  make?: string;
  model?: string;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  gps?: {
    latDms: Array<[number, number]>; // three rationals
    latRef: "N" | "S";
    lonDms: Array<[number, number]>;
    lonRef: "E" | "W";
    altitude?: [number, number];
    altitudeBelowSeaLevel?: boolean;
    dateStamp?: string; // "YYYY:MM:DD"
    timeStamp?: Array<[number, number]>; // three rationals, UTC
  };
  /** Drop the longitude tags to simulate a half coordinate. */
  omitLongitude?: boolean;
};

/** A TIFF (valid on its own — also the payload of the JPEG APP1 wrapper). */
export function buildTiff(input: ExifFixtureInput = {}): Uint8Array {
  const littleEndian = input.littleEndian ?? true;

  const exifTags: TiffTag[] = [];
  if (input.dateTimeOriginal) exifTags.push({ tag: 0x9003, type: 2, ascii: input.dateTimeOriginal });
  if (input.offsetTimeOriginal) exifTags.push({ tag: 0x9011, type: 2, ascii: input.offsetTimeOriginal });

  const gpsTags: TiffTag[] = [];
  if (input.gps) {
    gpsTags.push({ tag: 0x0001, type: 2, ascii: input.gps.latRef });
    gpsTags.push({ tag: 0x0002, type: 5, rationals: input.gps.latDms });
    if (!input.omitLongitude) {
      gpsTags.push({ tag: 0x0003, type: 2, ascii: input.gps.lonRef });
      gpsTags.push({ tag: 0x0004, type: 5, rationals: input.gps.lonDms });
    }
    if (input.gps.altitude) {
      gpsTags.push({ tag: 0x0005, type: 1, bytes: [input.gps.altitudeBelowSeaLevel ? 1 : 0] });
      gpsTags.push({ tag: 0x0006, type: 5, rationals: [input.gps.altitude] });
    }
    if (input.gps.dateStamp && input.gps.timeStamp) {
      gpsTags.push({ tag: 0x0007, type: 5, rationals: input.gps.timeStamp });
      gpsTags.push({ tag: 0x001d, type: 2, ascii: input.gps.dateStamp });
    }
  }

  const ifd0Tags: TiffTag[] = [];
  if (input.make) ifd0Tags.push({ tag: 0x010f, type: 2, ascii: input.make });
  if (input.model) ifd0Tags.push({ tag: 0x0110, type: 2, ascii: input.model });
  // Pointer values are filled in below once the layout is known.
  if (exifTags.length > 0) ifd0Tags.push({ tag: 0x8769, type: 4, long: 0 });
  if (gpsTags.length > 0) ifd0Tags.push({ tag: 0x8825, type: 4, long: 0 });

  const ifd0Start = 8;
  const exifStart = ifd0Start + ifdByteLength(ifd0Tags);
  const gpsStart = exifStart + (exifTags.length > 0 ? ifdByteLength(exifTags) : 0);

  for (const tag of ifd0Tags) {
    if (tag.type === 4 && tag.tag === 0x8769) tag.long = exifStart;
    if (tag.type === 4 && tag.tag === 0x8825) tag.long = gpsStart;
  }

  const totalLength = gpsStart + (gpsTags.length > 0 ? ifdByteLength(gpsTags) : 0);
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, littleEndian ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, ifd0Start, littleEndian);

  out.set(encodeIfd(ifd0Tags, ifd0Start, littleEndian), ifd0Start);
  if (exifTags.length > 0) out.set(encodeIfd(exifTags, exifStart, littleEndian), exifStart);
  if (gpsTags.length > 0) out.set(encodeIfd(gpsTags, gpsStart, littleEndian), gpsStart);
  return out;
}

/** The TIFF wrapped in a JPEG SOI + APP1 "Exif" segment + EOI. */
export function buildJpegWithExif(input: ExifFixtureInput = {}): Uint8Array {
  const tiff = buildTiff(input);
  const header = "Exif\0\0";
  const segmentLength = 2 + header.length + tiff.length;
  const out = new Uint8Array(2 + 2 + segmentLength + 2);
  let at = 0;
  out[at++] = 0xff;
  out[at++] = 0xd8; // SOI
  out[at++] = 0xff;
  out[at++] = 0xe1; // APP1
  out[at++] = (segmentLength >> 8) & 0xff;
  out[at++] = segmentLength & 0xff;
  for (let index = 0; index < header.length; index += 1) out[at++] = header.charCodeAt(index);
  out.set(tiff, at);
  at += tiff.length;
  out[at++] = 0xff;
  out[at++] = 0xd9; // EOI
  return out;
}

/** A JPEG with no APP1 at all — a camera that wrote nothing. */
export function buildBareJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}
