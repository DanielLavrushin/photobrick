/* global process, console, Buffer, URL, URLSearchParams, window, document, requestAnimationFrame -- Node, plus browser globals inside page.evaluate() callbacks */
// Browser check for the mosaic viewer (src/viewer), driven through viewer-demo.html.
//
//   node apps/web/e2e/viewer-check.mjs [--browsers=chrome,firefox]
//
// Starts the Vite dev server on port 5199 and drives the installed Chrome (and Firefox over WebDriver
// BiDi, skipped if it doesn't launch) with playwright-core; it never downloads browsers (CHROME_PATH /
// FIREFOX_PATH override the locations). Screenshots, exported PNGs and summary.json go to
// $VIEWER_CHECK_OUT (default apps/web/.e2e/viewer-check). Exits 1 if any check fails.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright-core';
import { createServer } from 'vite';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.resolve(process.env.VIEWER_CHECK_OUT ?? path.join(WEB, '.e2e', 'viewer-check'));
const PORT = 5199;
const DEMO = `http://localhost:${PORT}/viewer-demo.html`;
// 256x256 is the largest supported grid; 47x33 has rows that are not 4-byte aligned.
const SIZES = ['48x48', '64x96', '128x128', '256x192', '256x256', '47x33'];
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const FIREFOX = process.env.FIREFOX_PATH ?? ['/snap/firefox/current/usr/lib/firefox/firefox', '/usr/lib/firefox/firefox', '/usr/bin/firefox'].find((p) => existsSync(p));
const browsersArg = process.argv.find((a) => a.startsWith('--browsers='));
const BROWSERS = browsersArg ? browsersArg.slice('--browsers='.length).split(',') : ['chrome', 'firefox'];

// Stud-centre tolerance per channel: the shader's highlight adds up to ~12 levels half a pixel off centre.
const TOL = { webgl2: 16, canvas2d: 2 };

