"""QGIS Processing script: rebuild this package's QGIS project and exports from spec/map_package.json.

Add it in QGIS with Processing > Toolbox > Scripts (the Python icon) > Add Script to Toolbox, then
run "Rebuild map package". Run it in a fresh QGIS session: the rebuild replaces the open project.
(The Processing entry point follows the idea in GPT-6-Astra's qgis_tool.py; it calls this package's own builder.)
"""
from pathlib import Path

from qgis.core import QgsProcessingAlgorithm, QgsProcessingParameterBoolean, QgsProcessingParameterFile


class RebuildMapPackage(QgsProcessingAlgorithm):
    def name(self):
        return "rebuild_map_package"

    def displayName(self):
        return "Rebuild map package"

    def group(self):
        return "Transportation planning"

    def groupId(self):
        return "transportation_planning"

    def shortHelpString(self):
        return ("Choose the package folder (the one holding spec, data and maps). Rebuilds qgis/<project>.qgz, the styles and "
                "layout templates and, if export is ticked, every PDF, PNG and SVG. This clears the project that is open, "
                "so tick the confirmation box only in a session with nothing unsaved.")

    def createInstance(self):
        return RebuildMapPackage()

    def flags(self):
        return super().flags() | QgsProcessingAlgorithm.FlagNoThreading

    def initAlgorithm(self, config=None):
        self.addParameter(QgsProcessingParameterFile("ROOT", "Package folder", behavior=QgsProcessingParameterFile.Folder))
        self.addParameter(QgsProcessingParameterBoolean("EXPORT", "Export PDF, PNG and SVG", defaultValue=True))
        self.addParameter(QgsProcessingParameterBoolean("CONFIRM", "Replace the open QGIS project (nothing unsaved is open)", defaultValue=False))

    def processAlgorithm(self, parameters, context, feedback):
        if not self.parameterAsBool(parameters, "CONFIRM", context):
            raise Exception("Tick the confirmation box. The rebuild replaces the project that is open in QGIS.")
        root = Path(self.parameterAsFile(parameters, "ROOT", context)).resolve()
        script = root / "qgis" / "build_qgis_project.py"
        scope = {"__name__": "tgis_package_builder", "__file__": str(script)}
        exec(compile(script.read_text(encoding="utf-8"), str(script), "exec"), scope)
        report = scope["build"](root, export=self.parameterAsBool(parameters, "EXPORT", context), log=feedback.pushInfo)
        feedback.pushInfo("Built " + report.get("project", ""))
        return {"PROJECT": str(root / report.get("project", ""))}
