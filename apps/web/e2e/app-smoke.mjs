/* global process, console, Buffer, URL, window, document, navigator, fetch, DataTransfer, File, ClipboardEvent, DragEvent -- Node, plus browser globals inside page.evaluate() callbacks */
// End-to-end smoke test of the PhotoBrick app with the installed Chrome (playwright-core; it never
// downloads a browser). It builds nothing and starts no server: run it against a running app, ideally
// the Go binary so the real CSP applies:
//
//   make build && ./out/photobrick -addr 127.0.0.1:18321 &
//   node apps/web/e2e/app-smoke.mjs http://127.0.0.1:18321/
//
// Env: CHROME_PATH (default /usr/bin/google-chrome), SMOKE_OUT (screenshots, downloads and the PDF;
// default <tmp>/photobrick-smoke), HEADED=1 to watch. Exits 1 if any check fails.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const BASE = new URL(process.argv[2] ?? 'http://127.0.0.1:18321/').href;
const ORIGIN = new URL(BASE).origin;
const OUT = path.resolve(process.env.SMOKE_OUT ?? path.join(os.tmpdir(), 'photobrick-smoke'));
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const EXAMPLE = path.join(WEB, 'public', 'examples', 'astronaut.jpg');
const VIEWER_BG = [38, 40, 45];
mkdirSync(OUT, { recursive: true });

const results = [];
function check(scope, name, ok, detail = '') {
  results.push({ scope, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail ? ` - ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------------------------
// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced: what Chrome screenshots are).

function decodePng(buf) {
  let o = 8;
  let width = 0, height = 0, channels = 4;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error(`unsupported PNG colour type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, px };
}

/** Share of pixels that differ from the backdrop, and the number of distinct (quantised) colours. */
function pixelStats(png, bg = VIEWER_BG) {
  const { width, height, channels, px } = decodePng(png);
  let differ = 0;
  const colours = new Set();
  for (let i = 0; i < width * height; i++) {
    const r = px[i * channels], g = px[i * channels + 1], b = px[i * channels + 2];
    if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 24) differ++;
    colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
  }
  return { fill: differ / (width * height), colours: colours.size, width, height, px, channels };
}

/** Mean absolute channel difference of two same-size screenshots. */
function meanDiff(a, b) {
  const A = decodePng(a), B = decodePng(b);
  if (A.width !== B.width || A.height !== B.height) return Infinity;
  let sum = 0;
  const n = A.width * A.height;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) sum += Math.abs(A.px[i * A.channels + k] - B.px[i * B.channels + k]);
  return sum / (n * 3);
}

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------------------------

function watch(page, scope) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== ORIGIN) problems.push(`request to another origin: ${u}`);
    if (r.method() !== 'GET') problems.push(`${r.method()} request: ${u}`);
  });
  return {
    problems,
    report(label) {
      check(scope, `${label}: no console errors, CSP violations, uploads or foreign requests`, problems.length === 0, problems.slice(0, 5).join(' | '));
      problems.length = 0;
    },
  };
}

async function recordCsp(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}

const summaryText = (page) => page.locator('[data-testid=summary]').innerText();

async function waitForMosaic(page) {
  await page.waitForFunction(() => /panels/.test(document.querySelector('[data-testid=summary]')?.textContent ?? ''), null, { timeout: 30000 });
  await page.waitForTimeout(400);
}

async function viewerShot(page, name) {
  const buf = await page.locator('[role=img]').first().screenshot();
  if (name) writeFileSync(path.join(OUT, `${name}.png`), buf);
  return buf;
}

async function download(page, testId, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(`[data-testid=${testId}]`)]);
  const file = path.join(OUT, name ?? dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename(), data: readFileSync(file) };
}

