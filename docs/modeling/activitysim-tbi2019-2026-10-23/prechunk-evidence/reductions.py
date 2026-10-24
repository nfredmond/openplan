"""Scan configured source and remove only input fields already excluded by keep_columns."""
import csv
import json
import re
import shutil
from prepare import E, m, MEMORY_R


def prepare_inputs():
    settings = m.yaml.safe_load((m.INPUT/'bundle/configs/settings.yaml').read_text())
    files = {}
    for directory in [m.STOCK, m.INPUT/'bundle/configs']:
        for path in directory.iterdir():
            if path.suffix in {'.yaml', '.csv'}:
                files[path.name] = path
    # Scan every effective config/spec, including unused stock specs, conservatively.
    hits = {}
    hashes = {}
    for name, path in files.items():
        hashes[str(path)] = m.digest(path)
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if line.lstrip().startswith('#'):
                continue
            for token in set(re.findall(r'\b[A-Za-z_]\w*\b', line)):
                hits.setdefault(token, []).append(f'{name}:{number}')
    report = {'config_and_spec_hashes': hashes, 'inputs': {}, 'outcomes_accessed': False}
    for source, name in [(m.INPUT/'inputs-2000', 'inputs-2000'), (MEMORY_R/'inputs-20000', 'inputs-20000'), (m.INPUT/'bundle', 'inputs-full')]:
        dest = m.R/name
        dest.mkdir()
        (dest/'skims').symlink_to(source/'skims')
        for table in settings['input_table_list']:
            src = source/table['filename']
            with src.open(newline='') as stream:
                header = next(csv.reader(stream))
            keep = set(table['keep_columns']) | {table['index_col']}
            removed = [c for c in header if c not in keep]
            if any(hits.get(c) for c in removed):
                raise RuntimeError('Removed field appears in configured expression/spec scan')
            if removed:
                with src.open(newline='') as inp, (dest/src.name).open('x', newline='') as out:
                    reader = csv.reader(inp)
                    writer = csv.writer(out)
                    positions = [i for i, c in enumerate(header) if c in keep]
                    for row in reader:
                        writer.writerow([row[i] for i in positions])
            else:
                (dest/src.name).symlink_to(src)
            report['inputs'][name+'/'+src.name] = {'removed': removed, 'source_sha256': m.digest(src),
                'candidate_sha256': m.digest(dest/src.name), 'fields': {c: hits.get(c, []) for c in header}}
    m.save('input-column-scan.json', report)


if __name__ == '__main__':
    prepare_inputs()
