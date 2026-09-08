// Builds test/fixtures/mp/: motion-photo-shaped JPEGs for the stripper tests,
// plus a manifest naming the exact still each one should reduce to.
//
//   NODE_PATH=/opt/node22/lib/node_modules node test/make-mp-fixtures.mjs
//
// The appended "video" is a real MP4 box structure (ftyp + mdat) whose mdat
// payload is random filler. The stripper never decodes the clip -- it only
// measures it and reports the signature -- so filler is honest here, and it
// keeps the fixtures independent of whatever ffmpeg build is around.
//
// The SEF trailer below is an APPROXIMATION of Samsung's real layout, included
// only so signature detection has something to find. Nothing in the stripper
// parses it: the cut is decided by the JPEG marker structure alone. Do not
// treat these fixtures as evidence about Samsung's actual trailer format.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPlaywright } from './playwright.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mp');

/* ---------- JPEG pieces ---------- */

async function renderJpegs() {
  const browser = await loadPlaywright().chromium.launch();
  const page = await browser.newPage();
  const out = await page.evaluate(() => {
    const draw = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#20313f'); g.addColorStop(0.5, '#d98c3f'); g.addColorStop(1, '#f4ead6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `rgba(${(i * 53) % 256},${(i * 97) % 256},${(i * 29) % 256},0.4)`;
        ctx.beginPath();
        ctx.arc((i * 811) % w, (i * 379) % h, 1 + (i % 6), 0, Math.PI * 2);
        ctx.fill();
      }
      return c.toDataURL('image/jpeg', 0.9);
    };
    return { main: draw(1600, 1200), thumb: draw(160, 120) };
  });
  await browser.close();
  const decode = url => Buffer.from(url.split(',')[1], 'base64');
  return { main: decode(out.main), thumb: decode(out.thumb) };
}

function app1(payload) {
  const seg = Buffer.alloc(4 + payload.length);
  seg.writeUInt16BE(0xFFE1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

function writeEntry(buf, at, tag, type, count, value) {
  buf.writeUInt16LE(tag, at);
  buf.writeUInt16LE(type, at + 2);
  buf.writeUInt32LE(count, at + 4);
  if (type === 3) buf.writeUInt16LE(value, at + 8);   // SHORT sits in the low half
  else buf.writeUInt32LE(value, at + 8);
}

/**
 * An EXIF APP1 carrying a thumbnail in IFD1. This is the important fixture
 * detail: the thumbnail is a JPEG, so its own FFD8...FFD9 sits inside this
 * segment. Anything that finds the end of a motion photo by searching for the
 * FFD9 byte pair will cut here and destroy the image.
 */
function buildExif(thumb) {
  const make = Buffer.from('samsung\0', 'ascii');
  const IFD0 = 8, MAKE_AT = 26, IFD1 = 34, THUMB_AT = 76;
  const tiff = Buffer.alloc(THUMB_AT + thumb.length);

  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(IFD0, 4);

  tiff.writeUInt16LE(1, IFD0);
  writeEntry(tiff, IFD0 + 2, 0x010F, 2, make.length, MAKE_AT);   // Make
  tiff.writeUInt32LE(IFD1, IFD0 + 2 + 12);                       // -> IFD1
  make.copy(tiff, MAKE_AT);

  tiff.writeUInt16LE(3, IFD1);
  writeEntry(tiff, IFD1 + 2,      0x0103, 3, 1, 6);              // Compression = JPEG
  writeEntry(tiff, IFD1 + 2 + 12, 0x0201, 4, 1, THUMB_AT);       // thumbnail offset
  writeEntry(tiff, IFD1 + 2 + 24, 0x0202, 4, 1, thumb.length);   // thumbnail length
  tiff.writeUInt32LE(0, IFD1 + 2 + 36);
  thumb.copy(tiff, THUMB_AT);

  return app1(Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]));
}

const XMP_PACKET =
  `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ` +
  `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" ` +
  `xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" ` +
  `GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" ` +
  `GCamera:MicroVideoOffset="4096"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

const buildXmp = () =>
  app1(Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii'),
                      Buffer.from(XMP_PACKET, 'utf8')]));

/** Insert APP segments directly after the SOI marker. */
const spliceAfterSoi = (jpeg, segs) =>
  Buffer.concat([jpeg.subarray(0, 2), ...segs, jpeg.subarray(2)]);

/* ---------- the appended clip ---------- */

function box(type, payload) {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, 'ascii');
  payload.copy(b, 8);
  return b;
}

function makeMp4(bytes) {
  const ftyp = box('ftyp', Buffer.concat([
    Buffer.from('mp42', 'ascii'),      // major brand
    Buffer.from([0, 0, 0, 1]),         // minor version
    Buffer.from('mp42isomavc1', 'ascii'),
  ]));
  return Buffer.concat([ftyp, box('mdat', randomBytes(bytes))]);
}

/** Approximation of Samsung's SEF trailer -- signature bait only, never parsed. */
function sefTrailer(dataLength) {
  const head = Buffer.alloc(16);
  head.write('SEFH', 0, 'ascii');
  head.writeUInt32LE(106, 4);          // version
  head.writeUInt32LE(1, 8);            // entry count
  head.writeUInt32LE(dataLength, 12);
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(head.length, 0);
  tail.write('SEFT', 4, 'ascii');
  return Buffer.concat([head, tail]);
}

/* ---------- compose ---------- */

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const kb = b => (b.length / 1024).toFixed(0) + ' KB';

async function main() {
  await mkdir(DIR, { recursive: true });
  const { main: mainJpeg, thumb } = await renderJpegs();

  // Every fixture's still is one of these two, byte for byte.
  const still = spliceAfterSoi(mainJpeg, [buildExif(thumb)]);
  const stillWithXmp = spliceAfterSoi(mainJpeg, [buildExif(thumb), buildXmp()]);

  const clip = makeMp4(900 * 1024);

  const fixtures = [
    // Classic Samsung: the marker string sits between the JPEG and the video.
    ['samsung-classic.jpg', still,
      Buffer.concat([Buffer.from('MotionPhoto_Data', 'ascii'), clip])],
    // Newer Samsung shape: video first, index trailer last.
    ['samsung-sef.jpg', still,
      Buffer.concat([clip, sefTrailer(clip.length)])],
    // Pixel: flagged in XMP, video appended plain.
    ['pixel.jpg', stillWithXmp, clip],
    // Appended data of a kind we do not recognise -- must still be removed.
    ['unknown-trailer.jpg', still, randomBytes(64 * 1024)],
    // Already a plain still: nothing to remove.
    ['plain.jpg', still, Buffer.alloc(0)],
  ];

  const manifest = [];
  for (const [name, expected, trailer] of fixtures) {
    const file = Buffer.concat([expected, trailer]);
    await writeFile(join(DIR, name), file);
    await writeFile(join(DIR, name + '.expected'), expected);
    manifest.push({
      name, size: file.length,
      stillSize: expected.length, stillSha256: sha256(expected),
      trailerSize: trailer.length,
    });
    console.log(`  ${name.padEnd(22)} ${kb(file).padStart(8)}  still ${kb(expected)}  clip ${kb(trailer)}`);
  }

  // Negative case: not a JPEG at all.
  const junk = Buffer.from('This file is not a JPEG in any sense.\n');
  await writeFile(join(DIR, 'not-a-jpeg.jpg'), junk);
  console.log(`  not-a-jpeg.jpg         ${kb(junk).padStart(8)}`);

  await writeFile(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

main().catch(err => { console.error(err); process.exit(1); });
