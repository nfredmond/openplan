"""Inspect frozen receipts and emitted OOXML, with faults in private copies only."""

import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import traceback
import xml.etree.ElementTree as ET
import zipfile

PUBLIC = Path(__file__).resolve().parent
PRIVATE = Path('/home/nathaniel/.local/state/openplan/v6-actual-import-workbook-review-20261015')
FROZEN = Path('/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-import-artifacts-20261015')
WORKBOOK = 'imported-project-workbook.xlsx'
SOURCE_HASH = 'b6c01c67c37506a56301c37301f0eb84d9d21dcacb415a4988c21f0e00e7e0a7'
APPROVED_HASH = 'b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508'
LINKAGE = json.loads((PRIVATE/'expected-linkage.json').read_text())
PROJECT, RETAINED, WORKSPACE, DOCUMENT, BATCH = [LINKAGE[key] for key in
    ['project', 'retained', 'workspace', 'document', 'batch']]
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
M = '{' + NS['m'] + '}'
HEADERS = ['Project name', 'OpenPlan project ID', 'Description', 'Estimated cost',
           'Cost currency', 'Cost price year', 'Project type', 'Status', 'Delivery phase',
           'Source-location text', 'Place source', 'Place kind', 'Place reference',
           'Country code', 'Subdivision code', 'Cost source document ID', 'Cost recorded at',
           'Created at', 'Updated at']
ROW_KEYS = ['worksheetIndex', 'worksheetName', 'headerRow', 'rowNumber', 'fingerprint',
            'name', 'sourceId', 'description', 'sourceLocationText', 'estimatedCost',
            'planType', 'status', 'deliveryPhase', 'decision', 'confirmNameMatch',
            'confirmFormula', 'formulaFields', 'state', 'canCreate']


