"""Read retained ACS sequence and PUMS CSV files without credentials.

This input adapter does not change synthesis, defaults, weights or geography.
Callers retain source URLs and hashes and supply the admitted source profile.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from pathlib import Path
from typing import Iterable, Mapping

import census_pums as cp


def sequence_cells(lookup: Iterable[Mapping[str, str]], variables: list[str]) -> dict[str, tuple[str, int, str]]:
    """Resolve API cell names to the publisher's one-based sequence positions."""
    positions: dict[str, tuple[str, int, str]] = {}
    starts: dict[tuple[str, str], int] = {}
    wanted = set(variables)
    for row in lookup:
        table, sequence = row['Table ID'], row['Sequence Number']
        key = table, sequence
        if row['Start Position']:
            starts[key] = int(row['Start Position'])
        line = row['Line Number']
        if not line or not line.isdecimal():
            continue
        if key not in starts:
            raise ValueError('Sequence cell lacks table start position')
        for suffix, prefix in [('E', 'e'), ('M', 'm')]:
            name = f'{table}_{int(line):03d}{suffix}'
            if name in wanted:
                if name in positions:
                    raise ValueError('Duplicate sequence cell')
                positions[name] = sequence, starts[key] + int(line) - 2, prefix
    if set(positions) != wanted:
        raise ValueError(f'Missing sequence definitions: {sorted(wanted-set(positions))}')
    return positions


def geography_logrecs(rows: Iterable[list[str]], geoids: set[str]) -> dict[str, str]:
    """Use fully qualified geographic identifiers, never names or row order."""
    result: dict[str, str] = {}
    for row in rows:
        matches = [cell for cell in row if re.fullmatch(r'(14000|15000)US[0-9]{11,12}', cell)]
        if not matches:
            continue
        geoid = matches[0].split('US')[1]
        if geoid not in geoids:
            continue
        if row[4] in result or geoid in result.values():
            raise ValueError('Duplicate geography identity')
        result[row[4]] = geoid
    if set(result.values()) != geoids:
        raise ValueError('Bulk geography does not cover every requested zone')
    return result


def read_sequence_controls(geography: Path, lookup: Path, archives: Mapping[str, Path],
                           geoids: set[str], variables: list[str]) -> dict[str, dict[str, str]]:
    """Join estimate and margin records by LOGRECNO and exact sequence identity."""
    with lookup.open(encoding='cp1252', newline='') as handle:
        cells = sequence_cells(csv.DictReader(handle), variables)
    with geography.open(encoding='cp1252', newline='') as handle:
        logrecs = geography_logrecs(csv.reader(handle), geoids)
    result: dict[str, dict[str, str]] = {geoid: {} for geoid in geoids}
    for sequence in sorted({v[0] for v in cells.values()}):
        with zipfile.ZipFile(archives[sequence]) as archive:
            for prefix in ('e', 'm'):
                columns = {k: v[1] for k, v in cells.items() if v[0] == sequence and v[2] == prefix}
                if not columns:
                    continue
                names = [n for n in archive.namelist() if Path(n).name.startswith(prefix) and n.endswith('.txt')]
                if len(names) != 1:
                    raise ValueError('Expected one estimate or margin sequence member')
                seen: set[str] = set()
                with archive.open(names[0]) as raw:
                    for row in csv.reader(io.TextIOWrapper(raw, encoding='cp1252')):
                        if len(row) <= max(columns.values()) or row[4].zfill(4) != sequence.zfill(4):
                            raise ValueError('Sequence identity or row width differs')
                        if row[5] not in logrecs:
                            continue
                        if row[5] in seen:
                            raise ValueError('Duplicate sequence geography')
                        seen.add(row[5])
                        result[logrecs[row[5]]].update({k: row[i] for k, i in columns.items()})
                if seen != set(logrecs):
                    raise ValueError('Sequence omits requested geography')
    return result


def read_pums(household_archive: Path | list[Path], person_archive: Path | list[Path],
              pumas: list[dict[str, str]], profile: Mapping[str, object]) -> tuple[list[dict[str, str]], dict[str, object]]:
    """Join published household and person records without reading travel choices."""
    checked = cp.census_vintage_profile(str(profile['acs_summary_endpoint']), str(profile['pums_endpoint']))
    if len(checked.puma_fields) != 1:
        raise ValueError('Bulk adapter requires one PUMA vintage')
    vintage, field = checked.puma_fields[0]
    if any(p['vintage'] != vintage for p in pumas):
        raise ValueError('PUMA vintage differs from profile')
    wanted = {(p['state_fips'], p['puma']) for p in pumas}

    def single_archive(path: Path):
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if Path(n).name.startswith('psam_') and n.endswith('.csv')]
            if len(names) != 1:
                raise ValueError('Expected one PUMS CSV member')
            with archive.open(names[0]) as raw:
                yield from csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig'))

    def records(paths: Path | list[Path]):
        for path in paths if isinstance(paths, list) else [paths]:
            yield from single_archive(path)

    households: dict[str, dict[str, str]] = {}
    represented: set[tuple[str, str]] = set()
    household_places: dict[str, tuple[str, str]] = {}
    for r in records(household_archive):
        if (r['ST'].zfill(2), r[field].zfill(5)) not in wanted:
            continue
        serial = r['SERIALNO']
        if serial in households:
            raise ValueError('Duplicate PUMS household')
        households[serial] = {k: r[k] for k in cp.PUMS_HOUSEHOLD_VARIABLES}
        households[serial][field] = r[field].zfill(5)
        household_places[serial] = r['ST'].zfill(2), r[field].zfill(5)
        represented.add(household_places[serial])
    if represented != wanted:
        raise ValueError(f'Bulk files omit selected PUMAs: {sorted(wanted-represented)}')
    rows = []
    seen: set[tuple[str, str]] = set()
    for r in records(person_archive):
        if (r['ST'].zfill(2), r[field].zfill(5)) not in wanted:
            continue
        serial = r['SERIALNO']
        # Group quarters have no household record in the household-resident universe.
        if serial not in households:
            if r.get('RELSHIPP', r.get('RELP', '')) in {'16', '17', '37', '38'}:
                continue
            raise ValueError('Person lacks a matching household')
        identity = serial, r['SPORDER']
        if identity in seen or (r['ST'].zfill(2), r[field].zfill(5)) != household_places[serial]:
            raise ValueError('Duplicate person or PUMA join mismatch')
        seen.add(identity)
        rows.append({**households[serial], **{k: r[k] for k in cp.PUMS_PERSON_VARIABLES}})
    counts: dict[str, int] = {}
    for row in rows:
        counts[row['SERIALNO']] = counts.get(row['SERIALNO'], 0) + 1
    for serial, household in households.items():
        if counts.get(serial, 0) != int(household['NP']):
            raise ValueError('Household person count differs from NP')
    if not rows:
        raise ValueError('No household residents in selected PUMAs')
    return rows, {'transport': 'retained public bulk CSV; no API key', 'person_records': len(rows),
                  'sources': pumas, 'household_records': len(households)}
