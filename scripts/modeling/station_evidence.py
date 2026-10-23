"""Public station metadata, conservative associations, and source-byte custody.

These adapters do not estimate intervals. A station association is not proof
that a newer source record describes a retained AADT observation's process.
"""
from __future__ import annotations

import copy
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def fetch_public(url: str, directory: Path, *, access: str, opener=urllib.request.urlopen) -> dict:
    """Retain anonymous public response bytes; refuse gated source descriptors."""
    if access != 'public_no_registration' or not url.startswith('https://'):
        raise ValueError('source requires access review')
    with opener(url, timeout=60) as response:
        payload = response.read(25_000_001)
        final_url = response.geturl()
    if len(payload) > 25_000_000:
        raise ValueError('source response exceeds metadata size limit')
    if final_url != url:
        raise ValueError('source redirect requires review: ' + final_url)
    digest = sha256(payload)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / digest
    if target.exists():
        if target.read_bytes() != payload:
            raise ValueError('source object collision')
    else:
        with target.open('xb') as handle:
            handle.write(payload)
    return {'url': url, 'accessed_at': datetime.now(timezone.utc).isoformat(),
            'sha256': digest, 'bytes': len(payload), 'file': digest,
            'access': access}


def read_source(directory: Path, receipt: dict) -> bytes:
    """Verify retained source bytes before parsing them."""
    name = receipt['file']
    if not re.fullmatch(r'[0-9a-f]{64}', name):
        raise ValueError('invalid source object name')
    payload = (directory / name).read_bytes()
    if sha256(payload) != receipt['sha256'] or len(payload) != receipt['bytes']:
        raise ValueError('source custody mismatch')
    return payload


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def text(value) -> str:
    return str(value or '').strip()


def required(row: dict, fields: set[str]) -> None:
    if not fields <= row.keys():
        raise ValueError('source schema missing: ' + ','.join(sorted(fields - row.keys())))


def arcgis_rows(payload: bytes) -> list[dict]:
    document = json.loads(payload)
    if 'error' in document or document.get('exceededTransferLimit'):
        raise ValueError('ArcGIS error or incomplete response')
    if not isinstance(document.get('features'), list):
        raise ValueError('ArcGIS features missing')
    return document['features']


def caltrans_workbook(payload: bytes, *, year: int, counties: set[str]) -> list[dict]:
    """Read the named annual worksheet, rejecting formulas and schema drift.

Only selected county rows leave this adapter. Year comes from the annual
worksheet and must agree with the registry's publisher-linked edition.
"""
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    rel = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
    with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
        sheets = ET.fromstring(bundle.read('xl/workbook.xml')).findall('m:sheets/m:sheet', ns)
        sheet = [s for s in sheets if s.get('name') == f'{year} AADT DATA']
        if len(sheet) != 1:
            raise ValueError('annual worksheet edition mismatch')
        relationships = ET.fromstring(bundle.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in relationships if r.get('Id') == sheet[0].get(rel))
        if not re.fullmatch(r'worksheets/sheet\d+\.xml', target or ''):
            raise ValueError('unexpected worksheet path')
        strings = []
        if 'xl/sharedStrings.xml' in bundle.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(bundle.read('xl/sharedStrings.xml'))]
        rows = ET.fromstring(bundle.read('xl/' + target)).findall('m:sheetData/m:row', ns)
        decoded = []
        for row in rows:
            cells = {}
            for cell in row:
                if cell.find('m:f', ns) is not None:
                    raise ValueError('formula in source worksheet')
                value = cell.findtext('m:v', '', ns)
                if cell.get('t') == 's':
                    value = strings[int(value)]
                elif cell.get('t') == 'inlineStr':
                    value = ''.join(cell.find('m:is', ns).itertext())
                cells[re.sub(r'\d', '', cell.get('r', ''))] = text(value)
            decoded.append((row.get('r'), cells))
        if not decoded:
            raise ValueError('empty annual worksheet')
        headers = decoded[0][1]
        required({v: None for v in headers.values()},
                 {'RTE', 'CNTY', 'PM', 'PM_PFX', 'PM_SFX', 'RTE_SFX', 'DESCRIPTION', 'BACK_AADT', 'AHEAD_AADT'})
        result = []
        for row_number, cells in decoded[1:]:
            row = {name: cells.get(column, '') for column, name in headers.items()}
            if row.get('CNTY') in counties:
                result.append({'row': row, 'year': year, 'locator': f'{year} AADT DATA!{row_number}'})
        return result


