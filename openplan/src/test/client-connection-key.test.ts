import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { buildPublicSubmissionClientFingerprint } from "@/lib/engagement/public-submit";
import { clientConnectionKey, normalizeClientConnectionAddress } from "@/lib/http/client-connection";

/**
 * KI-2026-10-12-011/012/013 and roadmap M9a: ONE IPv6 HOST IS ONE CONNECTION.
 *
 * Every public per-connection limit counts against this key. An IPv6 host that
 * picks a new address inside its /64 for each request used to get a fresh set
 * of limits each time. IPv4 must come out exactly as it went in, because the
 * counts already stored for it are keyed on its hash.
 */

const request = (headers: Record<string, string>) => new NextRequest("http://localhost/", { headers });

describe("an IPv4 address", () => {
  it("is kept exactly as it arrived", () => {
    for (const address of ["203.0.113.9", "198.51.100.7", "0.0.0.0", "255.255.255.255", "10.0.0.1"]) {
      expect(normalizeClientConnectionAddress(address)).toBe(address);
    }
  });

  it("hashes to the same fingerprint as before IPv6 grouping", () => {
    // Pinned values: sha256("ip|203.0.113.9") and sha256("ip|unknown"), first 24 hex.
    expect(buildPublicSubmissionClientFingerprint(request({ "x-forwarded-for": "203.0.113.9" }))).toBe("c7e2e9770918c0011e7b8a1c");
    expect(buildPublicSubmissionClientFingerprint(request({}))).toBe("2d20b39d56a4158a5e420f82");
    expect(buildPublicSubmissionClientFingerprint(request({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe(
      createHash("sha256").update("ip|198.51.100.7").digest("hex").slice(0, 24)
    );
  });

  it("loses a port", () => {
    expect(normalizeClientConnectionAddress("203.0.113.9:51234")).toBe("203.0.113.9");
  });

  it("is the same host when written as IPv4-mapped IPv6", () => {
    expect(normalizeClientConnectionAddress("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeClientConnectionAddress("::FFFF:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeClientConnectionAddress("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(normalizeClientConnectionAddress("0:0:0:0:0:ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeClientConnectionAddress("[::ffff:203.0.113.9]:443")).toBe("203.0.113.9");
  });
});

describe("an IPv6 address", () => {
  it("is named by its /64, however it is written", () => {
    const forms = [
      "2001:db8:1:2::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2:0:0:0:1",
      "2001:db8:1:2:abcd:ef01:2345:6789",
      "2001:db8:1:2::203.0.113.9",
      "[2001:db8:1:2::1]",
      "[2001:db8:1:2::1]:8443",
      "2001:db8:1:2::1%eth0",
      "[2001:db8:1:2::1%25en0]:443",
      "  2001:db8:1:2::1  ",
    ];
    for (const form of forms) expect(normalizeClientConnectionAddress(form)).toBe("2001:db8:1:2::/64");
  });

  it("keeps zero groups in the prefix and compresses nothing", () => {
    expect(normalizeClientConnectionAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeClientConnectionAddress("::1")).toBe("0:0:0:0::/64");
    expect(normalizeClientConnectionAddress("::")).toBe("0:0:0:0::/64");
    expect(normalizeClientConnectionAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normalizeClientConnectionAddress("2001:db8:ffff:ffff::")).toBe("2001:db8:ffff:ffff::/64");
  });

  it("in a different /64 is a different connection", () => {
    expect(normalizeClientConnectionAddress("2001:db8:1:3::1")).not.toBe(normalizeClientConnectionAddress("2001:db8:1:2::1"));
    expect(normalizeClientConnectionAddress("2001:db8:1:2::1")).not.toBe(normalizeClientConnectionAddress("2001:db9:1:2::1"));
  });
});

describe("text that is not an address", () => {
  it("is the one unknown connection, like a missing header", () => {
    const garbage = [
      "",
      "   ",
      "not-an-ip",
      "unknown",
      "999.1.1.1",
      "01.2.3.4",
      "1.2.3",
      "1::2::3",
      "1:2:3:4:5:6:7:8:9",
      "2001:db8::g",
      "[2001:db8::1",
      "[2001:db8::1]x",
      "[2001:db8::1]:port",
      "203.0.113.9:99999999",
      "::ffff:999.1.1.1",
    ];
    for (const value of garbage) expect(normalizeClientConnectionAddress(value)).toBe("unknown");
    expect(normalizeClientConnectionAddress(null)).toBe("unknown");
    expect(normalizeClientConnectionAddress(undefined)).toBe("unknown");
  });
});

describe("the believed header", () => {
  it("is the first present of x-forwarded-for, x-real-ip and cf-connecting-ip, leftmost entry only", () => {
    expect(clientConnectionKey(request({ "x-forwarded-for": "2001:db8:1:2::9, 203.0.113.1", "x-real-ip": "198.51.100.1" }))).toBe(
      "2001:db8:1:2::/64"
    );
    expect(clientConnectionKey(request({ "x-real-ip": "198.51.100.1", "cf-connecting-ip": "203.0.113.1" }))).toBe("198.51.100.1");
    expect(clientConnectionKey(request({ "cf-connecting-ip": "2001:db8:5:6::1" }))).toBe("2001:db8:5:6::/64");
    expect(clientConnectionKey(request({}))).toBe("unknown");
  });

  it("is not passed over for a later header when its own entry is garbage", () => {
    expect(clientConnectionKey(request({ "x-forwarded-for": "garbage", "x-real-ip": "198.51.100.1" }))).toBe("unknown");
  });
});

describe("the connection fingerprint", () => {
  const fingerprint = (address: string) => buildPublicSubmissionClientFingerprint(request({ "x-forwarded-for": address }));

  it("is shared by two addresses in one /64", () => {
    expect(fingerprint("2001:db8:1:2::1")).toBe(fingerprint("2001:db8:1:2:dead:beef:0:7"));
    expect(fingerprint("2001:db8:1:2::1")).toBe(createHash("sha256").update("ip|2001:db8:1:2::/64").digest("hex").slice(0, 24));
  });

  it("differs between /64s and between IPv4 hosts", () => {
    expect(fingerprint("2001:db8:1:2::1")).not.toBe(fingerprint("2001:db8:1:3::1"));
    expect(fingerprint("203.0.113.9")).not.toBe(fingerprint("203.0.113.10"));
  });
});
