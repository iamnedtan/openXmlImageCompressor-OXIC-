# OXIC

Two single-page tools for making photo-heavy files smaller. Neither has any
dependencies, build step or server: open the `.html` file in a browser and it
runs, and nothing you drop into either one leaves your machine.

| | |
|---|---|
| [`index.html`](index.html) | **OpenXML Image Compressor** — resize and recompress the images inside `.xlsx`/`.docx`/`.pptx` |
| [`motionphoto.html`](motionphoto.html) | **Motion Photo Stripper** — drop the video clip out of Samsung/Pixel motion photos |

---

# OXIC — OpenXML Image Compressor

A single-page web app that opens an Office file (`.xlsx`, `.docx`, `.pptx`), shows how much of
its bulk is embedded images, and writes back a smaller copy.

Office files are ZIP containers, and the bloat is almost always in one `media/` folder holding
images at camera or screenshot resolution even though they render at a fraction of that size.
OXIC resizes and recompresses those images and repacks the package, leaving everything else
byte-for-byte alone.

**Open `index.html` in a browser.** There is no build step, no server, no install and no
dependencies — and your file never leaves the machine.

![OXIC](docs/screenshot.png)

## What it does

1. **Reads any OpenXML file** — `.xlsx .xlsm .xltx`, `.docx .docm .dotx`, `.pptx .pptm .potx`.
2. **Reports** the total file size, the media folder it found, how many images are in it, how
   much space they take and what share of the file that is, plus a per-image breakdown.
3. **Offers resize, compress, or both**, and shows the resulting size. The figure is not a
   guess: every image is really re-encoded with your current settings, so what you see is what
   you get.
4. **Saves** the rebuilt file as `<name>-compressed.<ext>` (the suffix is editable).

### Options

| Option | Notes |
|---|---|
| **Resize / Compress / Both** | Resizing still re-encodes, so it does so at near-original quality. |
| **Max dimension** | Downscales only images whose longest side exceeds the limit. Smaller images are untouched. |
| **Percentage** | Scales every image by a fixed percentage. |
| **Quality** | JPEG and WebP encoding quality. 75 is a sensible default. |
| **Convert opaque PNG/BMP to JPEG** | Off by default. Usually the biggest single win. |
| **Output suffix** | Defaults to `-compressed`. |

## Two rules it never breaks

**It never makes anything bigger.** If a re-encoded image would take at least as much space as
the original, the original bytes are kept and the row is marked *kept — no saving*. This matters
because canvas PNG encoding frequently inflates files, and JPEG loses to PNG on flat-colour
screenshots.

**It never converts an image with transparency.** Turning a transparent PNG into a JPEG would
put a white box behind it. PNGs are checked via their header colour type and `tRNS` chunk, and
where that is inconclusive, by a full alpha-channel scan.

## PNG → JPEG conversion

Renaming an image part means every reference to it has to move too, or Office rejects the file.
When the option is on, OXIC:

- renames the part to `.jpeg` (picking a free name if one is taken);
- rewrites the `Target` of every affected relationship in each `_rels/*.rels`, resolving
  relative paths so `../media/image2.png` becomes `../media/image2.jpeg`;
- adds `<Default Extension="jpeg" ContentType="image/jpeg"/>` to `[Content_Types].xml` and
  follows any `Override` that named the renamed part.

Document XML references images by relationship ID rather than filename, so relationships and
content types are the complete set of places that need touching.

## What it leaves alone

- **Audio and video** in `ppt/media/` — listed, never modified.
- **EMF, WMF, SVG, TIFF and ICO** — the browser can't re-encode them, so they pass through.
- **GIF** — passed through, because re-encoding would flatten any animation.
- Every part outside `media/`.

## Requirements

A browser with `CompressionStream('deflate-raw')` and `OffscreenCanvas`: Chrome 103+,
Firefox 113+, Safari 16.4+. ZIP64 archives (over 4 GB) are not supported.

## Tests

Verification is structural and end-to-end — there is no Office install in the loop.

```sh
# Build the fixtures: three OpenXML files carrying the same four images.
node test/make-fixtures.mjs

# Drive index.html in a real Chromium and validate everything it produces.
node test/e2e.mjs

# Validate any OpenXML package on its own.
python3 test/validate_ooxml.py test/fixtures/sample.pptx
```