def ca_key(row: dict) -> tuple:
    return (number(row.get('RTE')), text(row.get('RTE_SFX')), text(row.get('CNTY')),
            text(row.get('PM_PFX')), round(number(row.get('PM')), 6) if number(row.get('PM')) is not None else None, text(row.get('PM_SFX')),
            text(row.get('DESCRIPTION')).upper())


def caltrans_metadata(gis_payload: bytes, annual_rows: list[dict], *, county: str) -> list[dict]:
    """Bind GIS locations to annual rows without treating back/ahead as directions."""
    result = []
    duplicates = {}
    for feature in arcgis_rows(gis_payload):
        row = feature['attributes']
        required(row, {'RTE', 'CNTY', 'PM', 'PM_PFX', 'PM_SFX', 'RTE_SFX', 'DESCRIPTION', 'BACK_AADT', 'AHEAD_AADT'})
        if text(row['CNTY']) != county:
            raise ValueError('Caltrans response outside configured county')
        # Repeated GIS objects are one location only when every substantive
        # field and coordinate is byte-equivalent after JSON serialization.
        key = json.dumps({'attributes': {k: v for k, v in row.items() if k != 'OBJECTID'},
                          'geometry': feature.get('geometry')}, sort_keys=True, allow_nan=False)
        if key in duplicates:
            duplicates[key]['gis_object_ids'].append(row.get('OBJECTID'))
            continue
        annual = [a for a in annual_rows if ca_key(a['row']) == ca_key(row)]
        point = feature.get('geometry', {})
        record = {'source': 'caltrans', 'station_id': None, 'route': str(int(row['RTE'])),
                  'postmile': number(row['PM']), 'description': text(row['DESCRIPTION']).upper(),
                  'longitude': number(point.get('x')), 'latitude': number(point.get('y')),
                  'facility': 'mainline', 'direction': 'two_way', 'year': None,
                  'collection_type': None, 'raw': row, 'annual_status': 'annual_row_not_unique',
                  'gis_object_ids': [row.get('OBJECTID')]}
        if len(annual) == 1:
            a = annual[0]
            record.update(year=a['year'], annual_status='located', annual_locator=a['locator'],
                          back_aadt=number(a['row']['BACK_AADT']), ahead_aadt=number(a['row']['AHEAD_AADT']),
                          annual_raw=a['row'], vehicle_class='all_vehicles')
        result.append(record)
        duplicates[key] = record
    return result


