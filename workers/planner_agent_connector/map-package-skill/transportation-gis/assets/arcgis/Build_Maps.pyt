# -*- coding: utf-8 -*-
"""ArcGIS Pro Python toolbox for this map package.

Add this file in the Catalog pane (Toolboxes > Add Toolbox). It holds two tools:
  Build project and layouts   builds the .aprx, geodatabase, maps, layouts and exports
  Check package (preflight)   checks the package data against the spec without building
Both call build_arcgis_pro.py, which sits beside this file.
"""
import importlib.util
import json
from pathlib import Path

import arcpy


def _builder():
    path = Path(__file__).resolve().parent / "build_arcgis_pro.py"
    spec = importlib.util.spec_from_file_location("tgis_native_builder", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _root_param():
    p = arcpy.Parameter(displayName="Package folder (holds spec, data and maps)", name="package_folder",
                        datatype="DEFolder", parameterType="Required", direction="Input")
    p.value = str(Path(__file__).resolve().parents[1])
    return p


def _true(param):
    return str(param.valueAsText).lower() == "true"


class Toolbox:
    def __init__(self):
        self.label = "Transportation map package"
        self.alias = "tgismaps"
        self.tools = [BuildProject, CheckPackage]


class BuildProject:
    def __init__(self):
        self.label = "Build project and layouts"
        self.description = ("Creates a new ArcGIS Pro project in a dated folder under arcgis/native with one map and one layout per "
                            "figure, a file geodatabase, layer files and PDF, PNG and AIX exports. The open project is not changed.")

    def getParameterInfo(self):
        export = arcpy.Parameter(displayName="Export PDF and PNG", name="export", datatype="GPBoolean", parameterType="Optional", direction="Input")
        export.value = True
        aix = arcpy.Parameter(displayName="Export AIX for Adobe Illustrator", name="export_aix", datatype="GPBoolean", parameterType="Optional", direction="Input")
        aix.value = True
        only = arcpy.Parameter(displayName="Only these map ids (blank for all, separate with commas)", name="only", datatype="GPString", parameterType="Optional", direction="Input")
        out = arcpy.Parameter(displayName="Project file", name="out_project", datatype="DEFile", parameterType="Derived", direction="Output")
        return [_root_param(), export, aix, only, out]

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        return

    def updateMessages(self, parameters):
        return

    def execute(self, parameters, messages):
        b = _builder()
        root = parameters[0].valueAsText
        only = [s.strip() for s in (parameters[3].valueAsText or "").split(",") if s.strip()] or None
        arcpy.AddMessage("Building from " + root)
        target = b.build(root, template="CURRENT", export=_true(parameters[1]), export_aix=_true(parameters[2]), only=only)
        arcpy.AddMessage("Built " + target)
        arcpy.AddMessage("Open it with Project > Open, then Save As to a folder of your own.")
        parameters[4].value = target

    def postExecute(self, parameters):
        return


class CheckPackage:
    def __init__(self):
        self.label = "Check package (preflight)"
        self.description = "Checks that every layer, field and filter named in the spec exists in the package data. Builds nothing."

    def getParameterInfo(self):
        return [_root_param()]

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        return

    def updateMessages(self, parameters):
        return

    def execute(self, parameters, messages):
        res = _builder().preflight(parameters[0].valueAsText)
        arcpy.AddMessage(json.dumps({k: v for k, v in res.items() if k != "inputs"}, indent=2))
        if res["errors"]:
            for e in res["errors"]:
                arcpy.AddError(e)
            raise arcpy.ExecuteError("Preflight found %d problem(s)." % len(res["errors"]))

    def postExecute(self, parameters):
        return
