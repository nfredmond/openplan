#!/usr/bin/env python3
"""United States Census division geography adapter.

Country-specific state FIPS and Census division concepts stop in this module.
Shared study code consumes the returned division key and never embeds a state
or place list of its own.
"""

from __future__ import annotations


DIVISION_STATE_FIPS = {
    "new_england": ("09", "23", "25", "33", "44", "50"),
    "middle_atlantic": ("34", "36", "42"),
    "east_north_central": ("17", "18", "26", "39", "55"),
    "west_north_central": ("19", "20", "27", "29", "31", "38", "46"),
    "south_atlantic": ("10", "11", "12", "13", "24", "37", "45", "51", "54"),
    "east_south_central": ("01", "21", "28", "47"),
    "west_south_central": ("05", "22", "40", "48"),
    "mountain": ("04", "08", "16", "30", "32", "35", "49", "56"),
    "pacific": ("02", "06", "15", "41", "53"),
}

STATE_FIPS_TO_DIVISION = {
    state_fips: division
    for division, state_codes in DIVISION_STATE_FIPS.items()
    for state_fips in state_codes
}


def census_division_for_state_fips(state_fips: str) -> str | None:
    return STATE_FIPS_TO_DIVISION.get(str(state_fips).zfill(2))
