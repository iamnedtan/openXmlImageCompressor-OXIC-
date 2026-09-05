#!/usr/bin/env python3
"""Structural validator for OpenXML packages (stdlib only).

Checks the invariants that OXIC could plausibly break when it rewrites a
package -- especially when renaming an image part forces edits to the
relationship files and to [Content_Types].xml.

    python3 test/validate_ooxml.py file.docx [more...]

Exits non-zero and prints every problem it finds.
"""
import sys
import zipfile
import posixpath
import xml.etree.ElementTree as ET

CT_PART = "[Content_Types].xml"
CT_NS = "{http://schemas.openxmlformats.org/package/2006/content-types}"
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

# Leading bytes each image format must start with, keyed by extension.
MAGIC = {
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "gif": [b"GIF87a", b"GIF89a"],
    "bmp": [b"BM"],
    "webp": [b"RIFF"],
}


def is_rels(name):
    return name.startswith("_rels/") or "/_rels/" in name


def resolve(base_dir, target):
    """Resolve a relationship Target against the directory of its owning part."""
    if target.startswith("/"):
        return target[1:]
    return posixpath.normpath(posixpath.join(base_dir, target)).lstrip("./")


def validate(path):
    problems = []
    add = problems.append

    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        return ["not a readable ZIP: %s" % exc]

    with zf:
        bad = zf.testzip()
        if bad:
            add("corrupt entry (CRC mismatch): %s" % bad)

        names = [n for n in zf.namelist() if not n.endswith("/")]
        name_set = set(names)

        if len(names) != len(set(names)):
            add("duplicate part names in the archive")

        # ---- every XML part must parse ----
        xml_parts = [n for n in names if n.lower().endswith((".xml", ".rels"))]
        for name in xml_parts:
            try:
                ET.fromstring(zf.read(name))
            except ET.ParseError as exc:
                add("malformed XML in %s: %s" % (name, exc))

        # ---- content types ----
        if CT_PART not in name_set:
            add("missing %s" % CT_PART)
            defaults, overrides = {}, {}
        else:
            try:
                root = ET.fromstring(zf.read(CT_PART))
            except ET.ParseError as exc:
                return problems + ["malformed %s: %s" % (CT_PART, exc)]
            defaults = {d.get("Extension", "").lower(): d.get("ContentType")
                        for d in root.findall(CT_NS + "Default")}
            overrides = {o.get("PartName", "").lstrip("/"): o.get("ContentType")
                         for o in root.findall(CT_NS + "Override")}

            for part in overrides:
                if part not in name_set:
                    add("[Content_Types].xml Override names a missing part: /%s" % part)

        for name in names:
            if name == CT_PART:
                continue
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if name not in overrides and ext not in defaults:
                add("no content type declared for %s (extension %r)" % (name, ext))

        # ---- relationships ----
        if "_rels/.rels" not in name_set:
            add("missing package relationships part _rels/.rels")

        # A package with no relationships at all parses fine but is meaningless,
        # and would let every downstream check pass vacuously.
        total_rels = 0

        for name in names:
            if not is_rels(name) or not name.endswith(".rels"):
                continue
            base_dir = posixpath.dirname(posixpath.dirname(name))
            try:
                root = ET.fromstring(zf.read(name))
            except ET.ParseError:
                continue  # already reported above

            seen_ids = set()
            found = root.findall(REL_NS + "Relationship")
            total_rels += len(found)
            for rel in found:
                rid = rel.get("Id")
                if rid in seen_ids:
                    add("%s: duplicate relationship Id %s" % (name, rid))
                seen_ids.add(rid)

                if rel.get("TargetMode") == "External":
                    continue
                target = rel.get("Target") or ""
                part = resolve(base_dir, target)
                if part not in name_set:
                    add("%s: relationship %s points at a missing part (Target=%r -> %s)"
                        % (name, rid, target, part))

        if total_rels == 0:
            add("package declares no relationships at all")

        # ---- image payloads ----
        for name in names:
            if "media/" not in name:
                continue
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ext not in MAGIC:
                continue
            head = zf.read(name)[:8]
            if not any(head.startswith(m) for m in MAGIC[ext]):
                add("%s does not look like a %s file (starts %r)" % (name, ext.upper(), head[:4]))

    return problems


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    failed = 0
    for path in argv:
        problems = validate(path)
        if problems:
            failed = 1
            print("FAIL %s" % path)
            for p in problems:
                print("     - %s" % p)
        else:
            print("ok   %s" % path)
    return failed


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