def cdot_metadata(payload: bytes, *, aadt_payload: bytes, dates: dict[str, dict]) -> list[dict]:
    """Keep station type, AADT year, count year and dated availability separate."""
    rows, aadts = json.loads(payload), json.loads(aadt_payload)
    if not isinstance(rows, list) or not isinstance(aadts, list):
        raise ValueError('CDOT list response missing')
    result = []
    for row in rows:
        required(row, {'stationId', 'route', 'begRef', 'endRef', 'continuous', 'desc'})
        if type(row['continuous']) is not bool:
            raise ValueError('CDOT continuous flag must be boolean')
        station = text(row['stationId'])
        record = {'source': 'cdot', 'station_id': station, 'route': text(row['route']),
                  'postmile': number(row['begRef']), 'end_postmile': number(row['endRef']),
                  'facility': 'unknown', 'direction': 'unknown', 'year': None,
                  'collection_type': 'continuous' if row['continuous'] else 'short_duration',
                  'raw': row, 'count_dates': [], 'aadts': []}
        for feature in aadts:
            attrs = feature['attributes']
            required(attrs, {'COUNTSTATIONID', 'ROUTE', 'REFPT', 'ENDREFPT', 'AADTYR', 'COUNTYEAR', 'AADT', 'ISRAMP'})
            if (text(attrs['COUNTSTATIONID']), text(attrs['ROUTE']), number(attrs['REFPT'])) == (station, record['route'], record['postmile']):
                record['aadts'].append(attrs)
        if len(record['aadts']) == 1:
            attrs = record['aadts'][0]
            record.update(year=number(attrs['AADTYR']), count_year=number(attrs['COUNTYEAR']),
                          aadt=number(attrs['AADT']),
                          facility={'0': 'mainline', '1': 'ramp'}.get(text(attrs['ISRAMP']), 'unknown'))
        if station in dates:
            d = dates[station]
            if d.get('continuous') is not row['continuous'] or not isinstance(d.get('countDates'), list):
                raise ValueError('CDOT date response type mismatch')
            # Availability dates do not establish complete hours or count duration.
            incomplete = []
            for date in d['countDates']:
                if not isinstance(date, str) or not re.fullmatch(r'\d{8}', date):
                    raise ValueError('invalid CDOT count date')
                try:
                    datetime.strptime(date, '%Y%m%d')
                except ValueError:
                    incomplete.append(date)
            record['count_dates'] = sorted(set(d['countDates']))
            record['incomplete_or_invalid_dates'] = sorted(set(incomplete))
        result.append(record)
    return result


def tmas_metadata(payload: bytes, *, members: list[str], counties: set[str], year: int) -> list[dict]:
    """Read selected state members and county rows, not monthly traffic volumes."""
    result = []
    with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
        for member in members:
            raw = bundle.read(member)
            reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter='|')
            required({name: None for name in reader.fieldnames or []},
                     {'station_id', 'state_code', 'county_code', 'year_record', 'method_volume',
                      'travel_dir', 'travel_lane', 'num_lanes', 'num_lanes_volume', 'latitude',
                      'longitude', 'posted_signed_route', 'station_location'})
            for original in reader:
                row = {k: text(v) for k, v in original.items()}
                geography = row['state_code'].zfill(2) + row['county_code'].zfill(3)
                if geography not in counties:
                    continue
                if int(row['year_record']) not in {year, year % 100}:
                    raise ValueError('TMAS year mismatch')
                # The legacy station format publishes western longitudes unsigned.
                lon, lat = number(row['longitude']), number(row['latitude'])
                result.append({'source': 'tmas', 'station_id': row['station_id'], 'geography': geography,
                               'route': str(int(row['posted_signed_route'])) if row['posted_signed_route'].isdigit() else None,
                               'latitude': lat / 1e6 if lat is not None else None,
                               'longitude': -abs(lon) / 1e6 if lon is not None else None,
                               'year': year, 'facility': 'unknown', 'direction': row['travel_dir'],
                               'lane': row['travel_lane'],
                               'collection_type': 'continuous' if row['method_volume'] == '3' else None,
                               'member': member, 'member_sha256': sha256(raw), 'raw': row})
    return result


def hpms_metadata(payload: bytes, *, geography: str) -> list[dict]:
    """Retain section metadata without turning group statistics into station facts."""
    rows = json.loads(payload)
    if not isinstance(rows, list):
        raise ValueError('HPMS list response missing')
    result = []
    for row in rows:
        required(row, {'stateid', 'county_id', 'route_id', 'begin_point', 'end_point', 'year_record'})
        if str(int(row['stateid'])).zfill(2) + str(int(row['county_id'])).zfill(3) != geography:
            raise ValueError('HPMS response outside configured county')
        result.append({'source': 'hpms', 'station_id': None, 'route': text(row.get('route_number')),
                       'route_id': row['route_id'], 'year': number(row['year_record']),
                       'collection_type': None, 'facility': {'1': 'one_way', '2': 'mainline', '4': 'ramp'}.get(text(row.get('facility_type')), 'unknown'),
                       'direction': 'two_way' if text(row.get('facility_type')) == '2' else 'unknown',
                       'raw': row})
    return result


