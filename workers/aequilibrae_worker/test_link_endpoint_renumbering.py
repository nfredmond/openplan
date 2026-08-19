"""Regression proof for collision-free retained-network node renumbering."""

import sqlite3
import unittest

from main import _renumber_nodes


class LinkEndpointRenumberingTest(unittest.TestCase):
    def test_permutation_does_not_rewrite_an_endpoint_twice(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE nodes (node_id INTEGER PRIMARY KEY)")
        conn.execute("CREATE TABLE links (link_id INTEGER, a_node INTEGER, b_node INTEGER)")
        conn.execute(
            "CREATE TRIGGER aequilibrae_updated_node_id AFTER UPDATE OF node_id ON nodes "
            "BEGIN UPDATE links SET a_node=new.node_id WHERE a_node=old.node_id; "
            "UPDATE links SET b_node=new.node_id WHERE b_node=old.node_id; END"
        )
        conn.executemany("INSERT INTO nodes VALUES (?)", [(10,), (20,), (30,)])
        conn.executemany(
            "INSERT INTO links VALUES (?, ?, ?)",
            [(1, 10, 20), (2, 20, 30), (3, 30, 10)],
        )

        _renumber_nodes(conn, {10: 20, 20: 30, 30: 10})

        self.assertEqual(
            conn.execute("SELECT link_id, a_node, b_node FROM links ORDER BY link_id").fetchall(),
            [(1, 20, 30), (2, 30, 10), (3, 10, 20)],
        )


if __name__ == "__main__":
    unittest.main()