const results = [];
function check(scope, name, ok, detail = '') {
  results.push({ scope, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail ? ` - ${detail}` : ''}`);
}
function note(scope, text) {
  results.push({ scope, name: text, ok: true, note: true });
  console.log(`NOTE [${scope}] ${text}`);
}

const api = (page, name, ...args) => page.evaluate(([n, a]) => window.__viewerDemo[n](...a), [name, args]);
const frames = (page, n = 2) =>
  page.evaluate((k) => new Promise((resolve) => {
    const step = (i) => (i === 0 ? resolve() : requestAnimationFrame(() => step(i - 1)));
    step(k);
  }), n);

async function openDemo(page, query = {}) {
  await page.goto(`${DEMO}?${new URLSearchParams(query)}`);
  await page.waitForFunction(() => window.__viewerDemo?.ready && window.__viewerDemo.state().kind !== null, null, { timeout: 30000 });
  await frames(page);
}

async function viewerBox(page) {
  return page.locator('[role=img]').boundingBox();
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const diff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const pct = (x) => `${(100 * x).toFixed(1)}%`;

/**
 * Round, evenly spaced studs with the base colour between them: for sampled visible cells, the centre
 * and four points 0.3 pitch out along the axes are the stud colour; four points 0.6 pitch out along
 * the diagonals (between discs, out of reach of the shadows) are the gap colour.
 */
async function checkGeometry(page, scope, renderer) {
  const m = await api(page, 'mosaic');
  const { view } = await api(page, 'state');
  const box = await viewerBox(page);
  const gap = renderer === 'webgl2' ? m.base : m.flatGap;
  // Cells whose whole neighbourhood is on screen, spread over the visible part of the grid.
  const s = view.scale;
  const vx0 = Math.max(0, Math.ceil(-view.ox / s) + 1);
  const vy0 = Math.max(0, Math.ceil(-view.oy / s) + 1);
  const vx1 = Math.min(m.width, Math.floor((box.width - view.ox) / s) - 1);
  const vy1 = Math.min(m.height, Math.floor((box.height - view.oy) / s) - 1);
  const cells = [];
  const sx = Math.max(1, Math.ceil((vx1 - vx0) / 10));
  const sy = Math.max(1, Math.ceil((vy1 - vy0) / 8));
  for (let y = vy0; y < vy1; y += sy) {
    for (let x = vx0; x < vx1; x += sx) cells.push({ i: y * m.width + x, cx: view.ox + (x + 0.5) * s, cy: view.oy + (y + 0.5) * s });
  }
  const inner = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
  const outer = [[0.424, 0.424], [-0.424, 0.424], [0.424, -0.424], [-0.424, -0.424]];
  const pts = cells.flatMap(({ cx, cy }) => [...inner, ...outer].map(([dx, dy]) => [cx + dx * s, cy + dy * s]));
  const px = await api(page, 'readPixels', pts);
  let studErr = 0;
  let gapErr = 0;
  cells.forEach(({ i }, k) => {
    const colour = m.colors[m.cells[i]];
    for (let j = 0; j < 9; j++) {
      const p = px[k * 9 + j];
      if (j < inner.length) studErr = Math.max(studErr, diff(p, colour));
      else gapErr = Math.max(gapErr, diff(p, gap));
    }
  });
  check(scope, 'geometry: discs round and evenly spaced, gaps show the base colour',
    cells.length >= 4 && studErr <= TOL[renderer] && gapErr <= 3,
    `${cells.length} studs, max stud error ${studErr}, max gap error ${gapErr} at ${s.toFixed(1)} css px/stud`);
}

async function renderMatrix(browser, page) {
  for (const renderer of ['webgl2', 'canvas2d']) {
    for (const size of SIZES) {
      const scope = `${browser}/${renderer}/${size}`;
      await openDemo(page, renderer === 'canvas2d' ? { size, renderer } : { size });
      const st = await api(page, 'state');
      check(scope, 'renderer', st.kind === renderer, `${st.kind}${st.reason ? ` (${st.reason})` : ''}`);
      const fit = await api(page, 'snapshot');
      check(scope, 'fit: mosaic drawn', fit.nonBackground > 0.3 && fit.distinctColours > 20,
        `${pct(fit.nonBackground)} non-background, ${fit.distinctColours} colours, ${fit.devicePxPerStud.toFixed(2)} device px/stud`);
      if (fit.studsChecked > 0) check(scope, 'fit: stud centres show their colour', fit.maxStudErr <= TOL[renderer], `${fit.studsChecked} studs, max error ${fit.maxStudErr}`);
      await shot(page, `${browser}-${renderer}-${size}-fit`);
      const box = await viewerBox(page);
      await api(page, 'zoomBy', 6, box.width / 2, box.height / 2);
      const z = await api(page, 'snapshot');
      check(scope, 'zoom: stud centres show their colour', z.studsChecked > 0 && z.maxStudErr <= TOL[renderer], `${z.studsChecked} studs, max error ${z.maxStudErr} at ${z.devicePxPerStud.toFixed(1)} device px/stud`);
      await checkGeometry(page, scope, renderer);
      await shot(page, `${browser}-${renderer}-${size}-zoom`);
    }
  }
  // The far corner of the largest grid at maximum zoom: position maths must stay exact (highp).
  const scope = `${browser}/webgl2/256x192`;
  await openDemo(page, { size: '256x192' });
  const box = await viewerBox(page);
  await api(page, 'zoomBy', 1000, box.width - 1, box.height - 1);
  const corner = await api(page, 'snapshot');
  check(scope, 'far corner at max zoom: studs correct', corner.studsChecked > 0 && corner.maxStudErr <= TOL.webgl2, `${corner.studsChecked} studs, max error ${corner.maxStudErr}, view ${JSON.stringify((await api(page, 'state')).view)}`);
  await checkGeometry(page, `${scope}/corner`, 'webgl2');
  await shot(page, `${browser}-webgl2-256x192-corner-maxzoom`);
}

async function interactions(browser, page) {
  const scope = `${browser}/interaction`;
  await openDemo(page, { size: '64x96' });
  const box = await viewerBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Wheel zooms at the cursor: the stud under it stays under it.
  const v0 = (await api(page, 'state')).view;
  // Whole page pixels: the input pipeline rounds event coordinates.
  const mx = Math.round(box.x + box.width * 0.4) - box.x;
  const my = Math.round(box.y + box.height * 0.6) - box.y;
  await page.mouse.move(box.x + mx, box.y + my);
  await page.mouse.wheel(0, -240);
  await frames(page);
  const v1 = (await api(page, 'state')).view;
  const anchor0 = [(mx - v0.ox) / v0.scale, (my - v0.oy) / v0.scale];
  const anchor1 = [(mx - v1.ox) / v1.scale, (my - v1.oy) / v1.scale];
  check(scope, 'wheel zooms in around the cursor', v1.scale > v0.scale * 1.2 && Math.hypot(anchor0[0] - anchor1[0], anchor0[1] - anchor1[1]) < 1e-3,
    `scale ${v0.scale.toFixed(2)} -> ${v1.scale.toFixed(2)}, anchor stud ${anchor0.map((a) => a.toFixed(3))} -> ${anchor1.map((a) => a.toFixed(3))}`);

  // Drag pans by exactly the pointer movement (zoomed in, so well inside the clamp range).
  await api(page, 'zoomBy', 4, box.width / 2, box.height / 2);
  const v2 = (await api(page, 'state')).view;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 10, cy + i * 6);
  await page.mouse.up();
  await frames(page);
  const v3 = (await api(page, 'state')).view;
  check(scope, 'drag pans with the pointer', Math.abs(v3.ox - v2.ox - 80) < 0.01 && Math.abs(v3.oy - v2.oy - 48) < 0.01 && v3.scale === v2.scale,
    `origin moved ${(v3.ox - v2.ox).toFixed(2)}, ${(v3.oy - v2.oy).toFixed(2)}`);

  // Double-click fits again.
  await page.mouse.dblclick(cx, cy);
  await frames(page);
  const v4 = (await api(page, 'state')).view;
  const fitted = await api(page, 'fit');
  check(scope, 'double-click re-fits', Math.abs(v4.scale - fitted.scale) < 1e-9 && Math.abs(v4.ox - fitted.ox) < 1e-9 && Math.abs(v4.oy - fitted.oy) < 1e-9,
    `scale ${v4.scale.toFixed(3)} vs fit ${fitted.scale.toFixed(3)}`);

  // Keyboard when focused: + zooms by 1.25, - back, 0 fits; - at fit stays at fit.
  await page.locator('[role=img]').focus();
  await page.keyboard.press('+');
  await frames(page);
  const k1 = (await api(page, 'state')).view;
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await frames(page);
  const k2 = (await api(page, 'state')).view;
  await page.keyboard.press('+');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('0');
  await frames(page);
  const k3 = (await api(page, 'state')).view;
  check(scope, 'keyboard + - 0', Math.abs(k1.scale / fitted.scale - 1.25) < 1e-9 && Math.abs(k2.scale - fitted.scale) < 1e-9 && Math.abs(k3.ox - fitted.ox) < 1e-9 && Math.abs(k3.scale - fitted.scale) < 1e-9,
    `+ ${(k1.scale / fitted.scale).toFixed(3)}x, - - ${(k2.scale / fitted.scale).toFixed(3)}x, 0 ${(k3.scale / fitted.scale).toFixed(3)}x`);

  // Crop mode: drag and wheel report crop changes and leave the view alone.
  await openDemo(page, { size: '64x96', mode: 'crop' });
  const c0 = (await api(page, 'state')).view;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 10, cy - i * 3);
  await page.mouse.up();
  await frames(page, 3);
  await page.mouse.wheel(0, -120);
  await frames(page, 3);
  const { crop, view } = await api(page, 'state');
  const expected = [100 / c0.scale, -30 / c0.scale];
  check(scope, 'crop drag reports studs (finger movement / scale)', crop.dragCalls > 0 && Math.abs(crop.dx - expected[0]) < 1e-6 && Math.abs(crop.dy - expected[1]) < 1e-6,
    `${crop.dragCalls} calls (coalesced per frame), total ${crop.dx.toFixed(4)}, ${crop.dy.toFixed(4)} studs, expected ${expected.map((v) => v.toFixed(4))}`);
  check(scope, 'crop wheel reports a zoom factor > 1 and keeps the view', crop.zoomCalls > 0 && crop.zoom > 1 && JSON.stringify(view) === JSON.stringify(c0),
    `${crop.zoomCalls} calls, factor ${crop.zoom.toFixed(4)}`);
}

async function compareAndGrid(browser, page) {
  for (const renderer of ['webgl2', 'canvas2d']) {
    const scope = `${browser}/${renderer}/compare`;
    await openDemo(page, { size: '64x96', compare: '1', split: '0.5', ...(renderer === 'canvas2d' ? { renderer } : {}) });
    // The overlay canvas is sized only while the photo is shown (the photo is generated async).
    await page.waitForFunction(() => document.querySelector('[role=img] > canvas').width > 1, null, { timeout: 10000 });
    await frames(page);
    // The photo covers the left half of the visible mosaic: cell corners (base on the mosaic, the
    // pattern colour in the photo) tell the two apart.
    const m = await api(page, 'mosaic');
    const { view } = await api(page, 'state');
    const box = await viewerBox(page);
    const x0 = Math.max(0, view.ox);
    const x1 = Math.min(box.width, view.ox + m.width * view.scale);
    const xs = x0 + 0.5 * (x1 - x0);
    const pts = [];
    for (let y = 2; y < m.height - 2; y += 7) for (let x = 2; x < m.width - 2; x += 5) pts.push([x, y]);
    const at = pts.map(([x, y]) => [view.ox + (x + 0.5) * view.scale, view.oy + (y + 0.5) * view.scale]);
    const overlay = await api(page, 'readPixels', at, 'overlay');
    let left = 0;
    let leftOk = 0;
    let right = 0;
    let rightClear = 0;
    pts.forEach(([x, y], k) => {
      const sx = at[k][0];
      if (Math.abs(sx - xs) < 3) return;
      const p = overlay[k];
      if (sx < xs) {
        left++;
        // Opaque photo pixel with the stud's own colour: the photo is aligned with the mosaic.
        if (p[3] === 255 && diff(p, m.colors[m.cells[y * m.width + x]]) <= 3) leftOk++;
      } else {
        right++;
        if (p[3] === 0) rightClear++;
      }
    });
    // Away from ring edges the photo has the stud's colour at the stud centre (bilinear filtering blurs
    // the edges), so most but not all samples match.
    check(scope, 'split: photo left of the split, mosaic right of it', left > 10 && right > 10 && leftOk >= 0.8 * left && rightClear === right,
      `left ${leftOk}/${left} photo pixels with the stud's colour, right ${rightClear}/${right} clear`);
    // Exact alignment: the photo's dark lines every 16 studs fall on the mosaic's panel boundaries.
    const pairs = [];
    for (let y = 1; y < m.height; y += 3) pairs.push([[view.ox + 16 * view.scale, view.oy + (y + 0.5) * view.scale], [view.ox + 16.5 * view.scale, view.oy + (y + 0.5) * view.scale]]);
    for (let k = 16; k < m.height; k += 16) for (let x = 1; x < 30; x += 3) pairs.push([[view.ox + (x + 0.5) * view.scale, view.oy + k * view.scale], [view.ox + (x + 0.5) * view.scale, view.oy + (k + 0.5) * view.scale]]);
    const lp = await api(page, 'readPixels', pairs.flat(), 'overlay');
    let lines = 0;
    let dark = 0;
    for (let k = 0; k < pairs.length; k++) {
      const on = lp[2 * k];
      const off = lp[2 * k + 1];
      const offSum = off[0] + off[1] + off[2];
      if (offSum < 150) continue;
      lines++;
      if (on[0] + on[1] + on[2] < 0.7 * offSum) dark++;
    }
    check(scope, 'split: photo aligned exactly (its 16-stud lines on the panel boundaries)', lines > 10 && dark >= 0.95 * lines, `${dark}/${lines} line samples dark`);
    await shot(page, `${browser}-${renderer}-compare-split`);
    await api(page, 'zoomBy', 3, box.width * 0.45, box.height * 0.5);
    await frames(page);
    await shot(page, `${browser}-${renderer}-compare-split-zoom`);
  }
  for (const renderer of ['webgl2', 'canvas2d']) {
    const scope = `${browser}/${renderer}/panel-grid`;
    await openDemo(page, { size: '128x128', grid: '1', ...(renderer === 'canvas2d' ? { renderer } : {}) });
    await shot(page, `${browser}-${renderer}-panel-grid-fit`);
    const box = await viewerBox(page);
    await api(page, 'zoomBy', 4, box.width / 2, box.height / 2);
    const m = await api(page, 'mosaic');
    const { view } = await api(page, 'state');
    // Points on inner panel lines (x = 16k) halfway between rows of studs, inside the viewport.
    const pts = [];
    for (let k = 16; k < m.width; k += 16) {
      for (let y = 0; y < m.height; y += 9) {
        const sx = view.ox + k * view.scale;
        const sy = view.oy + (y + 0.5) * view.scale;
        if (sx > 2 && sx < box.width - 2 && sy > 2 && sy < box.height - 2) pts.push([sx, sy]);
      }
    }
    const px = await api(page, 'readPixels', pts);
    const bright = px.filter((p) => Math.min(p[0], p[1], p[2]) >= 200).length;
    check(scope, 'panel lines every 16 studs', pts.length > 3 && bright === pts.length, `${bright}/${pts.length} line pixels near white`);
    await shot(page, `${browser}-${renderer}-panel-grid-zoom`);
  }
}