async function desktop(browser) {
  const S = 'desktop';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const page = await ctx.newPage();
  await recordCsp(page);
  const w = watch(page, S);

  // Landing
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Choose a photo' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, 'desktop-landing.png'), fullPage: true });
  check(S, 'landing shows the wordmark, pitch, examples and promises', (await page.getByText('Your photo stays on your device').count()) === 1 && (await page.locator('[data-example]').count()) === 3);
  check(S, 'footer shows the LEGO disclaimer and the Rebrickable credit', (await page.getByText('LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site.').count()) >= 1 && (await page.getByRole('link', { name: 'Rebrickable' }).count()) >= 1);
  check(S, 'file input accepts image/* only (no HEIC listed)', (await page.locator('input[type=file]').getAttribute('accept')) === 'image/*');
  check(S, 'no CSP violations on the landing page', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(', '));
  w.report('landing');

  // About dialog (lazy chunk)
  await page.getByRole('button', { name: 'About' }).first().click();
  const about = page.getByRole('dialog', { name: 'About PhotoBrick' });
  await about.waitFor();
  check(S, 'About dialog has the disclaimer and the privacy promise', (await about.getByText('which does not sponsor').count()) === 1 && (await about.getByText('never uploaded').count()) >= 1);
  await about.getByRole('button', { name: 'Close' }).click();
  await about.waitFor({ state: 'hidden' });

  // Upload an example
  const t0 = Date.now();
  await page.locator('input[type=file]').setInputFiles(EXAMPLE);
  await waitForMosaic(page);
  check(S, 'mosaic appears after upload', true, `${Date.now() - t0} ms, summary "${(await summaryText(page)).replace(/\n/g, ' · ')}"`);
  const shot0 = await viewerShot(page, 'desktop-editor');
  const st0 = pixelStats(shot0);
  check(S, 'mosaic canvas is not blank', st0.fill > 0.3 && st0.colours > 20, `fill ${(st0.fill * 100).toFixed(1)}%, ${st0.colours} colours`);
  await page.screenshot({ path: path.join(OUT, 'desktop-editor-full.png') });
  check(S, 'the renderer is WebGL (no flat-view notice)', (await page.getByText('Flat view (WebGL unavailable)').count()) === 0);

  // Size preset
  const before = await summaryText(page);
  await page.click('[data-testid=size-l]');
  await page.waitForFunction((b) => document.querySelector('[data-testid=summary]')?.textContent !== b, before.replace(/\n/g, ''), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const afterL = await summaryText(page);
  check(S, 'size preset L changes the mosaic size', afterL !== before && /5 × 6 panels|6 × 5 panels|× \d+ panels/.test(afterL), afterL.replace(/\n/g, ' · '));
  check(S, 'size card L is selected', (await page.locator('[data-testid=size-l]').getAttribute('aria-pressed')) === 'true');

  // Style
  await page.click('[data-testid=tab-look]');
  const shotNatural = await viewerShot(page);
  await page.click('[data-testid=style-sepia]');
  await page.waitForTimeout(500);
  const shotSepia = await viewerShot(page, 'desktop-sepia');
  check(S, 'style Sepia changes the mosaic', meanDiff(shotNatural, shotSepia) > 3, `mean diff ${meanDiff(shotNatural, shotSepia).toFixed(1)}`);
  await page.click('[data-testid=style-natural]');
  await page.waitForTimeout(400);

  // Live slider (keyboard on the Texture slider)
  const texture = page.locator('[data-testid=slider-texture]');
  await texture.focus();
  const tBefore = await viewerShot(page);
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  check(S, 'texture slider regenerates the mosaic', meanDiff(tBefore, await viewerShot(page)) > 0.2);

  // Hold to compare
  const plain = await viewerShot(page);
  const btn = await page.locator('[data-testid=hold-compare]').boundingBox();
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const held = await viewerShot(page, 'desktop-compare');
  await page.mouse.up();
  await page.waitForTimeout(250);
  const released = await viewerShot(page);
  check(S, 'hold to compare shows the photo, release shows the mosaic', meanDiff(plain, held) > 5 && meanDiff(plain, released) < 1, `held diff ${meanDiff(plain, held).toFixed(1)}, released diff ${meanDiff(plain, released).toFixed(2)}`);

  // Crop mode
  await page.click('[data-testid=tab-size]');
  await page.getByLabel('Adjust crop').check();
  const vb = await page.locator('[role=img]').first().boundingBox();
  const cropBefore = await viewerShot(page);
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width / 2 + 60, vb.y + vb.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check(S, 'crop mode: wheel zooms and drag moves the photo', meanDiff(cropBefore, await viewerShot(page, 'desktop-crop')) > 3);
  await page.getByRole('button', { name: 'Reset crop' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Parts and exports
  await page.click('[data-testid=tab-parts]');
  await page.getByRole('table', { name: 'Parts list' }).waitFor();
  await page.screenshot({ path: path.join(OUT, 'desktop-parts.png') });
  const bl = await download(page, 'export-bricklink');
  const xml = bl.data.toString('utf8');
  check(S, 'BrickLink XML downloads without an XML declaration', xml.startsWith('<INVENTORY>') && !xml.includes('<?xml') && xml.includes('<ITEMID>98138</ITEMID>'), `${bl.suggested}, ${xml.length} bytes`);
  const pab = await download(page, 'export-pab');
  const csv = pab.data.toString('utf8');
  check(S, 'Pick a Brick CSV has the elementId,quantity header', csv.startsWith('elementId,quantity\n') && csv.trim().split('\n').length > 2, `${pab.suggested}, ${csv.trim().split('\n').length - 1} rows`);
  check(S, 'Pick a Brick result is shown', await page.locator('[data-testid=pab-warnings]').isVisible());
  const rb = await download(page, 'export-rebrickable');
  check(S, 'Rebrickable CSV has its header', rb.data.toString('utf8').startsWith('Part,Color,Quantity'));
  const caption = await page.locator('[data-testid=export-png] + p').innerText();
  const png = await download(page, 'export-png');
  const dim = pngSize(png.data);
  check(S, 'PNG export matches the size shown', caption.includes(`${dim.width.toLocaleString('en-GB')} × ${dim.height.toLocaleString('en-GB')} px`), `${dim.width} x ${dim.height}, caption "${caption}"`);

  // Share link
  await page.click('[data-testid=share-link]');
  await page.locator('[data-testid=toast]').waitFor({ timeout: 10000 });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  check(S, 'share link is copied', link.startsWith(`${new URL(BASE).origin}${new URL(BASE).pathname}#g=`), `${link.length} chars`);

  // Print view + PDF
  await page.click('[data-testid=tab-build]');
  await page.click('[data-testid=print-open]');
  await page.locator('[data-testid=print-pages][data-ready=true]').waitFor({ timeout: 30000 });
  const sheets = await page.locator('.pb-sheet').count();
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.pb-sheet')].filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => el.querySelector('h1, h2')?.textContent));
  check(S, 'no instruction page overflows its A4 sheet', clipped.length === 0, clipped.join(', '));
  check(S, 'the cover shows the whole mosaic as vector graphics', (await page.locator('[data-testid=print-cover] svg[role=img] path').count()) > 3);
  await page.screenshot({ path: path.join(OUT, 'desktop-print-view.png') });
  await page.locator('[data-testid=print-panel]').first().screenshot({ path: path.join(OUT, 'desktop-print-panel.png') });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  writeFileSync(path.join(OUT, 'instructions.pdf'), pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(S, 'print view saves a multi-page PDF, one page per sheet', pages > 1 && pages === sheets, `${pages} PDF pages, ${sheets} sheets, ${(pdf.length / 1024).toFixed(0)} KB`);
  await page.getByRole('button', { name: 'Close' }).first().click();
  check(S, 'no CSP violations in the editor', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(', '));
  w.report('editor');

  // Open the share link in a new page
  const shared = await ctx.newPage();
  await recordCsp(shared);
  const ws = watch(shared, S);
  await shared.goto(link);
  await shared.locator('[data-testid=shared-banner]').waitFor({ timeout: 20000 });
  await waitForMosaic(shared);
  const stShared = pixelStats(await viewerShot(shared, 'desktop-shared'));
  check(S, 'shared link renders the mosaic with the banner', stShared.fill > 0.3 && stShared.colours > 20, `fill ${(stShared.fill * 100).toFixed(1)}%`);
  check(S, 'shared view has parts but no photo controls', (await shared.getByRole('table', { name: 'Parts list' }).count()) === 1 && (await shared.locator('[data-testid=hold-compare]').count()) === 0 && (await shared.locator('[data-testid=tab-size]').count()) === 0);
  await shared.screenshot({ path: path.join(OUT, 'desktop-shared-full.png') });
  await shared.getByRole('button', { name: 'Make your own' }).click();
  await shared.getByRole('button', { name: 'Choose a photo' }).waitFor();
  check(S, '"Make your own" clears the hash and shows the landing page', !shared.url().includes('#g='));
  ws.report('shared view');
  await shared.close();

  // Broken share link
  const broken = await ctx.newPage();
  await broken.goto(`${BASE}#g=UEIBnotreallyashare`);
  await broken.getByRole('button', { name: 'Choose a photo' }).waitFor();
  check(S, 'an invalid share link shows a friendly error on the landing page', (await broken.getByText('This share link is incomplete or damaged').count()) === 1);
  await broken.close();

  // HEIC and too-small errors
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1'), Buffer.alloc(64)]);
  await page.click('[data-testid=tab-size]').catch(() => {});
  await page.goto(BASE);
  await page.locator('input[type=file]').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic });
  await page.getByText("This browser can't open HEIC photos").waitFor({ timeout: 15000 });
  check(S, 'HEIC files get the HEIC advice', true);
  const gif1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await page.locator('input[type=file]').setInputFiles({ name: 'pixel.gif', mimeType: 'image/gif', buffer: gif1x1 });
  await page.getByText('This image is too small').waitFor({ timeout: 15000 });
  check(S, 'tiny images get the too-small message', true);
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByText("This file couldn't be opened as an image").waitFor({ timeout: 15000 });
  check(S, 'non-images get the decode message', true);
  await page.screenshot({ path: path.join(OUT, 'desktop-error.png') });

  // Paste an image, then drop one (synthetic events carrying a real File).
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Choose a photo' }).waitFor();
  await page.evaluate(async () => {
    const blob = await (await fetch('/examples/mandarin-duck-thumb.jpg')).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/jpeg' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await waitForMosaic(page);
  check(S, 'pasting an image opens it', (await page.getByText('Photo: Pasted image').count()) === 1);
  await page.evaluate(async () => {
    const blob = await (await fetch('/examples/mona-lisa-thumb.jpg')).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'dropped.jpg', { type: 'image/jpeg' }));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.getByText('Photo: dropped.jpg').waitFor({ timeout: 15000 });
  await waitForMosaic(page);
  check(S, 'dropping an image anywhere opens it', true);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.getByText("This file couldn't be opened as an image").waitFor({ timeout: 15000 });
  await waitForMosaic(page);
  check(S, 'a bad file dropped on the editor keeps the current mosaic and explains why', (await page.getByText('Photo: dropped.jpg').count()) === 1 && pixelStats(await viewerShot(page, 'desktop-bad-drop')).fill > 0.3);

  // Canvas2D fallback (as without WebGL): the flat-view notice appears and the mosaic still renders.
  await page.goto(`${BASE}?renderer=canvas2d`);
  await page.click('[data-example=mandarin-duck]');
  await waitForMosaic(page);
  await page.getByText('Flat view (WebGL unavailable)').waitFor({ timeout: 10000 });
  const flat = pixelStats(await viewerShot(page, 'desktop-flat'));
  check(S, 'without WebGL the flat view renders and says so', flat.fill > 0.3, `fill ${(flat.fill * 100).toFixed(1)}%`);
  w.report('flat view');
  await ctx.close();
}

async function mobile(browser) {
  const S = 'mobile';
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  await recordCsp(page);
  const w = watch(page, S);
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Choose a photo' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, 'mobile-landing.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(S, 'landing has no horizontal scroll', overflow <= 0, `overflow ${overflow}px`);
  await page.locator('[data-example=mona-lisa]').tap();
  await waitForMosaic(page);
  const st = pixelStats(await viewerShot(page));
  check(S, 'example opens and the mosaic renders', st.fill > 0.3, `fill ${(st.fill * 100).toFixed(1)}%`);
  await page.screenshot({ path: path.join(OUT, 'mobile-editor.png') });
  // Hold to compare with a real touch (press, wait, release).
  const cdp = await ctx.newCDPSession(page);
  const hb = await page.locator('[data-testid=hold-compare]').boundingBox();
  const tp = [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }];
  const before = await viewerShot(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp });
  await page.waitForTimeout(350);
  const during = await viewerShot(page, 'mobile-compare');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const after = await viewerShot(page);
  check(S, 'touch and hold shows the photo, lifting the finger shows the mosaic', meanDiff(before, during) > 5 && meanDiff(before, after) < 1, `diff ${meanDiff(before, during).toFixed(1)} / ${meanDiff(before, after).toFixed(2)}`);
  const vb = await page.locator('[role=img]').first().boundingBox();
  check(S, 'viewer takes about 55-60% of the height', vb.height / 915 > 0.4 && vb.height / 915 < 0.62, `${Math.round(vb.height)} px`);
  await page.locator('[data-testid=tab-look]').tap();
  await page.screenshot({ path: path.join(OUT, 'mobile-look.png') });
  await page.locator('[data-testid=tab-parts]').tap();
  await page.getByRole('table', { name: 'Parts list' }).waitFor();
  await page.screenshot({ path: path.join(OUT, 'mobile-parts.png') });
  await page.locator('[data-testid=tab-build]').tap();
  await page.locator('[data-testid=print-open]').tap();
  await page.locator('[data-testid=print-pages][data-ready=true]').waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(OUT, 'mobile-print.png') });
  const printOverflow = await page.evaluate(() => document.querySelector('.pb-pages').scrollWidth - document.querySelector('.pb-pages').clientWidth);
  check(S, 'print preview fits the phone width', printOverflow <= 1, `overflow ${printOverflow}px`);
  check(S, 'no CSP violations on the phone', (await page.evaluate(() => window.__csp)).length === 0);
  w.report('phone');
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: !process.env.HEADED, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  await desktop(browser);
  await mobile(browser);
} catch (err) {
  check('run', 'no exceptions', false, err instanceof Error ? err.stack : String(err));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ base: BASE, results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Output: ${OUT}`);
process.exit(failed.length ? 1 : 0);
