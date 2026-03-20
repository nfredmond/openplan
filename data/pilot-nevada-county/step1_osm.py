#!/usr/bin/env python3
"""Step 1: Create AequilibraE project from OSM. Run once, then use step2_assign.py."""
import os, shutil, string
from typing import Tuple
from shapely.geometry import box

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.project.network.osm.osm_builder import OSMBuilder

# Patch OSM builder for link-type-ID collision
def patched_define_link_type(self, link_type: str) -> Tuple[str, str]:
    proj_link_types = self.project.network.link_types
    original_link_type = link_type
    link_type = "".join([x for x in link_type if x in string.ascii_letters + "_"]).lower()
    split = link_type.split("_")
    for i, piece in enumerate(split[1:]):
        if piece in ["link", "segment", "stretch"]:
            link_type = "_".join(split[0 : i + 1])
    if self._OSMBuilder__all_ltp.shape[0] >= 51:
        link_type = "aggregate_link_type"
    if len(link_type) == 0:
        link_type = "empty"
    if link_type in self._OSMBuilder__all_ltp.link_type.values:
        lt = proj_link_types.get_by_name(link_type)
        if lt is not None:
            if original_link_type not in lt.description:
                lt.description += f", {original_link_type}"
                lt.save()
            return [lt.link_type_id, link_type]
    letter = link_type[0]
    if letter in self._OSMBuilder__all_ltp.link_type_id.values:
        letter = letter.upper()
        if letter in self._OSMBuilder__all_ltp.link_type_id.values:
            for letter in string.ascii_letters:
                if letter not in self._OSMBuilder__all_ltp.link_type_id.values:
                    break
    try:
        lt = proj_link_types.new(letter)
        lt.link_type = link_type
        lt.description = f"OSM: {original_link_type}"
        lt.save()
    except Exception:
        lt = proj_link_types.get(letter)
        if lt is not None:
            lt.link_type = link_type
            lt.description = f"OSM: {original_link_type}"
            lt.save()
    return [letter, link_type]

OSMBuilder._OSMBuilder__define_link_type = patched_define_link_type

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PROJ_DIR = os.path.join(DATA_DIR, "aeq_project")

if os.path.exists(PROJ_DIR):
    shutil.rmtree(PROJ_DIR)

project = Project()
project.new(PROJ_DIR)
model_area = box(-121.30, 39.00, -120.00, 39.50)
project.network.create_from_osm(model_area=model_area, modes=["car"], clean=True)

import sqlite3
conn = sqlite3.connect(os.path.join(PROJ_DIR, "project_database.sqlite"))
n = conn.execute("SELECT count(*) FROM nodes").fetchone()[0]
l = conn.execute("SELECT count(*) FROM links").fetchone()[0]
conn.close()

project.close()
print(f"\n✅ OSM project created: {n} nodes, {l} links")
print(f"   Path: {PROJ_DIR}")