async function contextLoss(browser, page) {
  const scope = `${browser}/webgl2/context-loss`;
  await openDemo(page, { size: '128x128' });
  const box = await viewerBox(page);
  await api(page, 'zoomBy', 3, box.width / 2, box.height / 2);
  const lostOk = await api(page, 'loseContext');
  await page.waitForFunction(() => window.__viewerDemo.isLost() === true, null, { timeout: 5000 });
  check(scope, 'context lost', lostOk);
  await api(page, 'restoreContext');
  await page.waitForFunction(() => window.__viewerDemo.isLost() === false, null, { timeout: 5000 });
  await frames(page);
  const st = await api(page, 'state');
  const snap = await api(page, 'snapshot');
  check(scope, 'restored: still WebGL2 and the canvas is drawn again',
    st.kind === 'webgl2' && snap.nonBackground > 0.5 && snap.distinctColours > 20 && snap.studsChecked > 0 && snap.maxStudErr <= TOL.webgl2,
    `${st.kind}, ${pct(snap.nonBackground)} non-background, ${snap.distinctColours} colours, max stud error ${snap.maxStudErr}`);
  await shot(page, `${browser}-webgl2-context-restored`);

  // Lost and never restored: after ~1 s the viewer swaps in Canvas2D on a fresh canvas.
  const t0 = Date.now();
  await api(page, 'loseContext');
  await page.waitForFunction(() => window.__viewerDemo.state().kind === 'canvas2d', null, { timeout: 5000 });
  const ms = Date.now() - t0;
  await frames(page);
  const st2 = await api(page, 'state');
  const snap2 = await api(page, 'snapshot');
  check(scope, 'not restored: falls back to Canvas2D after ~1 s', ms >= 900 && ms < 3000 && snap2.nonBackground > 0.5 && snap2.maxStudErr <= TOL.canvas2d,
    `after ${ms} ms (${st2.reason}), ${pct(snap2.nonBackground)} non-background, view kept: ${JSON.stringify(st2.view) === JSON.stringify(st.view)}`);
  await shot(page, `${browser}-context-lost-fallback-canvas2d`);
}

