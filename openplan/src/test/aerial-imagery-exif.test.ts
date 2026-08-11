import { describe, expect, it } from "vitest";

import {
  AERIAL_IMAGE_MAX_BYTES_ENV,
  DEFAULT_AERIAL_IMAGE_MAX_BYTES,
  buildAerialImageryStoragePath,
  extractAerialImageExif,
  resolveAerialImageMaxBytes,
  sanitizeImageryFilename,
  sniffImageFormat,
} from "@/lib/aerial/imagery";
import { buildBareJpeg, buildJpegWithExif, buildTiff } from "./helpers/exif-fixture";

/**
 * The EXIF reader is an EVIDENCE reader: everything it returns must be what
 * the file's own bytes recorded, and everything the file did not record must
 * come back null — never defaulted, never inferred. The fixtures are real TIFF
 * structures built byte-by-byte (src/test/helpers/exif-fixture.ts), so these
 * tests exercise the same encoding a camera writes, in both byte orders.
 *
 * Coordinates in the fixtures are synthetic (12°30'N, 45°15'E and friends) —
 * nothing here names a place, per the no-hardcoding rule.
 */

// 12°30'0" -> 12.5; 45°15'0" -> 45.25.
const LAT_DMS: Array<[number, number]> = [
  [12, 1],
  [30, 1],
  [0, 1],
];
const LON_DMS: Array<[number, number]> = [
  [45, 1],
  [15, 1],
  [0, 1],
];

describe("extractAerialImageExif", () => {
  it("reads make, model, GPS and an offset-qualified capture instant from a little-endian JPEG", () => {
    const exif = extractAerialImageExif(
      buildJpegWithExif({
        littleEndian: true,
        make: "ExampleMaker",
        model: "ExampleModel 3",
        dateTimeOriginal: "2026:06:01 14:30:00",
        offsetTimeOriginal: "-07:00",
        gps: { latDms: LAT_DMS, latRef: "N", lonDms: LON_DMS, lonRef: "E", altitude: [1234, 10] },
      })
    );

    expect(exif.cameraMake).toBe("ExampleMaker");
    expect(exif.cameraModel).toBe("ExampleModel 3");
    expect(exif.capturedAt).toBe("2026-06-01T14:30:00-07:00");
    expect(exif.gpsLat).toBeCloseTo(12.5, 10);
    expect(exif.gpsLon).toBeCloseTo(45.25, 10);
    expect(exif.gpsAltitudeM).toBeCloseTo(123.4, 10);
  });

  it("reads the same fixture in big-endian byte order", () => {
    const exif = extractAerialImageExif(
      buildJpegWithExif({
        littleEndian: false,
        make: "ExampleMaker",
        dateTimeOriginal: "2026:06:01 14:30:00",
        offsetTimeOriginal: "+02:00",
        gps: { latDms: LAT_DMS, latRef: "N", lonDms: LON_DMS, lonRef: "E" },
      })
    );

    expect(exif.cameraMake).toBe("ExampleMaker");
    expect(exif.capturedAt).toBe("2026-06-01T14:30:00+02:00");
    expect(exif.gpsLat).toBeCloseTo(12.5, 10);
    expect(exif.gpsLon).toBeCloseTo(45.25, 10);
  });

  it("signs south and west references negative, and a below-sea-level altitude negative", () => {
    const exif = extractAerialImageExif(
      buildJpegWithExif({
        gps: {
          latDms: LAT_DMS,
          latRef: "S",
          lonDms: LON_DMS,
          lonRef: "W",
          altitude: [55, 10],
          altitudeBelowSeaLevel: true,
        },
      })
    );

    expect(exif.gpsLat).toBeCloseTo(-12.5, 10);
    expect(exif.gpsLon).toBeCloseTo(-45.25, 10);
    expect(exif.gpsAltitudeM).toBeCloseTo(-5.5, 10);
  });

  it("nulls the capture time when the file names no timezone — a wall clock is not an instant", () => {
    const exif = extractAerialImageExif(
      buildJpegWithExif({
        dateTimeOriginal: "2026:06:01 14:30:00",
        // no offsetTimeOriginal, no GPS stamps
      })
    );
    expect(exif.capturedAt).toBeNull();
  });

  it("falls back to the GPS date/time stamps, which the EXIF spec defines as UTC", () => {
    const exif = extractAerialImageExif(
      buildJpegWithExif({
        dateTimeOriginal: "2026:06:01 14:30:00",
        gps: {
          latDms: LAT_DMS,
          latRef: "N",
          lonDms: LON_DMS,
          lonRef: "E",
          dateStamp: "2026:06:01",
          timeStamp: [
            [21, 1],
            [30, 1],
            [5, 1],
          ],
        },
      })
    );
    expect(exif.capturedAt).toBe("2026-06-01T21:30:05Z");
  });

  it("nulls BOTH coordinates when the file recorded only half of one", () => {
    const exif = extractAerialImageExif(
      buildJpegWithExif({
        gps: { latDms: LAT_DMS, latRef: "N", lonDms: LON_DMS, lonRef: "E" },
        omitLongitude: true,
      })
    );
    expect(exif.gpsLat).toBeNull();
    expect(exif.gpsLon).toBeNull();
  });

  it("answers all-nulls for a JPEG with no EXIF at all", () => {
    expect(extractAerialImageExif(buildBareJpeg())).toEqual({
      capturedAt: null,
      gpsLat: null,
      gpsLon: null,
      gpsAltitudeM: null,
      cameraMake: null,
      cameraModel: null,
    });
  });

  it("reads a bare TIFF directly — the DNG/raw container case", () => {
    const exif = extractAerialImageExif(
      buildTiff({ make: "ExampleMaker", gps: { latDms: LAT_DMS, latRef: "N", lonDms: LON_DMS, lonRef: "E" } })
    );
    expect(exif.cameraMake).toBe("ExampleMaker");
    expect(exif.gpsLat).toBeCloseTo(12.5, 10);
  });

  it("never throws on truncated or garbage bytes — unreadable is 'the file told us nothing'", () => {
    const truncated = buildJpegWithExif({ make: "ExampleMaker" }).slice(0, 9);
    expect(extractAerialImageExif(truncated).cameraMake).toBeNull();
    expect(extractAerialImageExif(new Uint8Array([1, 2, 3])).cameraMake).toBeNull();
    expect(extractAerialImageExif(new Uint8Array(0)).cameraMake).toBeNull();
    // A structurally valid JPEG whose APP1 length lies about the buffer.
    const lying = buildJpegWithExif({ make: "ExampleMaker" });
    lying[4] = 0xff;
    lying[5] = 0xff;
    expect(extractAerialImageExif(lying).cameraMake).toBeNull();
  });
});

