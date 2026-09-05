// End-to-end test: drives index.html in a real Chromium, feeds it the fixtures,
// downloads what it produces and validates the result as an OOXML package.
//
//   NODE_PATH=/opt/node22/lib/node_modules node test/e2e.mjs
import { execFileSync } from 'node:child_process';
import { statSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlaywright } from './playwright.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const FIX = join(HERE, 'fixtures');
const OUT = mkdtempSync(join(tmpdir(), 'oxic-'));

let passed = 0, failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const EXPECTED_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const py = (script, ...args) => execFileSync('python3', [join(HERE, script), ...args], { encoding: 'utf8' });
const inspect = file => JSON.parse(py('inspect.py', file));
function validate(file) {
  try { py('validate_ooxml.py', file); return null; }
  catch (err) { return (err.stdout || '') + (err.stderr || ''); }
}

/* ---------- page helpers ---------- */

const snapshot = page => page.evaluate(() => {
  const s = window.__oxic.state;
  const r = n => s.results.get(n) || {};
  return {
    fileSize: s.file?.size ?? 0,
    other: s.other.length,
    headline: document.getElementById('headline').textContent.replace(/\s+/g, ' ').trim(),
    warn: document.getElementById('warn').hidden ? '' : document.getElementById('warn').textContent,
    note: document.getElementById('mediaNote').textContent,
    controlsHidden: document.getElementById('controls').hidden,
    error: document.getElementById('msg').hidden ? '' : document.getElementById('msg').textContent,
    rowCount: document.querySelectorAll('#tbl tbody tr').length,
    images: s.images.map(i => ({
      name: i.name, size: i.size, w: i.w, h: i.h,
      status: r(i.name).status, keptAlpha: !!r(i.name).keptAlpha,
      newSize: r(i.name).data ? r(i.name).data.length : i.size,
      newW: r(i.name).width, newH: r(i.name).height,
    })),
  };
});

async function loadFixture(page, name) {
  await page.evaluate(() => { window.__oxic.state.estimates = 0; });
  await page.setInputFiles('#file', join(FIX, name));
  await page.waitForFunction(
    () => window.__oxic.state.estimates > 0
       || !document.getElementById('msg').hidden
       || (!document.getElementById('report').hidden && window.__oxic.state.images.length === 0),
    null, { timeout: 120000 });
  return snapshot(page);
}

async function setOptions(page, opts) {
  const before = await page.evaluate(() => window.__oxic.state.estimates);
  await page.evaluate(o => {
    const fire = el => el.dispatchEvent(new Event('input', { bubbles: true }));
    const radio = (name, value) => {
      const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
      el.checked = true; fire(el);
    };
    if (o.mode) radio('mode', o.mode);
    if (o.rmode) radio('rmode', o.rmode);
    for (const [id, key] of [['maxdim', 'maxdim'], ['percent', 'percent'], ['quality', 'quality']]) {
      if (o[key] != null) { const el = document.getElementById(id); el.value = String(o[key]); fire(el); }
    }
    if (o.toJpeg != null) { const el = document.getElementById('topng'); el.checked = o.toJpeg; fire(el); }
  }, opts);
  await page.waitForFunction(n => window.__oxic.state.estimates > n, before, { timeout: 120000 });
  return snapshot(page);
}

const builtMime = page => page.evaluate(async () => (await window.__oxic.buildFile()).type);

async function download(page, as) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const path = join(OUT, as);
  await dl.saveAs(path);
  return { path, suggested: dl.suggestedFilename(), size: statSync(path).size };
}

/* ---------- the tests ---------- */

