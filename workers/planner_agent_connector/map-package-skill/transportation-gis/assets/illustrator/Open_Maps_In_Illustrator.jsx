/*
  Open_Maps_In_Illustrator.jsx

  Opens every SVG figure in ../maps/svg and every map book sheet in ../atlas/svg, turns the map layers into real Illustrator layers
  with readable names, and saves an editable .ai file for each in illustrator/ai.

  Run it from Illustrator: File > Scripts > Other Script... and pick this file.
  Install the fonts in ../fonts/inter first, or Illustrator will ask to substitute them.

  What you get in each .ai file
    - One layer per map layer (roads, bikeways, labels and so on), in drawing order.
    - Live, editable type. Labels that follow curved roads are one text object per letter.
    - Artboard at the final page size.
  The original SVG and PDF files are not changed.
*/
#target illustrator

(function () {
    var here = new File($.fileName).parent;            // .../illustrator
    var svgFolder = new Folder(here.parent.fsName + "/maps/svg");
    var outFolder = new Folder(here.fsName + "/ai");
    if (!svgFolder.exists) { alert("Cannot find the maps/svg folder beside the illustrator folder."); return; }
    if (!outFolder.exists) { outFolder.create(); }
    var files = svgFolder.getFiles("*.svg");
    var bookFolder = new Folder(here.parent.fsName + "/atlas/svg");      // map book sheets, one SVG per sheet
    if (bookFolder.exists) { files = files.concat(bookFolder.getFiles("*.svg")); }
    if (files.length === 0) { alert("No SVG files found in " + svgFolder.fsName); return; }

    var names = {};                                     // id -> readable layer name, written by the package builder
    var nameFile = new File(here.fsName + "/layer_names.json");
    if (nameFile.exists) {
        nameFile.encoding = "UTF-8"; nameFile.open("r");
        try { names = eval("(" + nameFile.read() + ")"); } catch (e) { names = {}; }
        nameFile.close();
    }

    function readable(raw) {
        if (names[raw]) { return names[raw]; }
        // Illustrator writes characters it cannot keep in an id as _xHH_.
        var s = String(raw).replace(/_x([0-9A-Fa-f]{2})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
        return s.replace(/_/g, " ");
    }

    function promote(doc) {
        var base = doc.layers[0];
        // Step down through wrapper groups that hold everything.
        var holder = base;
        while (holder.groupItems.length === 1 && holder.pageItems.length === 1) { holder = holder.groupItems[0]; }
        var groups = [];
        for (var i = 0; i < holder.groupItems.length; i++) { groups.push(holder.groupItems[i]); }
        // The last group is the bottom of the stack. Adding layers puts each new one on top,
        // so work from the bottom up to keep the drawing order.
        for (var j = groups.length - 1; j >= 0; j--) {
            var g = groups[j];
            if (g.pageItems.length === 0) { continue; }
            var layer = doc.layers.add();
            layer.name = readable(g.name) || ("Layer " + (groups.length - j));
            g.move(layer, ElementPlacement.PLACEATBEGINNING);
        }
        if (base.pageItems.length === 0) { base.remove(); } else { base.name = "Page furniture"; }
    }

    var done = 0, failed = [];
    for (var f = 0; f < files.length; f++) {
        try {
            var doc = app.open(files[f]);
            promote(doc);
            var out = new File(outFolder.fsName + "/" + files[f].name.replace(/\.svg$/i, ".ai"));
            var opts = new IllustratorSaveOptions();
            opts.pdfCompatible = true;
            opts.embedICCProfile = true;
            doc.saveAs(out, opts);
            done++;
        } catch (err) {
            failed.push(files[f].name + ": " + err);
        }
    }
    alert(done + " of " + files.length + " figures saved to " + outFolder.fsName + (failed.length ? "\n\nProblems:\n" + failed.join("\n") : ""));
})();
