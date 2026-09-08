#!/usr/bin/env python3
"""Check that a JPEG ends exactly at its EOI marker (stdlib only).

A second, independent walk of the JPEG marker structure, so the stripper is
not the only thing asserting where the still image stops. Reports any bytes
appended after EOI -- which is precisely the motion-photo video clip.

    python3 test/validate_jpeg.py still.jpg [more...]

Exits non-zero if any file is malformed or has data after its EOI.
"""
import sys

SOI, EOI, SOS, TEM = 0xD8, 0xD9, 0xDA, 0x01
STANDALONE = {TEM} | set(range(0xD0, 0xD8))   # TEM and the restart markers


def jpeg_end(data):
    """Offset one past the primary image's EOI. Raises ValueError if malformed."""
    if len(data) < 4 or data[0] != 0xFF or data[1] != SOI:
        raise ValueError("does not start with an SOI marker")

    p = 2
    while p < len(data):
        if data[p] != 0xFF:
            raise ValueError("expected a marker at byte %d" % p)
        while p < len(data) and data[p] == 0xFF:
            p += 1
        if p >= len(data):
            break

        marker = data[p]
        p += 1
        if marker == EOI:
            return p
        if marker in STANDALONE:
            continue

        if p + 2 > len(data):
            raise ValueError("segment header runs past the end of the file")
        length = (data[p] << 8) | data[p + 1]
        if length < 2:
            raise ValueError("bad segment length at byte %d" % p)
        p += length

        if marker == SOS:
            # Skip entropy-coded data: FF00 is an escaped FF, and restart
            # markers are part of the stream.
            while p + 1 < len(data):
                if data[p] == 0xFF and data[p + 1] != 0x00 and data[p + 1] not in STANDALONE:
                    break
                p += 1

    raise ValueError("no EOI marker found")


def validate(path):
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        end = jpeg_end(data)
    except ValueError as exc:
        return ["malformed JPEG: %s" % exc]

    trailing = len(data) - end
    if trailing:
        return ["%d bytes appended after the EOI marker (offset %d of %d)"
                % (trailing, end, len(data))]
    return []


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
