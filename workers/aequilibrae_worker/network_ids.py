"""Database-safe AequilibraE network identifier operations."""

import sqlite3


def renumber_nodes(conn: sqlite3.Connection, remap: dict[int, int]) -> None:
    """Apply a node-id permutation; AequilibraE's node trigger moves links."""
    for old, new in remap.items():
        if old != new:
            conn.execute("UPDATE nodes SET node_id=? WHERE node_id=?", (-new, old))
    conn.execute("UPDATE nodes SET node_id=-node_id WHERE node_id<0")
