#!/usr/bin/env python3
"""Prepare Finale support files outside the MIT repository; never publish automatically."""
# Copyright 2026 Robert G. Patterson.
# SPDX-License-Identifier: MIT

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import xml.etree.ElementTree as ET


def prepare(args):
    root = Path(__file__).resolve().parent.parent
    output = args.output.resolve()
    if output == root or root in output.parents:
        raise ValueError('Resource output must be outside the denigma-online repository.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Resource output directory must be empty.')
    shared = args.shared.resolve()
    converter = args.application.resolve() / 'Contents/PlugIns/2012FileConverter.bundle/Contents/Resources'
    output.mkdir(parents=True, exist_ok=True)
    files = []

    def record(kind, name, contents, source, source_contents=None):
        path = f'{args.version}/{name}'
        target = output / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents)
        files.append(dict(kind=kind, name=name, path=path, size=len(contents),
                          sha256=hashlib.sha256(contents).hexdigest(), source=source,
                          sourceSha256=hashlib.sha256(source_contents or contents).hexdigest()))

    def copy(kind, path, source):
        record(kind, path.name, path.read_bytes(), source)

    copy(0, shared / 'Configuration Files/MacSymbolFonts.txt', 'Finale 27/Configuration Files/MacSymbolFonts.txt')
    for name in ['General MIDI.xml', 'SmartMusic SoftSynth.xml',
                 'Garritan Instruments for Finale.xml', 'Tapspace Drumline for Finale.xml']:
        copy(1, shared / 'MIDI Device Annotation' / name, f'Finale 27/MIDI Device Annotation/{name}')
    copy(2, shared / 'Configuration Files/PercMapConversionTable.txt', 'Finale 27/Configuration Files/PercMapConversionTable.txt')
    for name in ['2012FileConverterGeneralMIDI.soundmap', '2012FileConverterSoftSynth.soundmap']:
        copy(3, converter / name, f'Finale.app/Contents/PlugIns/2012FileConverter.bundle/Contents/Resources/{name}')
    copy(3, shared / 'Data/GIFF.soundmap', 'Finale 27/Data/GIFF.soundmap')

    database = converter / '2012FileConverter.instruments'
    catalog = ET.Element('InstrumentCatalog')
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        rows = connection.execute('''
            SELECT i.instrument_uuid, i.instrument_name,
                   COALESCE(NULLIF(n.full_name, ''), i.instrument_name),
                   i.clef_1, i.notation_style, i.transposition
            FROM instruments i
            LEFT JOIN staff_or_group_names n ON n.instrument_id = i.instrument_id
                AND n.locale_id = (SELECT locale_id FROM locales WHERE locale_code = 'en' LIMIT 1)
            ORDER BY i.instrument_id
        ''')
        for row in rows:
            if any(value is None or str(value).strip() == '' for value in row):
                raise ValueError(f'Incomplete instrument catalog row: {row[0]}')
            ET.SubElement(catalog, 'Instrument', dict(zip(
                ['uuid', 'name', 'fullName', 'clef', 'notation', 'transposition'], map(str, row))))
    if not len(catalog):
        raise ValueError('The instrument catalog is empty.')
    record(4, 'InstrumentCatalog.xml', ET.tostring(catalog, encoding='utf-8', xml_declaration=True),
           'Finale.app/Contents/PlugIns/2012FileConverter.bundle/Contents/Resources/2012FileConverter.instruments',
           database.read_bytes())
    manifest = output / 'manifest.json'
    manifest.write_text(json.dumps(dict(version=args.version, files=files), indent=2) + '\n')
    (output / 'NOTICE.txt').write_text(
        'Finale support data from MakeMusic Finale 27. These files are not covered by '
        'denigma-online\'s MIT license. This notice does not grant redistribution rights.\n')
    subprocess.run(['node', str(root / 'scripts/validate-mus-resources.mjs'),
                    str(args.module.resolve()), str(args.wasm.resolve()), str(manifest)], check=True)
    print(f'Validated resource set: {output}\nCopy only manifest.json into config/mus-resources.json; ZIP the output contents and host the archive separately.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', type=Path, required=True, help='Path to Finale.app')
    parser.add_argument('--shared', type=Path, required=True, help='System-wide Finale 27 support directory')
    parser.add_argument('--output', type=Path, required=True, help='Empty directory outside this repository')
    parser.add_argument('--version', required=True, help='Immutable resource version, e.g. finale27-v1')
    parser.add_argument('--module', type=Path, required=True, help='Denigma JavaScript module')
    parser.add_argument('--wasm', type=Path, required=True, help='Denigma WASM binary')
    args = parser.parse_args()
    if not args.version or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in args.version):
        parser.error('Version must contain only letters, digits, hyphens, and underscores.')
    prepare(args)