def require(condition, category):
    if not condition:
        raise AssertionError(category)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def compact(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def custody(files, inventory):
    require({n:dict(bytes=len(v), sha256=digest(v)) for n,v in files.items()} == inventory,
            'custody: frozen inventory')


def review_hash(review):
    # Preserve the pinned TypeScript previewShape insertion order independently.
    rows = []
    for row in review['rows']:
        shape = {key: row[key] for key in ROW_KEYS}
        shape.update(errorCodes=[v['code'] for v in row['errors']],
                     warningCodes=[v['code'] for v in row['warnings']],
                     matchingProjectIds=row['matchingProjectIds'],
                     matchingBatchRows=row['matchingBatchRows'],
                     previouslyCreatedProjectId=row['previouslyCreatedProjectId'])
        rows.append(shape)
    return digest(compact(dict(version=review['version'], format=review['format'],
                               sourceHash=review['sourceHash'],
                               configurations=review['configurations'], rows=rows)))


def inspect(files):
    request, response, approved, repeat = [json.loads(files[n]) for n in
        ['confirm-request.json', 'confirm-response.json', 'approved-review-response.json',
         'repeat-preview-response.json']]
    reviews = [v['review'] for v in [approved, response, repeat]]
    valid, invalid = reviews[1]['rows']
    require(valid['rowNumber'] == 2 and valid['decision'] == 'create' and valid['canCreate']
            and valid['estimatedCost'] == dict(amount='125000', currency='EUR', priceYear=None)
            and valid['status'] == 'active' and valid['planType'] == 'capital_program'
            and valid['deliveryPhase'] == 'programming' and valid['formulaFields'] == []
            and [w['code'] for w in valid['warnings']] == ['unknown_price_year']
            and invalid['rowNumber'] == 3 and invalid['status'] == 'invented-status'
            and invalid['decision'] == 'skip' and invalid['state'] == 'blocked'
            and not invalid['canCreate'] and [v['code'] for v in invalid['errors']] == ['invalid_status'],
            'receipt: reviewed row semantics')
    require(all(review_hash(v) == v['previewHash'] for v in reviews), 'receipt: recomputed preview hash')
    require(all(v['source']['sha256'] == SOURCE_HASH and v['source']['id'] == DOCUMENT
                and v['source']['byteLength'] == 256 and v['source']['format'] == 'csv'
                and v['review']['sourceHash'] == SOURCE_HASH for v in [approved, response, repeat])
            and request['sourceDocumentId'] == DOCUMENT and request['workspaceId'] == WORKSPACE,
            'receipt: source linkage')
    require(request['mode'] == 'commit' and request['approvedPreviewHash'] == APPROVED_HASH
            and reviews[0]['previewHash'] == APPROVED_HASH
            and reviews[1]['previewHash'] == APPROVED_HASH
            and request['configurations'] == reviews[0]['configurations'] == reviews[1]['configurations']
            and reviews[0] == reviews[1]
            and request['rowReviews'] == [dict(worksheetIndex=0, rowNumber=2, decision='create',
                confirmNameMatch=False, confirmFormula=False), dict(worksheetIndex=0, rowNumber=3,
                decision='skip', confirmNameMatch=False, confirmFormula=False)],
            'receipt: exact approval and decisions')
    require(response['committed'] == dict(batchId=BATCH, created=1, invalid=1, skipped=0,
            conflicted=0, projectIds=[PROJECT], previouslyCreated=0), 'receipt: commit outcome')
    again = reviews[2]
    require(again['rows'][0]['state'] == 'created_before'
            and again['rows'][0]['decision'] == 'skip' and not again['rows'][0]['canCreate']
            and again['rows'][0]['previouslyCreatedProjectId'] == PROJECT
            and again['rows'][0]['matchingProjectIds'] == [PROJECT]
            and again['rows'][0]['fingerprint'] == valid['fingerprint']
            and again['rows'][1] == invalid
            and again['counts'] == dict(rows=2, selectedForCreate=0, skipped=1, conflicted=0,
                                       invalid=1, previouslyCreated=1)
            and 'committed' not in repeat, 'receipt: repeat preview lock')

    try:
        with zipfile.ZipFile(io.BytesIO(files[WORKBOOK])) as z:
            require(z.testzip() is None and len(z.namelist()) == len(set(z.namelist())), 'package: ZIP/XML')
            parts = {name: z.read(name) for name in z.namelist()}
        roots = {name: ET.fromstring(value) for name, value in parts.items()
                 if name.endswith(('.xml', '.rels'))}
    except (zipfile.BadZipFile, ET.ParseError, KeyError, RuntimeError):
        raise AssertionError('package: ZIP/XML') from None
    defaults = {n.get('Extension'):n.get('ContentType') for n in roots['[Content_Types].xml']
                if n.tag.endswith('Default')}
    overrides = {n.get('PartName').lstrip('/'):n.get('ContentType')
                 for n in roots['[Content_Types].xml'] if n.tag.endswith('Override')}
    effective_types = {name:overrides.get(name, defaults.get(name.rsplit('.',1)[-1], '')) for name in parts}
    require(not any('vba' in name.lower() or 'externallink' in name.lower() for name in parts)
            and not any('macroEnabled' in v for v in effective_types.values())
            and not any(node.get('TargetMode') == 'External' or 'externalLink' in node.get('Type', '')
                        for root in roots.values() for node in root.iter()), 'package: external/macro')
    require(not any(node.tag == M + 'f' for root in roots.values() for node in root.iter()),
            'workbook: no formulas')
    rels = {n.get('Id'): n.get('Target') for n in roots['xl/_rels/workbook.xml.rels']}
    sheets = roots['xl/workbook.xml'].find('m:sheets', NS)
    sheet_targets = []
    for node in sheets:
        relationship_id = node.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        sheet_targets.append((node.get('name'), posixpath.normpath('xl/' + rels.get(relationship_id, ''))))
    require(sheet_targets == [('Projects', 'xl/worksheets/sheet1.xml'),
                              ('Read me', 'xl/worksheets/sheet2.xml')], 'package: sheet relationships')
    cells = []
    for name in ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']:
        root = roots[name]
        raw = root.findall('m:sheetData/m:row/m:c', NS)
        require(all(c.get('t') == 'str' for c in raw), 'workbook: literal cell types')
        cells.append({c.get('r'): c.findtext('m:v', default='', namespaces=NS) or '' for c in raw})
    project, readme = cells
    require([project.get(chr(65+i) + '1') for i in range(19)] == HEADERS, 'workbook: exact headers')
    require(roots['xl/worksheets/sheet1.xml'].find('m:dimension', NS).get('ref') == 'A1:S3'
            and len(project) == 57 and [project.get('B2'), project.get('B3')] == [PROJECT, RETAINED]
            and 'Synthetic skipped row' not in project.values(), 'workbook: exactly two project rows')
    require(project['A2'] == valid['name'] == 'Synthetic UI import =1+1'
            and project['C2'] == valid['description']
            and [project[c+'2'] for c in 'GHI'] == ['capital_program', 'active', 'programming'],
            'workbook: created literal and classifications')
    require([project[c+'2'] for c in 'DEF'] == ['125000', 'EUR', '']
            and [project[c+'3'] for c in 'DEF'] == ['', '', ''], 'workbook: cost and unknown year')
    require(project['P2'] == DOCUMENT
            and [project[c+'2'] for c in 'QRS'] == ['2026-10-15T16:11:05.873845+00:00'] * 3,
            'workbook: cost provenance and timestamps')
    require([project[c+'2'] for c in 'JKLMNO'] == [''] * 6
            and [project[c+'3'] for c in 'JKLMNO'] == ['Oakland', 'tigerweb', 'city', '0653000', 'US', 'CA']
            and project['A3'] == 'Synthetic retained-transit geography check',
            'workbook: geography remains distinct')
    require(readme['B4'] == request['workspaceId'] and readme['B5'] == '2'
            and readme['B2'] == '2026-10-15T16:11:57.912Z'
            and readme['B9'] == 'Create only. Every row starts as Skip and must be explicitly reviewed.'
            and readme['B10'] == 'Source-location text is retained for review but does not create a project boundary or map point.'
            and readme['B11'] == 'Place identity, cost provenance, and timestamps are exported for inspection but are not imported as project fields.'
            and readme['B12'] == 'This workbook contains literal values only. OpenPlan does not emit or recalculate formulas.',
            'workbook: workspace and import declarations')
    content = b'\n'.join(parts.values()) + b'\n'.join(v for n,v in files.items() if n != WORKBOOK)
    require(not re.search(rb'(?i)(created_by|recorded_by|recordedBy|actor_id|imported_by|access_token|refresh_token|password)', content)
            and not re.search(rb'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', content)
            and not re.search(rb'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', content)
            and b'-----BEGIN ' not in content, 'privacy: named fields and credential patterns')
    return dict(zip_members=len(parts), project_rows=2, project_cells=len(project),
                readme_cells=len(readme), all_cells_literal_strings=True,
                recomputed_preview_hashes=[v['previewHash'] for v in reviews],
                source_hash_in_workbook=any(SOURCE_HASH.encode() in v for v in parts.values()),
                approval_hash_in_workbook=any(APPROVED_HASH.encode() in v for v in parts.values()),
                batch_id_in_workbook=any(BATCH.encode() in v for v in parts.values()))


def zip_edit(files, member, transform):
    with zipfile.ZipFile(io.BytesIO(files[WORKBOOK])) as z:
        parts = {n:z.read(n) for n in z.namelist()}
    parts[member] = transform(parts[member])
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, value in parts.items():
            z.writestr(name, value)
    files[WORKBOOK] = out.getvalue()


def cell_edit(files, address, value=None, cell_type=None, formula=False):
    def transform(data):
        root = ET.fromstring(data)
        c = root.find(f'.//m:c[@r="{address}"]', NS)
        if value is not None:
            c.find('m:v', NS).text = value
        if cell_type:
            c.set('t', cell_type)
        if formula:
            ET.SubElement(c, M+'f').text = '1+1'
        return ET.tostring(root)
    zip_edit(files, 'xl/worksheets/sheet1.xml', transform)


def json_edit(files, name, transform):
    value = json.loads(files[name])
    transform(value)
    files[name] = compact(value)


def main():
    inventory = json.loads((FROZEN/'inventory.json').read_bytes())
    originals = {n:(FROZEN/n).read_bytes() for n in inventory}
    actual = {n:dict(bytes=len(v), sha256=digest(v)) for n,v in originals.items()}
    custody(originals, inventory)
    baseline = inspect(originals)
    trials = []
    copies = PRIVATE/'copies'
    # The original files never receive writes. Each control restores all copies in finally.
    def trial(name, expected, mutate, verifier=inspect):
        current = dict(originals)
        record = dict(name=name, expected=expected)
        try:
            mutate(current)
            for n,v in current.items():
                (copies/n).write_bytes(v)
            try:
                verifier({n:(copies/n).read_bytes() for n in inventory})
                observed = 'survived'
            except AssertionError as error:
                observed = str(error)
            record['observed'] = observed
            require(observed == expected, 'control: unexpected result')
        finally:
            for n,v in originals.items():
                (copies/n).write_bytes(v)
            record['restored'] = all((copies/n).read_bytes() == v for n,v in originals.items())
            trials.append(record)
            (PRIVATE/'trials.json').write_text(json.dumps(trials, indent=2)+'\n')

    def harmless(files):
        files['confirm-request.json'] = json.dumps(json.loads(files['confirm-request.json']), indent=4).encode()
        with zipfile.ZipFile(io.BytesIO(files[WORKBOOK])) as z:
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as dst:
                for n in z.namelist():
                    dst.writestr(n, z.read(n))
                dst.comment = b'Private independent review control'
        files[WORKBOOK] = out.getvalue()
    trial('JSON whitespace and ZIP comment', 'survived', harmless)
    trial('wrong copied file byte under pinned inventory', 'custody: frozen inventory',
          lambda f:f.update({'confirm-request.json':f['confirm-request.json']+b' '}),
          lambda f:custody(f,inventory))
    trial('changed approved review payload', 'receipt: recomputed preview hash', lambda f:
        json_edit(f, 'approved-review-response.json', lambda v:v['review']['rows'][0].update(name='changed')))
    trial('changed source hash metadata', 'receipt: source linkage', lambda f:
        json_edit(f, 'confirm-response.json', lambda v:v['source'].update(sha256='0'*64)))
    trial('changed approved request hash', 'receipt: exact approval and decisions', lambda f:
        json_edit(f, 'confirm-request.json', lambda v:v.update(approvedPreviewHash='0'*64)))
    trial('invalid skipped row promoted to valid', 'receipt: reviewed row semantics', lambda f:
        json_edit(f, 'confirm-response.json', lambda v:v['review']['rows'][1].update(errors=[])))
    trial('wrong commit count', 'receipt: commit outcome', lambda f:
        json_edit(f, 'confirm-response.json', lambda v:v['committed'].update(created=2)))
    trial('repeat claims second commit', 'receipt: repeat preview lock', lambda f:
        json_edit(f, 'repeat-preview-response.json', lambda v:v.update(committed={})))
    trial('malformed worksheet XML', 'package: ZIP/XML', lambda f:
        zip_edit(f,'xl/worksheets/sheet1.xml',lambda b:b'<broken'))
    trial('external relationship', 'package: external/macro', lambda f:
        zip_edit(f,'xl/_rels/workbook.xml.rels',lambda b:b.replace(b'Target="worksheets/sheet1.xml"',b'TargetMode="External" Target="worksheets/sheet1.xml"')))
    trial('macro content declaration', 'package: external/macro', lambda f:
        zip_edit(f,'[Content_Types].xml',lambda b:b.replace(b'spreadsheetml.sheet.main+xml',b'spreadsheetml.sheet.macroEnabled.main+xml')))
    trial('wrong worksheet target', 'package: sheet relationships', lambda f:
        zip_edit(f,'xl/_rels/workbook.xml.rels',lambda b:b.replace(b'worksheets/sheet1.xml',b'worksheets/sheet9.xml')))
    trial('formula injected in literal name', 'workbook: no formulas', lambda f:cell_edit(f,'A2',formula=True))
    trial('cost converted to numeric', 'workbook: literal cell types', lambda f:cell_edit(f,'D2',cell_type='n'))
    trial('changed header', 'workbook: exact headers', lambda f:cell_edit(f,'A1','Name'))
    trial('skipped project substituted', 'workbook: exactly two project rows', lambda f:cell_edit(f,'B3','skipped-project'))
    trial('literal formula text evaluated', 'workbook: created literal and classifications', lambda f:cell_edit(f,'A2','2'))
    trial('unknown year replaced with current year', 'workbook: cost and unknown year', lambda f:cell_edit(f,'F2','2026'))
    trial('wrong cost source document', 'workbook: cost provenance and timestamps', lambda f:cell_edit(f,'P2','wrong-document'))
    trial('source text promoted to project place', 'workbook: geography remains distinct', lambda f:cell_edit(f,'J2','Unverified text only'))
    trial('removed create-only warning', 'workbook: workspace and import declarations', lambda f:
        zip_edit(f,'xl/worksheets/sheet2.xml',lambda b:b.replace(b'Create only.',b'Update existing.')))
    trial('actor field injected in properties', 'privacy: named fields and credential patterns', lambda f:
        zip_edit(f,'docProps/core.xml',lambda b:b.replace(b'OpenPlan',b'actor_id',1)))
    restored = inspect({n:(copies/n).read_bytes() for n in inventory})
    require(restored == baseline and all((FROZEN/n).read_bytes() == v for n,v in originals.items()),
            'custody: restoration and originals')
    result = dict(inputs=actual, inventory_sha256=digest((FROZEN/'inventory.json').read_bytes()),
                  baseline=baseline, controls=trials, restored_baseline_matches=True,
                  frozen_originals_unchanged=True)
    (PRIVATE/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(baseline=baseline, controls=len(trials), restored=True),indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        with (PRIVATE/'failure-trials.log').open('a') as log:
            log.write(traceback.format_exc()+'\n')
        raise
