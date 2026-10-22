import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { signedStorageRedirect } from "@/lib/http/signed-redirect";
import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * A redirect to a signed Storage URL carries a bearer link to private content
 * for 5 to 15 minutes. Independent review L-4 (2026-10-11) found the model and
 * report download redirects sent no Cache-Control, so a browser or shared
 * cache could keep the link. Every route that signs a Storage URL and
 * redirects to it must go through `signedStorageRedirect`, which sets
 * `private, no-store`.
 *
 * Blind category: a route that redirects with a hand-built 30x `Response` and
 * a `Location` header, rather than `NextResponse.redirect`, is not detected.
 */

const APP = path.join(process.cwd(), "src", "app");
const SIGNS_STORAGE_URL = /createSignedUrl|signedMapPackageDownload/;
const BARE_REDIRECT = /\b(?:NextResponse|Response)\.redirect\(/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("signed Storage redirects are not cached", () => {
  it("sets Cache-Control: private, no-store on the redirect", () => {
    const response = signedStorageRedirect("https://storage.example/object/sign/bucket/file.pdf?token=abc");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://storage.example/object/sign/bucket/file.pdf?token=abc");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("finds no route that signs a Storage URL and redirects without the helper", () => {
    const signing = routeFiles(APP)
      .map((file) => ({ file, source: stripSourceComments(readFileSync(file, "utf8")) }))
      .filter(({ source }) => SIGNS_STORAGE_URL.test(source));
    // Seven download routes sign and redirect today; an empty scan would pass
    // for the wrong reason.
    expect(signing.filter(({ source }) => source.includes("signedStorageRedirect(")).length).toBeGreaterThanOrEqual(7);

    const offenders = signing
      .filter(({ source }) => BARE_REDIRECT.test(source))
      .map(({ file }) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});