Both Node scripts need Playwright. If it is installed globally rather than in the project,
prefix them with `NODE_PATH=/opt/node22/lib/node_modules`.

`validate_ooxml.py` (stdlib only) checks that the ZIP opens and passes CRC, that every XML part
parses, that every non-external relationship `Target` resolves to a part that exists, that every
part has a declared content type, and that image bytes match their extension. Running it against
the fixtures as well as the outputs keeps it honest — a validator that only ever sees good input
proves nothing.

`e2e.mjs` covers all three formats: the reported counts and sizes against the parts on disk,
both resize modes, each of the three actions, the PNG→JPEG rename propagating into the
relationships and content types, transparent and unbeatable PNGs being left alone, a file with
no images, a file that is not a ZIP, and re-processing an output without corrupting or growing
it.


---

# MPS — Motion Photo Stripper

`motionphoto.html`. A Samsung or Pixel motion photo is an ordinary JPEG with a
video clip glued onto the end. This finds where the still image really stops
and drops everything after it, in a batch.

![MPS](docs/screenshot-motionphoto.png)

Drop one file or a whole folder. It reports what each file contains and how
many bytes the clip is, then hands back a single `.jpg` or, for a batch, one
ZIP of stills.

## How the cut is decided

By walking the JPEG's own marker structure to its EOI — **not** by searching
for the `FFD9` byte pair, and not by parsing any vendor's trailer format.

Searching for `FFD9` is the obvious approach and it is badly wrong: an EXIF
thumbnail is itself a JPEG, carrying its own `FFD9` inside an APP1 segment.
In this project's own fixtures the first `FFD9` appears at byte 9,792 while
the still actually ends at byte 256,380 — a naive search would throw away 96%
of the photo.

Deciding the cut from the JPEG structure rather than from a vendor signature
also means an unrecognised trailer is still removed correctly. Samsung's
`MotionPhoto_Data` and SEF markers, and MP4's `ftyp`, are detected and
reported, but nothing depends on them.

## What is preserved

The still is **byte-identical** to the JPEG the phone embedded. Nothing is
decoded or re-encoded, so there is no generation loss, and EXIF — dates, GPS,
camera settings, orientation — comes through untouched because it sits in
front of the image data, not after it.

Re-encoding tools (Windows PowerToys Image Resizer, for one) also drop the
clip, as a side effect of only ever reading the JPEG portion. Truncation gets
to the same place without recompressing the photo.

The one optional edit is **clearing motion-photo flags in XMP**: with the clip
gone, a leftover `GCamera:MotionPhoto="1"` is untrue and can make a gallery
show a play button for a video that no longer exists. Only the flag's value
byte changes, so segment lengths stay valid. `MotionPhotoVersion` and other
non-boolean fields are left alone. Turn it off to get a pure truncation.

## Tests

```sh
node test/make-mp-fixtures.mjs   # build test/fixtures/mp/
node test/mp-e2e.mjs             # drive motionphoto.html in real Chromium
python3 test/validate_jpeg.py <file.jpg>   # does this JPEG end at its EOI?
```

The fixtures embed a real EXIF thumbnail, so the `FFD9` trap above is exercised
on every run. Each fixture is built by concatenating a known still with a known
trailer, and the suite asserts the output is byte-identical to that still —
the strongest available check that the cut lands in exactly the right place.
`validate_jpeg.py` is a second, independent implementation of the marker walk
in Python, and the suite confirms it *rejects* the untouched inputs as well as
accepting the outputs.

### Known limits

- **Not tested against a real Samsung file.** No phone was involved: the
  fixtures are constructed. The cut is standards-based rather than a guess at
  Samsung's layout, which is exactly why it should hold — but that is
  reasoning, not evidence. Try it on a real motion photo before trusting it
  with your camera roll.
- The SEF trailer in the fixtures is an **approximation** of Samsung's real
  layout, present only so signature detection has something to find. Nothing
  parses it.
- Progressive JPEGs are handled by design (multiple SOS segments) but are not
  in the fixture set, because the tools available here only emit baseline JPEG.
