// End-to-end test for motionphoto.html: drives the real page in Chromium,
// downloads what it produces, and compares the stills byte for byte against
// the exact JPEGs the fixtures were built from.
//
//   NODE_PATH=/opt/node22/lib/node_modules node test/mp-e2e.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlaywright } from './playwright.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const FIX = join(HERE, 'fixtures', 'mp');
const OUT = mkdtempSync(join(tmpdir(), 'mps-'));

let passed = 0, failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

const manifest = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8'));
const expected = name => readFileSync(join(FIX, name + '.expected'));

function validateJpeg(...paths) {
  try { execFileSync('python3', [join(HERE, 'validate_jpeg.py'), ...paths], { encoding: 'utf8' }); return null; }
  catch (err) { return (err.stdout || '') + (err.stderr || ''); }
}

function unzip(zipPath, into) {
  execFileSync('python3', ['-c',
    'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, into]);
  return readdirSync(into);
}

/* ---------- page helpers ---------- */

const snapshot = page => page.evaluate(() => {
  const s = window.__mps.state;
  return {
    rows: s.results.map(r => ({
      name: r.name, size: r.size, trailer: r.trailer, status: r.status,
      labels: r.labels || [], stillSize: r.still ? r.still.length : null,
      flagsCleared: r.flagsCleared || 0, error: r.error || '',
    })),
    headline: document.getElementById('headline').textContent.replace(/\s+/g, ' ').trim(),
    warn: document.getElementById('warn').hidden ? '' : document.getElementById('warn').textContent,
    saveLabel: document.getElementById('save').textContent,
    saveDisabled: document.getElementById('save').disabled,
  };
});

async function load(page, names, { clearXmp = true } = {}) {
  await page.evaluate(v => {
    document.getElementById('clearxmp').checked = v;
    // Selecting the same files again is a no-op unless the input is cleared
    // first, and then no change event fires and the run never starts.
    document.getElementById('file').value = '';
    window.__mps.state.runs = 0;
  }, clearXmp);
  await page.setInputFiles('#file', names.map(n => join(FIX, n)));
  await page.waitForFunction(() => window.__mps.state.runs > 0, null, { timeout: 120000 });
  return snapshot(page);
}

async function download(page, as) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const path = join(OUT, as);
  await dl.saveAs(path);
  return { path, suggested: dl.suggestedFilename(), size: statSync(path).size };
}

/* ---------- tests ---------- */

const WITH_CLIP = ['samsung-classic.jpg', 'samsung-sef.jpg', 'pixel.jpg', 'unknown-trailer.jpg'];
const ALL = [...WITH_CLIP, 'plain.jpg', 'not-a-jpeg.jpg'];

async function main() {
  const browser = await loadPlaywright().chromium.launch();
  const page = await browser.newContext({ acceptDownloads: true }).then(c => c.newPage());
  page.on('pageerror', e => { failed++; console.log('  FAIL page error — ' + e.message); });
  await page.goto('file://' + join(ROOT, 'motionphoto.html'));

  // ---- 1. batch analysis ----
  console.log('\nbatch');
  let s = await load(page, ALL, { clearXmp: false });
  check('every file is listed', s.rows.length === ALL.length, `got ${s.rows.length}`);

  for (const m of manifest) {
    const row = s.rows.find(r => r.name === m.name);
    check(`${m.name}: clip size matches the fixture`, row.trailer === m.trailerSize,
      `${row.trailer} vs ${m.trailerSize}`);
    check(`${m.name}: still size matches the fixture`, row.stillSize === m.stillSize,
      `${row.stillSize} vs ${m.stillSize}`);
  }

  const bad = s.rows.find(r => r.name === 'not-a-jpeg.jpg');
  check('a non-JPEG is reported, not silently dropped', bad.status === 'error', bad.status);
  check('the non-JPEG error names the cause', /SOI/.test(bad.error), bad.error);
  check('the non-JPEG is excluded from the output', /5 stills/.test(s.saveLabel), s.saveLabel);
  check('plain JPEG is recognised as having no clip',
    s.rows.find(r => r.name === 'plain.jpg').status === 'clean');

  const labels = Object.fromEntries(s.rows.map(r => [r.name, r.labels.join(', ')]));
  check('Samsung marker is identified', /Samsung motion photo/.test(labels['samsung-classic.jpg']), labels['samsung-classic.jpg']);
  check('Samsung SEF trailer is identified', /SEF/.test(labels['samsung-sef.jpg']), labels['samsung-sef.jpg']);
  check('the MP4 clip is identified', /MP4/.test(labels['pixel.jpg']), labels['pixel.jpg']);
  check('an unrecognised trailer is still stripped',
    s.rows.find(r => r.name === 'unknown-trailer.jpg').status === 'stripped');

  // ---- 2. the stills are byte-identical to the originals ----
  console.log('\nbyte fidelity');
  let dl = await download(page, 'stills.zip');
  check('a batch comes back as one ZIP', dl.suggested.endsWith('.zip'), dl.suggested);

  const dir = join(OUT, 'unzipped');
  const names = unzip(dl.path, dir);
  check('the ZIP holds every usable still', names.length === 5, names.join(', '));

  for (const m of manifest) {
    const got = readFileSync(join(dir, m.name.replace(/\.jpg$/, '-still.jpg')));
    check(`${m.name}: still is byte-identical to the source JPEG`,
      got.equals(expected(m.name)), `${got.length} vs ${m.stillSize} bytes`);
  }

  // ---- 3. independent structural validation ----
  console.log('\nstructure');
  const stills = names.map(n => join(dir, n));
  check('every extracted still ends exactly at its EOI', validateJpeg(...stills) === null,
    validateJpeg(...stills));
  check('the untouched inputs do NOT pass that check',
    validateJpeg(join(FIX, 'samsung-classic.jpg')) !== null);

  await page.setInputFiles('#file', stills[0]);
  await page.waitForFunction(() => window.__mps.state.results.length === 1, null, { timeout: 120000 });
  const dims = await page.evaluate(async () => {
    const bmp = await createImageBitmap(document.getElementById('file').files[0]);
    return { w: bmp.width, h: bmp.height };
  });
  check('an output still decodes at full resolution', dims.w === 1600 && dims.h === 1200,
    `${dims.w}x${dims.h}`);

  // ---- 4. XMP motion flags ----
  console.log('\nxmp flags');
  s = await load(page, ['pixel.jpg'], { clearXmp: true });
  check('one motion flag is cleared', s.rows[0].flagsCleared === 1, String(s.rows[0].flagsCleared));
  check('clearing a flag does not change the file length',
    s.rows[0].stillSize === manifest.find(m => m.name === 'pixel.jpg').stillSize);

  dl = await download(page, 'pixel-still.jpg');
  check('a single file downloads as a JPEG, not a ZIP',
    dl.suggested === 'pixel-still.jpg', dl.suggested);
  const text = readFileSync(dl.path).toString('latin1');
  check('MotionPhoto is now 0', text.includes('MotionPhoto="0"') && !text.includes('MotionPhoto="1"'));
  check('MotionPhotoVersion is left alone', text.includes('MotionPhotoVersion="1"'));
  check('the flagged still still validates', validateJpeg(dl.path) === null, validateJpeg(dl.path));

  s = await load(page, ['pixel.jpg'], { clearXmp: false });
  check('with the option off, nothing is cleared', s.rows[0].flagsCleared === 0);

  // ---- 5. edge cases ----
  console.log('\nedge cases');
  s = await load(page, ['plain.jpg']);
  check('a file with no clip says so', /no video clips found/.test(s.headline), s.headline);
  check('and warns that saving would just copy it', /already plain JPEGs/.test(s.warn), s.warn);

  s = await load(page, ['not-a-jpeg.jpg']);
  check('a batch of only unreadable files disables saving', s.saveDisabled);

  s = await load(page, WITH_CLIP);
  check('the report recovers after an unusable batch',
    s.rows.every(r => r.status === 'stripped') && !s.saveDisabled);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
