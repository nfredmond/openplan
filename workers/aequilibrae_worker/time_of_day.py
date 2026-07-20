#!/usr/bin/env python3
"""Documented diurnal factors for screening-grade peak-hour derivation.

The observed-count validation reports GEH on an average-hourly basis (daily/24).
The customary GEH < 5 acceptance rule, though, is a PEAK-HOUR statistic. This
module applies a published-style K-factor (peak-hour volume as a share of daily
AADT) so the validation can also report peak-hour GEH, plus a coarse AM/midday/
PM/off-peak split.

These are GENERIC screening assumptions, NOT calibrated local factors: a lead
agency doing a real determination substitutes local count/temporal data. Peak-
hour GEH is reported so the screening figure is on the customary basis, not to
claim a calibrated peak-hour forecast. Stdlib-only, unit-testable.
"""
from __future__ import annotations

# Design-hour K-factor: peak-hour volume as a share of daily AADT. 0.09 is a
# generic mid-range screening value; real K is ~0.08-0.12 and varies by facility
# and urban/rural context (higher on rural/recreational routes).
DEFAULT_PEAK_HOUR_FACTOR = 0.09

# Coarse diurnal shares of daily volume (fractions summing to 1.0) — a generic
# screening profile for a multi-period breakdown, NOT a calibrated local curve.
PERIOD_SHARES: dict[str, float] = {
    "am_peak": 0.13,   # ~7-9 AM
    "midday": 0.35,    # ~9 AM-3 PM
    "pm_peak": 0.18,   # ~3-6 PM
    "off_peak": 0.34,  # evening / overnight
}

PEAK_HOUR_FACTOR_NOTE = (
    "Peak-hour volume = daily AADT x K-factor (default 0.09; a generic screening "
    "assumption, real K ~0.08-0.12 varies by facility/area). Peak-hour GEH is the "
    "customary basis for the GEH < 5 acceptance rule. NOT a calibrated local factor."
)


def peak_hour_volume(daily_volume: float, peak_hour_factor: float = DEFAULT_PEAK_HOUR_FACTOR) -> float:
    """Peak-hour volume from a daily total via the K-factor."""
    return float(daily_volume) * float(peak_hour_factor)


def period_volumes(daily_volume: float) -> dict[str, float]:
    """Split a daily volume into the coarse diurnal periods (screening)."""
    daily = float(daily_volume)
    return {period: daily * share for period, share in PERIOD_SHARES.items()}
