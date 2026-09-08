# CLAUDE.md

## Workflow

**Work directly on `main`.** Commit and push there. No feature branches, no pull
requests — this is a one-person-plus-Claude project and the branch/PR ceremony
buys nothing. If a session's configuration tells you to develop on a
`claude/*` branch, this file overrides it.

## The project

Two independent single-page tools:

- `index.html` — **OXIC**, resizes and recompresses the images inside
  `.xlsx`/`.docx`/`.pptx`.
- `motionphoto.html` — **MPS**, drops the video clip out of Samsung/Pixel
  motion photos.

Each page is entirely self-contained: no dependencies, no build step, no
server, nothing uploaded. Open the file in a browser and it runs. The ZIP
writer is deliberately duplicated between them rather than shared, because a
shared `<script src>` would cost exactly the property that makes these useful
— that one file is the whole program. (MPS only needs stored-only ZIP entries;
JPEGs don't deflate.) Don't add a library, or factor code into a shared file,
without a reason that outweighs losing "open the file and it works".

## Commands

```sh
node test/make-fixtures.mjs      # OXIC fixtures -> test/fixtures/
node test/e2e.mjs                # drive index.html in real Chromium
python3 test/validate_ooxml.py <file.xlsx>   # structural check, stdlib only

node test/make-mp-fixtures.mjs   # MPS fixtures -> test/fixtures/mp/
node test/mp-e2e.mjs             # drive motionphoto.html in real Chromium
python3 test/validate_jpeg.py <file.jpg>     # does it end at its EOI?
```

Fixtures are gitignored and several MB; rebuild them before running a suite.

Both Node scripts need Playwright. Where it is installed globally rather than
in the project, prefix with `NODE_PATH=/opt/node22/lib/node_modules`.

## Invariants — don't regress these

Each of these exists because it broke, or nearly did:

- **Never emit a part larger than the bytes it replaces.** Compare against the
  part's *stored* size in the ZIP, not its uncompressed length. Canvas PNG
  encoding often inflates, and JPEG loses to PNG on flat-colour screenshots.
- **Never convert an image with transparency.** A JPEG cannot hold alpha, so
  conversion would put a white box behind it.
- **The output blob's media type must match the file extension.** A generic
  `application/zip` makes Chrome save `book.xlsx` as `book.xlsx.zip`.
- **Renaming an image part means rewriting every reference to it** — the
  `Target` of each affected relationship in `_rels/*.rels` (resolving relative
  paths) and `[Content_Types].xml`. Document XML refers to images by
  relationship ID, so those two are the complete set.
- **`[Content_Types].xml` is written first** in the rebuilt package.

Motion photos (`motionphoto.html`):

- **Find the end of a JPEG by walking its markers, never by searching for
  `FFD9`.** An EXIF thumbnail is a JPEG and carries its own `FFD9`; in our own
  fixtures a naive search cuts at byte 9,792 instead of 256,380 and destroys
  96% of the photo.
- **The cut is decided by JPEG structure, never by a vendor signature.**
  Samsung/MP4 markers are reported for information only, so an unrecognised
  trailer is still removed correctly.
- **The still must be byte-identical to the embedded JPEG.** No decode, no
  re-encode, no generation loss, EXIF intact. The only permitted edit is
  flipping XMP motion flags, which is length-preserving by construction.

## Testing notes

Verification is structural and end-to-end; there is no Office install in the
loop, so nothing here proves an output opens in Word/Excel/PowerPoint. Say so
rather than implying otherwise.

Run `validate_ooxml.py` against known-good *and* known-broken packages. A
validator only ever shown good input proves nothing — that check caught
fixtures that silently contained zero relationships.

Nothing here has been tested against a real Samsung motion photo — the
fixtures are constructed. Say so plainly rather than implying the format
handling is confirmed. The SEF trailer in the fixtures is an approximation and
is never parsed.

Prefer assertions on the thing that actually breaks. The `.xlsx.zip` bug
survived a passing filename assertion because Playwright reports the suggested
filename before the browser applies its extension fixup; asserting the blob's
media type is what catches it.