def distance_metres(lon1, lat1, lon2, lat2):
    values = [number(v) for v in (lon1, lat1, lon2, lat2)]
    if None in values or not all(-180 <= x <= 180 for x in (values[0], values[2])) or not all(-90 <= x <= 90 for x in (values[1], values[3])):
        return None
    a, b, c, d = map(math.radians, values)
    h = math.sin((d-b)/2)**2 + math.cos(b)*math.cos(d)*math.sin((c-a)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def observation_reference(row: dict) -> dict:
    """Decode the historical adapter identity, not a publisher station ID."""
    match = re.fullmatch(r'(CT|CDOT)_RTE(.+)_PM(\d+)_(\d+)', row['station_id'])
    if not match:
        raise ValueError('unsupported retained station identity')
    source = 'caltrans' if match[1] == 'CT' else 'cdot'
    return {'source': source, 'station_id': text(row.get('source_description')) if source == 'cdot' else None,
            'route': str(int(match[2])) if source == 'caltrans' else match[2],
            'postmile': float(match[3] + '.' + match[4]),
            'longitude': (float(row['bbox_min_lon']) + float(row['bbox_max_lon'])) / 2,
            'latitude': (float(row['bbox_min_lat']) + float(row['bbox_max_lat'])) / 2,
            'description': text(row.get('source_description')).upper(),
            'facility': row.get('station_role', 'unknown'), 'direction': row.get('direction', 'unknown')}


def line_distance_metres(longitude: float, latitude: float, geometry: dict):
    """Measure distance to the section, not to an arbitrary segment midpoint."""
    kind = geometry.get('type')
    if kind not in {'LineString', 'MultiLineString'}:
        return None
    lines = [geometry.get('coordinates', [])] if kind == 'LineString' else geometry.get('coordinates', [])
    distances = []
    scale_x = 111195 * math.cos(math.radians(latitude))
    for line in lines:
        for start, end in zip(line, line[1:]):
            if len(start) < 2 or len(end) < 2 or distance_metres(*start[:2], *end[:2]) is None:
                continue
            ax, ay = (start[0] - longitude) * scale_x, (start[1] - latitude) * 111195
            bx, by = (end[0] - longitude) * scale_x, (end[1] - latitude) * 111195
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, -(ax*dx + ay*dy)/(dx*dx + dy*dy))) if dx*dx + dy*dy else 0
            distances.append(math.hypot(ax + t*dx, ay + t*dy))
    return min(distances) if distances else None


def external_association(reference: dict, records: list[dict], *, source: str, max_distance_m: float) -> dict:
    """Report national-source location candidates, never a count-process transfer.

HPMS describes sections, not count stations. Even a unique nearby section
needs an agency crosswalk to establish lineage to the retained observation.
TMAS rows also need facility and direction equivalence, which the inspected
station file does not establish for the historical two-way observations.
"""
    if source not in {'hpms', 'tmas'} or not math.isfinite(max_distance_m) or not 0 < max_distance_m <= 100:
        raise ValueError('invalid external association parameters')
    route = re.fullmatch(r'0*(\d+)[A-Z]?', reference['route'])
    if not route:
        return {'status': 'unmatched', 'reason': 'route_number_unavailable', 'candidates': []}
    candidates = []
    refusals = set()
    for record in records:
        if record['source'] != source:
            continue
        try:
            same_route = int(record.get('route')) == int(route[1])
        except (TypeError, ValueError):
            same_route = False
        if not same_route:
            continue
        if source == 'hpms':
            distance = line_distance_metres(reference['longitude'], reference['latitude'], record['raw'].get('line') or {})
        else:
            distance = distance_metres(reference['longitude'], reference['latitude'], record.get('longitude'), record.get('latitude'))
        if distance is None or distance > max_distance_m:
            refusals.add('no_location_within_tolerance'); continue
        if record.get('facility') != 'mainline' or reference['facility'] != 'mainline' or record['direction'] != reference['direction']:
            refusals.add('facility_or_direction_scope_unproved'); continue
        candidates.append({'record_sha256': sha256(json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()),
                           'distance_m': distance, 'year': record.get('year')})
    return {'status': 'candidate_only' if candidates else 'unmatched',
            'reason': 'publisher_crosswalk_required' if len(candidates) == 1 else ('ambiguous_section_candidates' if candidates else (','.join(sorted(refusals)) or 'no_route_candidate')),
            'confidence': 'low_location_only' if candidates else 'none', 'candidates': candidates}


