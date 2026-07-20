#!/usr/bin/env python3
"""Screening-grade on-road GHG (CO2e) estimation from assigned VMT.

Multiplies daily VMT by an EMFAC-style fleet-average running-CO2e rate (grams
per vehicle-mile) that declines with fleet turnover + ZEV adoption, to produce a
CEQA-style annual CO2e figure and a per-capita rate. This is a SCREENING
estimate — a published-rate × VMT product, NOT an EMFAC run of record and NOT a
project-level GHG determination. Stdlib-only so it is unit-testable without the
geo/modeling stack.

The rate table is a documented approximation of EMFAC2021 California statewide
on-road running CO2e (light + medium duty fleet mix, gasoline + diesel), read
off the published fleet-average trend; it declines ~3-4%/yr as the fleet
electrifies. It is uncalibrated to any specific air district or vehicle mix.
"""
from __future__ import annotations

from typing import Any

# EMFAC-style fleet-average RUNNING CO2e, grams per vehicle-mile, by calendar
# year. Anchor points off the published statewide trend; interpolated between,
# clamped outside. Screening-grade — not an EMFAC scenario run.
EMFAC_CO2E_G_PER_MILE: dict[int, float] = {
    2020: 410.0,
    2025: 355.0,
    2030: 300.0,
    2035: 245.0,
    2040: 190.0,
    2045: 150.0,
    2050: 120.0,
}

DEFAULT_ANALYSIS_YEAR = 2025

EMISSIONS_METHOD_NOTE = (
    "Screening CO2e = daily VMT × EMFAC-style fleet-average running-CO2e rate "
    "(g/vehicle-mile) for the analysis year, annualized ×365. The rate is a "
    "documented approximation of EMFAC2021 California statewide on-road running "
    "CO2e (light+medium-duty fleet mix), declining with fleet turnover/ZEV "
    "adoption — uncalibrated to a specific air district or fleet. A published-"
    "rate × VMT product, NOT an EMFAC run of record or a project GHG "
    "determination."
)


def co2e_rate_g_per_mile(analysis_year: int) -> float:
    """Fleet-average running CO2e (g/mi) for a year, linearly interpolated
    between the anchor points and clamped to the table's range."""
    years = sorted(EMFAC_CO2E_G_PER_MILE)
    if analysis_year <= years[0]:
        return EMFAC_CO2E_G_PER_MILE[years[0]]
    if analysis_year >= years[-1]:
        return EMFAC_CO2E_G_PER_MILE[years[-1]]
    lo = max(y for y in years if y <= analysis_year)
    hi = min(y for y in years if y >= analysis_year)
    if lo == hi:
        return EMFAC_CO2E_G_PER_MILE[lo]
    frac = (analysis_year - lo) / (hi - lo)
    return EMFAC_CO2E_G_PER_MILE[lo] + frac * (EMFAC_CO2E_G_PER_MILE[hi] - EMFAC_CO2E_G_PER_MILE[lo])


def estimate_screening_emissions(
    daily_vmt: float | None,
    population: float | None = None,
    analysis_year: int = DEFAULT_ANALYSIS_YEAR,
) -> dict[str, Any] | None:
    """Screening CO2e from daily VMT. Returns None if VMT is missing/non-positive.

    Keys: co2e_g_per_mile, analysis_year, co2e_kg_day, co2e_metric_tons_year,
    co2e_kg_per_capita_day (None if population unknown), method.
    """
    if daily_vmt is None or daily_vmt <= 0:
        return None
    rate = co2e_rate_g_per_mile(int(analysis_year))
    kg_day = daily_vmt * rate / 1000.0  # grams → kg
    tons_year = kg_day * 365.0 / 1000.0  # kg/day → metric tons/year
    per_capita = None
    if population and population > 0:
        per_capita = kg_day / float(population)
    return {
        "analysis_year": int(analysis_year),
        "co2e_g_per_mile": round(rate, 1),
        "co2e_kg_day": round(kg_day, 1),
        "co2e_metric_tons_year": round(tons_year, 1),
        "co2e_kg_per_capita_day": round(per_capita, 3) if per_capita is not None else None,
        "method": EMISSIONS_METHOD_NOTE,
    }
