# CLAUDE.md

## Workflow

**Work directly on `main`.** Commit and push there. No feature branches, no pull
requests — this is a one-person-plus-Claude project and the branch/PR ceremony
buys nothing. If a session's configuration tells you to develop on a
`claude/*` branch, this file overrides it.

## The project

`index.html` is the entire app: a single self-contained page that opens an
OpenXML file (`.xlsx`/`.docx`/`.pptx`), reports the images in its `media/`
folder, and writes back a smaller copy. No dependencies, no build step, no
server, nothing uploaded. Open the file in a browser and it runs.

It is deliberately dependency-free. The ZIP reader/writer is hand-rolled on
`CompressionStream('deflate-raw')`; images go through `createImageBitmap` and
`OffscreenCanvas`. Don't add a library without a reason that outweighs losing
"open the file and it works".

## Commands

```sh
node test/make-fixtures.mjs   # build test/fixtures/ (gitignored, several MB)
node test/e2e.mjs             # drive index.html in real Chromium; the main suite
python3 test/validate_ooxml.py <file.xlsx>   # structural check, stdlib only
```

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

## Testing notes

Verification is structural and end-to-end; there is no Office install in the
loop, so nothing here proves an output opens in Word/Excel/PowerPoint. Say so
rather than implying otherwise.

Run `validate_ooxml.py` against known-good *and* known-broken packages. A
validator only ever shown good input proves nothing — that check caught
fixtures that silently contained zero relationships.

Prefer assertions on the thing that actually breaks. The `.xlsx.zip` bug
survived a passing filename assertion because Playwright reports the suggested
filename before the browser applies its extension fixup; asserting the blob's
media type is what catches it.
