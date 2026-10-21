"""Trusted technical profiles and bounded source dispatch, without provider reads.

The catalog does not assess scientific accuracy, geography coverage or fit.
Legacy Census slash spellings remain lower-level identities, never canonical
app/native registrations. Validation returns supplied values without rewriting.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

CATALOG_PATH = Path(__file__).with_name('population_source_profiles.v1.json')
PURPOSES = ('new_guided_launch', 'retained_validation', 'aequilibrae_production', 'activitysim_consumption')
CENSUS_ADAPTER = 'us_census_acs5_pums'


class PopulationSourceError(ValueError):
    """Keep unavailable, unsupported and unassessed technical states distinct."""

    def __init__(self, status: str, reason: str):
        self.status = status
        super().__init__(reason)


def _same(value: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        return (isinstance(value, Mapping) and set(value) == set(expected)
                and all(_same(value[key], child) for key, child in expected.items()))
    if isinstance(expected, list):
        return isinstance(value, list) and len(value) == len(expected) and all(_same(a, b) for a, b in zip(value, expected))
    return type(value) is type(expected) and value == expected


def _catalog() -> list[dict[str, Any]]:
    catalog = json.loads(CATALOG_PATH.read_bytes())
    if catalog.get('schema') != 'openplan.population-source-profiles.v1':
        raise PopulationSourceError('unsupported', 'Unsupported population source catalog schema')
    return catalog['profiles']


def _require_capability(entry: Mapping[str, Any], purpose: str) -> None:
    if purpose not in PURPOSES:
        raise PopulationSourceError('unsupported', 'Unsupported population profile purpose')
    capabilities = entry.get('capabilities')
    status = capabilities.get(purpose, 'unassessed') if isinstance(capabilities, Mapping) else 'unassessed'
    if status != 'supported':
        status = status if status in ('unsupported', 'unavailable') else 'unassessed'
        raise PopulationSourceError(status, f'Population source is {status} for {purpose}')


def census_endpoint_profile(summary: str, microdata: str, *, allow_legacy_slash: bool = True, purpose: str = 'retained_validation') -> dict[str, Any]:
    """Derive the existing Census contract from catalog facts, preserving spelling."""
    if not isinstance(summary, str) or not isinstance(microdata, str):
        raise PopulationSourceError('unsupported', 'Both explicit source endpoint strings are required')
    for entry in _catalog():
        profile = entry['profile']
        if profile.get('adapter') != CENSUS_ADAPTER:
            continue
        summaries = (profile['acs_summary_endpoint'], profile['acs_summary_endpoint'] + '/') if allow_legacy_slash else (profile['acs_summary_endpoint'],)
        endpoints = (profile['pums_endpoint'], profile['pums_endpoint'] + '/') if allow_legacy_slash else (profile['pums_endpoint'],)
        if summary in summaries and microdata in endpoints:
            _require_capability(entry, purpose)
            result = copy.deepcopy(profile)
            result['acs_summary_endpoint'], result['pums_endpoint'] = summary, microdata
            return result
    raise PopulationSourceError('unsupported', 'Population inputs require a supported matching Census endpoint pair/vintage')


class PopulationSourceRegistry:
    """Independent test registries cannot enroll production adapters or producers."""

    def __init__(self, registrations: Sequence[Mapping[str, Any]], producers: Mapping[str, Callable] | None = None):
        self._entries = copy.deepcopy(list(registrations))
        self._producers = dict(producers or {})

    def _entry(self, profile: Any, *, allow_legacy_slash: bool = False) -> dict[str, Any]:
        matches = [entry for entry in self._entries if _same(profile, entry['profile'])]
        if not matches and allow_legacy_slash and isinstance(profile, Mapping) and profile.get('adapter') == CENSUS_ADAPTER:
            expected = census_endpoint_profile(profile.get('acs_summary_endpoint'), profile.get('pums_endpoint'))
            if _same(profile, expected):
                matches = [entry for entry in self._entries if entry['profile']['adapter'] == CENSUS_ADAPTER
                    and entry['profile']['income_dollar_year'] == expected['income_dollar_year']]
        if len(matches) != 1:
            raise PopulationSourceError('unsupported', 'Unknown common-population source adapter or exact profile window/schema')
        return matches[0]

    def _require(self, entry: Mapping[str, Any], purpose: str) -> None:
        _require_capability(entry, purpose)

    def validate(self, profile: Any, purpose: str = 'retained_validation', *, allow_legacy_slash: bool = False) -> dict[str, Any]:
        if allow_legacy_slash and purpose != 'retained_validation':
            raise PopulationSourceError('unsupported', 'Legacy profile spellings are lower-level retained contracts only')
        entry = self._entry(profile, allow_legacy_slash=allow_legacy_slash)
        self._require(entry, purpose)
        return dict(profile)

    def descriptor(self, profile: Any) -> dict[str, str]:
        entry = self._entry(profile)
        self._require(entry, 'retained_validation')
        return dict(entry['descriptor'])

    def producer(self, profile: Any) -> Callable:
        entry = self._entry(profile)
        self._require(entry, 'aequilibrae_production')
        producer = self._producers.get(entry['profile']['adapter'])
        if producer is None:
            raise PopulationSourceError('unassessed', 'This registered adapter has no population producer')
        return producer


def _census_production(rows, *, source_profile, census_api_key, synthesize=None, **options):
    """Dispatch only the registered Census algorithm; retain its inputs and fit."""
    if synthesize is None:
        from synthetic_population import synthesize_study_area
        synthesize = synthesize_study_area
    return synthesize(rows, source_profile=source_profile, census_api_key=census_api_key, **options)


# No caller-owned descriptor, run payload or environment value enrolls a source.
PRODUCTION_REGISTRY = PopulationSourceRegistry(_catalog(), {CENSUS_ADAPTER: _census_production})


def validate_source_profile(profile: Any, *, canonical: bool = False) -> dict[str, Any]:
    return PRODUCTION_REGISTRY.validate(profile, allow_legacy_slash=not canonical)


def registered_source_descriptor(profile: Any) -> dict[str, str]:
    return PRODUCTION_REGISTRY.descriptor(profile)


def registered_population_producer(profile: Any) -> Callable:
    return PRODUCTION_REGISTRY.producer(profile)