async function main() {
  const browser = await loadPlaywright().chromium.launch();
  const page = await browser.newContext({ acceptDownloads: true }).then(c => c.newPage());
  page.on('pageerror', e => { failed++; console.log('  FAIL page error — ' + e.message); });
  await page.goto('file://' + join(ROOT, 'index.html'));

  for (const fixture of ['sample.docx', 'sample.xlsx', 'sample.pptx']) {
    console.log(`\n${fixture}`);
    const onDisk = inspect(join(FIX, fixture));

    // --- 1. analysis ---
    let s = await loadFixture(page, fixture);
    check('reports 4 images', s.images.length === 4, `got ${s.images.length}`);
    check('table lists every image', s.rowCount === 4, `got ${s.rowCount}`);
    check('total file size matches disk',
      s.fileSize === statSync(join(FIX, fixture)).size);
    check('image sizes match the parts on disk',
      s.images.every(i => i.size === onDisk.sizes[i.name]));
    const dims = Object.fromEntries(s.images.map(i => [i.name.split('/').pop(), `${i.w}x${i.h}`]));
    check('sniffed every image dimension from its header',
      dims['image1.jpeg'] === '3200x2400' && dims['image2.png'] === '2400x1600'
      && dims['image3.png'] === '900x600' && dims['image4.png'] === '800x600',
      JSON.stringify(dims));
    check('found the media folder', /media/.test(s.note), s.note);

    // --- 2. resize + compress, same formats ---
    s = await setOptions(page, { mode: 'both', rmode: 'maxdim', maxdim: 1600, quality: 75, toJpeg: false });
    // Only parts that were actually rewritten are resized; one left alone
    // legitimately keeps its original dimensions.
    const rewritten = s.images.filter(i => i.status === 'recoded' || i.status === 'converted');
    check('every rewritten image is within the 1600px cap',
      rewritten.length > 0 && rewritten.every(i => Math.max(i.newW, i.newH) <= 1600),
      JSON.stringify(s.images.map(i => [i.name, i.status, i.newW, i.newH])));
    check('the oversized JPEG was downscaled',
      s.images.find(i => i.name.endsWith('image1.jpeg')).newW === 1600);
    check('every image is at most its original size',
      s.images.every(i => i.newSize <= i.size));
    check('no part changed format', s.images.every(i => i.status !== 'converted'));

    let dl = await download(page, fixture.replace('.', '-both.'));
    check('output keeps the extension and gains the suffix',
      dl.suggested === fixture.replace(/\.(\w+)$/, '-compressed.$1'), dl.suggested);
    // A generic application/zip type makes Chrome save book.xlsx as book.xlsx.zip.
    const mime = await builtMime(page);
    check('output carries its real OOXML media type, not application/zip',
      mime === EXPECTED_MIME[fixture.split('.').pop()], mime);
    check('output is smaller than the original', dl.size < s.fileSize,
      `${dl.size} vs ${s.fileSize}`);
    check('output validates as OOXML', validate(dl.path) === null, validate(dl.path));

    const out = inspect(dl.path);
    check('all parts survive the rebuild',
      out.parts.length === onDisk.parts.length &&
      onDisk.parts.every(p => out.parts.includes(p)));
    check('[Content_Types].xml is written first', out.parts[0] === '[Content_Types].xml', out.parts[0]);
    check('relationships are untouched when nothing is renamed',
      JSON.stringify(out.rels) === JSON.stringify(onDisk.rels));

    // --- 3. PNG → JPEG conversion ---
    s = await setOptions(page, { toJpeg: true });
    const shot = s.images.find(i => i.name.endsWith('image2.png'));
    const logo = s.images.find(i => i.name.endsWith('image3.png'));
    check('opaque PNG is converted', shot.status === 'converted', shot.status);
    check('transparent PNG is not converted', logo.status !== 'converted', logo.status);
    check('transparent PNG is flagged as keeping its alpha', logo.keptAlpha);

    // The guard that stops the tool making a file worse: JPEG cannot beat PNG
    // on flat colour, so this part must come through byte-identical.
    const flat = s.images.find(i => i.name.endsWith('image4.png'));
    check('a PNG that JPEG cannot beat is left alone', flat.status === 'kept', flat.status);
    check('the untouched PNG keeps its exact bytes', flat.newSize === flat.size);

    dl = await download(page, fixture.replace('.', '-jpeg.'));
    check('converted output validates as OOXML', validate(dl.path) === null, validate(dl.path));

    const conv = inspect(dl.path);
    const prefix = shot.name.slice(0, shot.name.lastIndexOf('/'));
    check('converted part is renamed to .jpeg',
      conv.media.includes(`${prefix}/image2.jpeg`) && !conv.media.includes(`${prefix}/image2.png`),
      conv.media.join(', '));
    check('transparent PNG keeps its name', conv.media.includes(`${prefix}/image3.png`));
    check('the unbeatable PNG keeps its name', conv.media.includes(`${prefix}/image4.png`));
    check('the unbeatable PNG is byte-identical in the output',
      conv.sizes[`${prefix}/image4.png`] === onDisk.sizes[`${prefix}/image4.png`]);
    check('relationship target followed the rename',
      Object.values(conv.rels).flat().some(t => t.endsWith('image2.jpeg')) &&
      !Object.values(conv.rels).flat().some(t => t.endsWith('image2.png')),
      JSON.stringify(conv.rels));
    check('relative ../ prefixes are preserved',
      Object.entries(conv.rels).every(([f, targets]) =>
        targets.every((t, i) => t.startsWith('../') === onDisk.rels[f][i].startsWith('../'))));
    check('[Content_Types].xml declares jpeg', conv.defaults.jpeg === 'image/jpeg',
      JSON.stringify(conv.defaults));
    check('png Default is retained for the remaining PNG', conv.defaults.png === 'image/png');
    check('conversion beats same-format compression', dl.size < statSync(join(OUT, fixture.replace('.', '-both.'))).size);

    // --- 4. percentage resize ---
    s = await setOptions(page, { rmode: 'percent', percent: 25, toJpeg: false });
    const photo = s.images.find(i => i.name.endsWith('image1.jpeg'));
    check('percentage scaling halves-and-quarters correctly',
      near(photo.newW, 800, 1) && near(photo.newH, 600, 1), `${photo.newW}×${photo.newH}`);

    // --- 5. resize-only, with a cap nothing exceeds ---
    s = await setOptions(page, { mode: 'resize', rmode: 'maxdim', maxdim: 5000 });
    check('resize-only leaves under-sized images untouched',
      s.images.every(i => i.status === 'unchanged'),
      JSON.stringify(s.images.map(i => i.status)));
    check('a no-op run is reported as saving nothing', /save|nothing/i.test(s.headline + s.warn));

    // --- 6. round trip ---
    await page.setInputFiles('#file', join(OUT, fixture.replace('.', '-jpeg.')));
    await page.waitForFunction(() => window.__oxic.state.estimates > 0, null, { timeout: 120000 });
    await setOptions(page, { mode: 'both', rmode: 'maxdim', maxdim: 1600, quality: 75, toJpeg: true });
    const round = await download(page, fixture.replace('.', '-round.'));
    check('re-processing an output still validates', validate(round.path) === null, validate(round.path));
    check('re-processing does not grow the file', round.size <= dl.size + 2048,
      `${round.size} vs ${dl.size}`);
  }

  // --- 7. negative cases ---
  console.log('\nedge cases');
  let s = await loadFixture(page, 'no-images.docx');
  check('a file with no images says so', /no media folder/i.test(s.note), s.note);
  check('options are hidden when there is nothing to do', s.controlsHidden);

  s = await loadFixture(page, 'not-a-zip.docx');
  check('a non-ZIP file reports a clear error', /not a zip container/i.test(s.error), s.error);

  // Opening a normal file after one of those must restore the full report.
  s = await loadFixture(page, 'sample.pptx');
  check('the report recovers after an empty or broken file',
    !s.controlsHidden && s.rowCount === 4 && /− /.test(s.headline),
    `controlsHidden=${s.controlsHidden} rows=${s.rowCount} "${s.headline}"`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
