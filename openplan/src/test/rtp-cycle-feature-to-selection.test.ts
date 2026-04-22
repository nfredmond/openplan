import { describe, expect, it, vi } from "vitest";

import {
  isRtpCycleFeatureProperties,
  rtpCycleFeatureToSelection,
} from "@/lib/cartographic/rtp-cycle-feature-to-selection";

const validProps = {
  kind: "rtp_cycle" as const,
  rtpCycleId: "d0000001-0000-4000-8000-000000000004",
  title: "NCTC 2045 RTP — demo cycle",
  status: "draft",
  geographyLabel: "Nevada County, CA (FIPS 06057)",
  horizonStartYear: 2026,
  horizonEndYear: 2045,
};

describe("isRtpCycleFeatureProperties", () => {
  it("accepts a well-formed rtp-cycle feature payload", () => {
    expect(isRtpCycleFeatureProperties(validProps)).toBe(true);
  });

  it("accepts a payload with null geographyLabel", () => {
    expect(
      isRtpCycleFeatureProperties({ ...validProps, geographyLabel: null }),
    ).toBe(true);
  });

  it("accepts a payload with null horizon years", () => {
    expect(
      isRtpCycleFeatureProperties({
        ...validProps,
        horizonStartYear: null,
        horizonEndYear: null,
      }),
    ).toBe(true);
  });

  it("rejects a payload missing rtpCycleId", () => {
    const { rtpCycleId: _omit, ...rest } = validProps;
    expect(isRtpCycleFeatureProperties(rest)).toBe(false);
  });

  it("rejects a payload with a blank rtpCycleId", () => {
    expect(
      isRtpCycleFeatureProperties({ ...validProps, rtpCycleId: "" }),
    ).toBe(false);
  });

  it("rejects a payload whose kind is not rtp_cycle", () => {
    expect(
      isRtpCycleFeatureProperties({ ...validProps, kind: "project" }),
    ).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isRtpCycleFeatureProperties(null)).toBe(false);
    expect(isRtpCycleFeatureProperties("rtp_cycle")).toBe(false);
    expect(isRtpCycleFeatureProperties(undefined)).toBe(false);
  });
});

describe("rtpCycleFeatureToSelection", () => {
  it("returns null when the payload fails the type guard", () => {
    const navigate = vi.fn();
    expect(
      rtpCycleFeatureToSelection({ kind: "unknown" }, { navigate }),
    ).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("maps valid properties to an RTP inspector selection", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(validProps, { navigate });
    expect(selection).not.toBeNull();
    expect(selection!.kind).toBe("rtp");
    expect(selection!.title).toBe("NCTC 2045 RTP — demo cycle");
    expect(selection!.kicker).toBe("RTP cycle");
    expect(selection!.avatarChar).toBe("R");
    expect(selection!.meta).toEqual([
      { label: "status", value: "draft" },
      { label: "geography", value: "Nevada County, CA (FIPS 06057)" },
      { label: "horizon", value: "2026–2045" },
    ]);
  });

  it("primary action navigates to the RTP cycle detail page", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(validProps, { navigate });
    selection!.primaryAction!.onClick();
    expect(navigate).toHaveBeenCalledWith(
      "/rtp/d0000001-0000-4000-8000-000000000004",
    );
  });

  it("omits the geography meta row when geographyLabel is null", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(
      { ...validProps, geographyLabel: null },
      { navigate },
    );
    expect(selection!.meta).toEqual([
      { label: "status", value: "draft" },
      { label: "horizon", value: "2026–2045" },
    ]);
  });

  it("omits the horizon meta row when either year is null", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(
      { ...validProps, horizonEndYear: null },
      { navigate },
    );
    expect(selection!.meta).toEqual([
      { label: "status", value: "draft" },
      { label: "geography", value: "Nevada County, CA (FIPS 06057)" },
    ]);
  });

  it("falls back to a generic title when the incoming title is blank", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(
      { ...validProps, title: "   " },
      { navigate },
    );
    expect(selection!.title).toBe("Untitled RTP cycle");
  });

  it("omits featureRef when no sourceId is supplied", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(validProps, { navigate });
    expect(selection!.featureRef).toBeUndefined();
  });

  it("populates featureRef with the injected sourceId and rtpCycleId", () => {
    const navigate = vi.fn();
    const selection = rtpCycleFeatureToSelection(validProps, {
      navigate,
      sourceId: "cartographic-rtp-cycles",
    });
    expect(selection!.featureRef).toEqual({
      sourceId: "cartographic-rtp-cycles",
      featureId: validProps.rtpCycleId,
    });
  });
});