/** renderer 'auto': whatever the browser offers (the corner may then be either gap colour). */
async function exports(browser, page, renderer) {
  for (const [size, px, expectPx] of [['48x48', 20, 20], ['256x192', 20, 18]]) {
    const scope = `${browser}/${renderer}/export/${size}`;
    await openDemo(page, renderer === 'canvas2d' ? { size, renderer } : { size });
    const r = await api(page, 'exportCheck', px, true);
    const [w, h] = size.split('x').map(Number);
    check(scope, 'PNG dimensions (capped at 16.7 MP)', r.px === expectPx && r.width === w * expectPx && r.height === h * expectPx && r.width * r.height <= 16_777_216,
      `${r.width}x${r.height} at ${r.px} px/stud (asked ${r.requestedPx}), ${(r.bytes / 1e6).toFixed(2)} MB in ${Math.round(r.ms)} ms`);
    const gapErr = renderer === 'webgl2' ? r.maxGapErr : renderer === 'canvas2d' ? r.maxFlatGapErr : Math.min(r.maxGapErr, r.maxFlatGapErr);
    check(scope, 'PNG stud centres match the palette, cell corners the base', r.checked === w * h && r.maxCentreErr <= TOL[renderer === 'canvas2d' ? 'canvas2d' : 'webgl2'] && gapErr <= 2,
      `${r.checked} studs, max centre error ${r.maxCentreErr}, max corner error ${gapErr}`);
    await writeFile(path.join(OUT, `${browser}-${renderer}-export-${size}.png`), Buffer.from(r.png, 'base64'));
  }
}

