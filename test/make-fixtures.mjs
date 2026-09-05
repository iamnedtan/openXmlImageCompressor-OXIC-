// Builds test/fixtures/: three OpenXML files carrying the same three images,
// plus two negative cases. Images are rendered with Chromium so they are real
// JPEG/PNG data rather than synthetic byte patterns.
//
//   NODE_PATH=/opt/node22/lib/node_modules node test/make-fixtures.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeDocx, makeXlsx, makePptx } from './ooxml.mjs';
import { loadPlaywright } from './playwright.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Renders three images in a real browser and returns them as buffers. */
async function renderImages() {
  const browser = await loadPlaywright().chromium.launch();
  const page = await browser.newPage();
  const encoded = await page.evaluate(async () => {
    const draw = (w, h, fn) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      fn(c.getContext('2d'), w, h);
      return c;
    };
    const toDataURL = (c, type, q) => c.toDataURL(type, q);

    // A noisy photo-like gradient: compresses like a photograph, so JPEG
    // quality changes show up clearly.
    const photo = draw(3200, 2400, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#1b3a6b'); g.addColorStop(0.5, '#c96a2b'); g.addColorStop(1, '#f2e3c0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 24000; i++) {
        ctx.fillStyle = `rgba(${(i * 37) % 256},${(i * 91) % 256},${(i * 53) % 256},0.35)`;
        ctx.beginPath();
        ctx.arc((i * 719) % w, (i * 331) % h, 2 + (i % 11), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // A screenshot as they actually turn up in decks: UI chrome and text over a
    // photographic panel. Fully opaque, and mixed content, so it is a genuine
    // PNG → JPEG candidate. (A screenshot of *flat* colour alone compresses
    // better as PNG, and OXIC is expected to leave that one alone.)
    const shot = draw(2400, 1600, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = ['#eef2f7', '#dbe4ef', '#c9d6e6'][i % 3];
        ctx.fillRect(60, 40 + i * 38, w - 120, 28);
      }
      const g = ctx.createLinearGradient(60, 600, w - 60, 1400);
      g.addColorStop(0, '#3d5a80'); g.addColorStop(0.5, '#98c1d9'); g.addColorStop(1, '#ee6c4d');
      ctx.fillStyle = g; ctx.fillRect(60, 600, w - 120, 800);
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = `rgba(${(i * 61) % 256},${(i * 17) % 256},${(i * 113) % 256},0.30)`;
        ctx.fillRect(60 + (i * 271) % (w - 120), 600 + (i * 397) % 800, 3 + (i % 7), 3 + (i % 5));
      }
      ctx.fillStyle = '#22303f'; ctx.font = 'bold 72px sans-serif';
      ctx.fillText('Quarterly figures', 80, 1520);
    });

    // Flat colour and hard edges: PNG's best case, small, and under any sane
    // resize cap. JPEG cannot beat it, so OXIC must leave it exactly as it is.
    const flat = draw(800, 600, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f6fed'; ctx.fillRect(0, 0, w, 90);
      ctx.fillStyle = '#e8edf5';
      for (let i = 0; i < 8; i++) ctx.fillRect(40, 130 + i * 56, w - 80, 36);
    });

    // Has real transparency, so it must never be converted.
    const logo = draw(900, 600, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#2f6fed';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 240, 0, Math.PI * 2); ctx.fill();
    });

    return {
      photo: toDataURL(photo, 'image/jpeg', 0.95),
      shot: toDataURL(shot, 'image/png'),
      logo: toDataURL(logo, 'image/png'),
      flat: toDataURL(flat, 'image/png'),
    };
  });
  await browser.close();

  const decode = url => Buffer.from(url.split(',')[1], 'base64');
  return [
    { name: 'image1.jpeg', data: decode(encoded.photo) },
    { name: 'image2.png', data: decode(encoded.shot) },
    { name: 'image3.png', data: decode(encoded.logo) },
    { name: 'image4.png', data: decode(encoded.flat) },
  ];
}

const kb = b => (b.length / 1024).toFixed(0) + ' KB';

async function main() {
  await mkdir(DIR, { recursive: true });
  const images = await renderImages();
  for (const i of images) console.log(`  image ${i.name.padEnd(12)} ${kb(i.data)}`);

  const files = {
    'sample.docx': makeDocx(images),
    'sample.xlsx': makeXlsx(images),
    'sample.pptx': makePptx(images),
    // Negative cases.
    'no-images.docx': makeDocx([]),
    'not-a-zip.docx': Buffer.from('This is plainly not a ZIP container.\n'),
  };
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(DIR, name), data);
    console.log(`  ${name.padEnd(18)} ${kb(data)}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
