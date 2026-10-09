"""Logical SQLite source identity, independent of page layout and metadata."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

import model_assignment_network_source as source


def fixture(path):
    """Replace a synthetic test network placeholder with a small SQLite source."""
    path=Path(path);path.unlink(missing_ok=True)
    with sqlite3.connect(path) as connection:
        connection.executescript('''
CREATE TABLE nodes(node_id INTEGER PRIMARY KEY,is_centroid INTEGER,geometry BLOB);
CREATE TABLE links(link_id INTEGER PRIMARY KEY,a_node INTEGER,b_node INTEGER,direction INTEGER,
 modes TEXT,distance REAL,travel_time_ab REAL,travel_time_ba REAL,capacity_ab REAL,capacity_ba REAL,geometry BLOB);
INSERT INTO nodes VALUES(1,1,X'0102'),(2,1,X'0304');
INSERT INTO links VALUES(9,1,2,0,'c',3000,5,5,1000,1000,X'0506');
''')


def prepare_fixture(arguments):
    fixture(arguments['network_path'])
    audit_path=arguments['match_audit_path']
    audit=json.loads(audit_path.read_text())
    import hashlib
    audit['network_sha256']=hashlib.sha256(arguments['network_path'].read_bytes()).hexdigest()
    audit_path.write_text(json.dumps(audit))


class NetworkSourceTests(unittest.TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory();self.addCleanup(directory.cleanup)
        self.path=Path(directory.name)/'network.sqlite';fixture(self.path)

    def change(self,statement):
        with sqlite3.connect(self.path) as connection:connection.execute(statement)

    def test_metadata_and_page_layout_do_not_change_identity(self):
        expected=source.identity(self.path)
        self.change('CREATE TABLE project_notes(note TEXT)')
        self.change("INSERT INTO project_notes VALUES('harmless metadata')")
        with sqlite3.connect(self.path) as connection:connection.execute('VACUUM')
        self.assertEqual(source.identity(self.path),expected)

    def test_node_link_topology_values_and_geometry_changes_are_detected(self):
        original=self.path.read_bytes();expected=source.identity(self.path)
        for statement in ("UPDATE links SET capacity_ab=1001", "UPDATE links SET a_node=2",
                          "UPDATE links SET modes='cw'", "UPDATE links SET geometry=X'0507'",
                          "UPDATE nodes SET is_centroid=0 WHERE node_id=1"):
            with self.subTest(statement=statement):
                self.path.write_bytes(original);self.change(statement)
                self.assertNotEqual(source.identity(self.path),expected)

    def test_column_order_and_row_insertion_order_are_irrelevant(self):
        expected=source.identity(self.path)
        self.change('ALTER TABLE nodes RENAME TO old_nodes')
        self.change('CREATE TABLE nodes(geometry BLOB,is_centroid INTEGER,node_id INTEGER PRIMARY KEY)')
        self.change('INSERT INTO nodes SELECT geometry,is_centroid,node_id FROM old_nodes ORDER BY node_id DESC')
        self.assertEqual(source.identity(self.path),expected)

    def test_duplicate_or_noninteger_ids_refuse(self):
        self.change('ALTER TABLE links RENAME TO old_links')
        self.change('CREATE TABLE links(link_id,capacity REAL)')
        for values in ((1,1),('1','2')):
            self.change('DELETE FROM links')
            with sqlite3.connect(self.path) as connection:
                connection.executemany('INSERT INTO links VALUES(?,1000)',[(value,) for value in values])
            with self.assertRaisesRegex(ValueError,'unique integers'):source.identity(self.path)

    def test_empty_or_view_source_refuses(self):
        self.change('DELETE FROM links')
        with self.assertRaisesRegex(ValueError,'empty'):source.identity(self.path)
        self.change('DROP TABLE links')
        self.change('CREATE VIEW links AS SELECT 1 AS link_id')
        with self.assertRaisesRegex(ValueError,'ordinary'):source.identity(self.path)

    def test_read_does_not_change_database_or_create_sidecars(self):
        before=self.path.read_bytes()
        source.identity(self.path)
        self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(list(self.path.parent.iterdir()),[self.path])

    def test_alias_and_missing_path_refuse_without_creating_database(self):
        alias=self.path.parent/'alias';alias.symlink_to(self.path)
        with self.assertRaisesRegex(ValueError,'unaliased'):source.identity(alias)
        missing=self.path.parent/'missing'
        with self.assertRaises(FileNotFoundError):source.identity(missing)
        self.assertFalse(missing.exists())


if __name__=='__main__':unittest.main()
