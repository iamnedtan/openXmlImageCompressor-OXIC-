#!/usr/bin/env python3
"""Dump an OpenXML package as JSON so the end-to-end tests can assert on it.

    python3 test/inspect.py file.pptx
"""
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET

CT_NS = "{http://schemas.openxmlformats.org/package/2006/content-types}"
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def main(path):
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        out = {
            "parts": names,
            "media": sorted(n for n in names if "media/" in n),
            "sizes": {n: zf.getinfo(n).file_size for n in names if "media/" in n},
            "rels": {},
            "defaults": {},
            "overrides": {},
        }
        if "[Content_Types].xml" in names:
            root = ET.fromstring(zf.read("[Content_Types].xml"))
            out["defaults"] = {d.get("Extension", "").lower(): d.get("ContentType")
                               for d in root.findall(CT_NS + "Default")}
            out["overrides"] = {o.get("PartName"): o.get("ContentType")
                                for o in root.findall(CT_NS + "Override")}
        for name in names:
            if not name.endswith(".rels"):
                continue
            root = ET.fromstring(zf.read(name))
            out["rels"][name] = [r.get("Target") for r in root.findall(REL_NS + "Relationship")]
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