describe("sniffImageFormat", () => {
  it("recognises the three photogrammetry-readable formats from their magic bytes", () => {
    expect(sniffImageFormat(buildBareJpeg())).toEqual({ format: "jpeg", contentType: "image/jpeg" });
    expect(
      sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))
    ).toEqual({ format: "png", contentType: "image/png" });
    expect(sniffImageFormat(buildTiff({ make: "X" }))).toEqual({ format: "tiff", contentType: "image/tiff" });
    expect(sniffImageFormat(buildTiff({ make: "X", littleEndian: false }))).toEqual({
      format: "tiff",
      contentType: "image/tiff",
    });
  });

  it("refuses everything else with null, whatever the header claimed", () => {
    expect(sniffImageFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // a zip
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
  });
});

describe("storage naming", () => {
  it("keeps a clean filename and strips traversal shapes", () => {
    expect(sanitizeImageryFilename("DJI_0421.JPG")).toBe("DJI_0421.JPG");
    expect(sanitizeImageryFilename("../..\\evil name?.jpg")).toBe("evil_name_.jpg");
    // Leading dots are stripped, not just traversal: a stored "..name" path
    // would trip the download route's `..` refusal and become undownloadable.
    expect(sanitizeImageryFilename("..secret.jpg")).toBe("secret.jpg");
    expect(sanitizeImageryFilename("...")).toBe("photo");
    expect(sanitizeImageryFilename("")).toBe("photo");
  });

  it("builds the pinned path shape: workspace/mission/imagery/filename", () => {
    expect(
      buildAerialImageryStoragePath({
        workspaceId: "ws",
        missionId: "m",
        imageryId: "i",
        filename: "frame 1.jpg",
      })
    ).toBe("ws/m/i/frame_1.jpg");
  });
});

describe("resolveAerialImageMaxBytes", () => {
  it("defaults when unset and honours a positive integer override", () => {
    expect(resolveAerialImageMaxBytes({})).toBe(DEFAULT_AERIAL_IMAGE_MAX_BYTES);
    expect(resolveAerialImageMaxBytes({ [AERIAL_IMAGE_MAX_BYTES_ENV]: "134217728" })).toBe(134217728);
  });

  it("falls back to the default on nonsense rather than disabling the ceiling", () => {
    for (const bad of ["", "  ", "abc", "-5", "0", "1.5", "Infinity"]) {
      expect(resolveAerialImageMaxBytes({ [AERIAL_IMAGE_MAX_BYTES_ENV]: bad })).toBe(
        DEFAULT_AERIAL_IMAGE_MAX_BYTES
      );
    }
  });
});