async function mobile(browser, context) {
  const scope = `${browser}/mobile`;
  const page = await context.newPage();
  await openDemo(page, { size: '64x96' });
  const snap = await api(page, 'snapshot');
  check(scope, 'canvas at dpr 2 (capped from 2.625)', Math.abs(snap.width / (await viewerBox(page)).width - 2) < 0.01, `${snap.width} device px for ${(await viewerBox(page)).width} css px`);
  await shot(page, `${browser}-mobile-fit`);
  const box = await viewerBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const v0 = (await api(page, 'state')).view;
  const anchor = [(cx - box.x - v0.ox) / v0.scale, (cy - box.y - v0.oy) / v0.scale];
  await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 12; i++) await touch('touchMove', [[cx - 30 - i * 5, cy], [cx + 30 + i * 5, cy]]);
  await touch('touchEnd', []);
  await frames(page);
  const v1 = (await api(page, 'state')).view;
  const anchor1 = [(cx - box.x - v1.ox) / v1.scale, (cy - box.y - v1.oy) / v1.scale];
  check(scope, 'two-finger pinch zooms around the midpoint', Math.abs(v1.scale / v0.scale - 180 / 60) < 0.05 && Math.hypot(anchor[0] - anchor1[0], anchor[1] - anchor1[1]) < 0.05,
    `scale x${(v1.scale / v0.scale).toFixed(3)} (fingers 60 -> 180 px), midpoint stud ${anchor.map((a) => a.toFixed(2))} -> ${anchor1.map((a) => a.toFixed(2))}`);
  await shot(page, `${browser}-mobile-pinched`);
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - i * 10, cy - i * 5]]);
  await touch('touchEnd', []);
  await frames(page);
  const v2 = (await api(page, 'state')).view;
  check(scope, 'one-finger drag pans', Math.abs(v2.ox - v1.ox + 60) < 0.01 && Math.abs(v2.oy - v1.oy + 30) < 0.01, `origin moved ${(v2.ox - v1.ox).toFixed(2)}, ${(v2.oy - v1.oy).toFixed(2)}`);
  for (let i = 0; i < 2; i++) {
    await touch('touchStart', [[cx, cy]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(60);
  }
  await frames(page);
  const v3 = (await api(page, 'state')).view;
  check(scope, 'double-tap re-fits', Math.abs(v3.scale - v0.scale) < 1e-9 && Math.abs(v3.ox - v0.ox) < 1e-9, `scale ${v3.scale.toFixed(3)} vs fit ${v0.scale.toFixed(3)}`);
  await page.close();
}

async function noWebGL(page) {
  const scope = 'chrome-no-webgl';
  await openDemo(page, { size: '64x96' });
  const st = await api(page, 'state');
  check(scope, 'without WebGL the viewer falls back to Canvas2D by itself', st.kind === 'canvas2d', `${st.kind} (${st.reason})`);
  const snap = await api(page, 'snapshot');
  check(scope, 'Canvas2D fallback draws', snap.nonBackground > 0.3, pct(snap.nonBackground));
  await shot(page, 'chrome-no-webgl-fit');
  // Chrome's --disable-3d-apis leaves WebGL on OffscreenCanvas, so the export may still use it.
  await exports('chrome-no-webgl', page, 'auto');
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({
    root: WEB,
    configFile: path.join(WEB, 'vite.config.ts'),
    cacheDir: path.join(OUT, 'vite-cache'),
    logLevel: 'warn',
    // No HMR or file watching: other edits in the repo must not reload the page mid-check.
    server: { port: PORT, strictPort: true, open: false, hmr: false, watch: null },
  });
  await server.listen();
  const launched = [];
  try {
    for (const name of BROWSERS) {
      let browser;
      try {
        browser = name === 'chrome'
          ? await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
          : await firefox.launch({ channel: 'moz-firefox', executablePath: FIREFOX, headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } });
      } catch (err) {
        note(name, `skipped: could not launch (${String(err.message).split('\n')[0]})`);
        continue;
      }
      launched.push(browser);
      note(name, `version ${browser.version()}`);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', (e) => check(name, 'no page errors', false, e.message));
      const gpu = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        const r = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL2';
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return r;
      });
      note(name, `WebGL2 renderer: ${gpu}`);
      await renderMatrix(name, page);
      await interactions(name, page);
      await compareAndGrid(name, page);
      await contextLoss(name, page);
      await exports(name, page, 'webgl2');
      await exports(name, page, 'canvas2d');
      if (name === 'chrome') {
        const mobileContext = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
        await mobile(name, mobileContext);
        await mobileContext.close();
        const noGl = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-3d-apis'] });
        launched.push(noGl);
        await noWebGL(await (await noGl.newContext({ viewport: { width: 1280, height: 800 } })).newPage());
      }
      await context.close();
    }
  } finally {
    await Promise.allSettled(launched.map((b) => b.close()));
    await server.close();
  }
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok && !r.note).length;
  await writeFile(path.join(OUT, 'summary.json'), JSON.stringify({ passed, failed: failed.length, results }, null, 2));
  console.log(`\n${passed} passed, ${failed.length} failed. Screenshots and PNGs in ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}

await run();