def join_station(reference: dict, records: list[dict], *, max_distance_m: float) -> dict:
    """Require namespace identity or unique route/postmile/location/facility evidence.

No nearest-only join, name-only join, cross-source numeric ID join, or
duplicate tie breaker can authorize metadata transfer.
"""
    if not math.isfinite(max_distance_m) or not 0 < max_distance_m <= 100:
        raise ValueError('invalid documented location tolerance')
    candidates = []
    reasons = set()
    for record in records:
        if record['source'] != reference['source']:
            continue
        if reference.get('station_id'):
            if record.get('station_id') != reference['station_id']:
                continue
            method = 'publisher_station_id_route_section'
        else:
            if record.get('route') != reference['route']:
                continue
            method = 'route_postmile_description_location'
        if record.get('route') != reference['route'] or record.get('postmile') is None or abs(record['postmile'] - reference['postmile']) > 0.00051:
            reasons.add('route_or_section_mismatch'); continue
        if reference['facility'] != 'mainline' or record.get('facility') != 'mainline':
            reasons.add('facility_unproved_or_incompatible'); continue
        if method == 'route_postmile_description_location':
            distance = distance_metres(reference['longitude'], reference['latitude'], record.get('longitude'), record.get('latitude'))
            if distance is None or distance > max_distance_m or reference['description'] != record.get('description'):
                reasons.add('location_or_description_mismatch'); continue
        else:
            distance = None
        candidates.append({'record': record, 'method': method, 'distance_m': distance})
    if len(candidates) != 1:
        return {'status': 'unmatched', 'reason': 'ambiguous_station_candidates' if candidates else (','.join(sorted(reasons)) or 'no_station_candidate'),
                'candidate_count': len(candidates), 'confidence': 'none'}
    return {'status': 'associated', 'reason': None, 'confidence': 'high_identity_only', **candidates[0]}


def annotate_candidate(observation: dict, retained_row: dict, association: dict) -> tuple[dict, list[str]]:
    """Create an audit-only successor copy; refuse unbound historical process facts."""
    result = copy.deepcopy(observation)
    if association['status'] != 'associated':
        return result, ['station_unmatched']
    record = association['record']
    if record['source'] != 'caltrans':
        return result, ['historical_observation_year_unbound', 'station_type_not_bound_to_retained_aadt']
    if record.get('year') != observation['time_basis']['year']:
        return result, ['source_year_mismatch_or_unavailable']
    values = [v for v in (record.get('back_aadt'), record.get('ahead_aadt')) if v is not None]
    if not values or max(values) != number(retained_row['observed_volume']):
        return result, ['annual_value_mismatch']
    # This program-wide definition applies to the exact annual source row.
    result['vehicle_basis']['vehicle_class'] = record['vehicle_class']
    result['station_metadata_lineage'] = {k: record[k] for k in ('source', 'year', 'annual_locator', 'custody')}
    return result, ['collection_process_not_published', 'back_ahead_section_scope_unresolved'] if len(set(values)) > 1 else ['collection_process_not_published']
