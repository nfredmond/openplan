/**
 * The browser token that tells people on one connection apart (2026-10-11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PARTICIPANT_DEVICE_HEADER,
  PARTICIPANT_DEVICE_ID_PATTERN,
  participantDeviceHeaders,
  participantDeviceId,
} from "@/lib/engagement/participant-device";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("a browser's participation token", () => {
  it("is created once and then reused, so one browser stays one device", () => {
    const first = participantDeviceId();
    expect(first).toMatch(PARTICIPANT_DEVICE_ID_PATTERN);
    expect(participantDeviceId()).toBe(first);
    expect(participantDeviceHeaders()).toEqual({ [PARTICIPANT_DEVICE_HEADER]: first });
  });

  it("replaces a value that is not a token", () => {
    window.localStorage.setItem("openplan:participant-device", "hand-edited");
    expect(participantDeviceId()).toMatch(PARTICIPANT_DEVICE_ID_PATTERN);
  });

  it("sends nothing when storage is unavailable, leaving the connection as the device", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(participantDeviceId()).toBeNull();
    expect(participantDeviceHeaders()).toEqual({});
  });
});
