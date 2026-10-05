// Engine benchmark: generate() on a synthetic 2048 x 1536 working image (the worker's resident image
// size) for every size preset, a 128 x 128 grid and every style.
// Run: pnpm --filter @photobrick/engine bench   (node --experimental-strip-types bench/bench.ts)

import { defaultSettings, generate, SIZE_PRESETS, suggestSize } from '../src/index.ts';
import type { GenerateTimings, MosaicSettings, SizeSpec, StylePreset, WorkingImage } from '../src/index.ts';

const W = 2048, H = 1536;

function syntheticImage(): WorkingImage {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = 0x2545f491;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const n = (s >>> 24) / 16 - 8; // +-8 levels of sensor-like noise
      const u = x / W, v = y / H;
      const dx = u - 0.5, dy = v - 0.45;
      const o = 4 * (y * W + x);
      if (dx * dx + dy * dy < 0.05) {
        // a warm, skin-like disc with shading
        data[o] = 215 - 70 * v + n;
        data[o + 1] = 165 - 60 * v + n;
        data[o + 2] = 130 - 50 * v + n;
      } else {
        data[o] = 30 + 200 * u + n;
        data[o + 1] = 60 + 150 * v + 30 * Math.sin(u * 20) + n;
        data[o + 2] = 210 - 170 * u * v + n;
      }
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

const median = (a: number[]): number => a.slice().sort((p, q) => p - q)[a.length >> 1];
const p90 = (a: number[]): number => a.slice().sort((p, q) => p - q)[Math.floor(a.length * 0.9)];

function run(img: WorkingImage, s: MosaicSettings, reps: number): { t: Record<keyof GenerateTimings, number>; p90: number; colors: number } {
  for (let i = 0; i < 5; i++) generate(img, s);
  const rows: GenerateTimings[] = [];
  let colors = 0;
  for (let i = 0; i < reps; i++) {
    const { result, timings } = generate(img, s);
    rows.push(timings);
    colors = result.colorIds.length;
  }
  const keys = ['resampleMs', 'adjustMs', 'quantizeMs', 'postMs', 'totalMs'] as const;
  const t = Object.fromEntries(keys.map((k) => [k, median(rows.map((r) => r[k]))])) as Record<keyof GenerateTimings, number>;
  return { t, p90: p90(rows.map((r) => r.totalMs)), colors };
}

const img = syntheticImage();
const sizes: [string, SizeSpec][] = [
  ...SIZE_PRESETS.map((p): [string, SizeSpec] => [p.id.toUpperCase(), suggestSize(W, H, p.id)]),
  ['128x128', { panelsW: 8, panelsH: 8 }],
];
const styles: StylePreset[] = ['natural', 'faithful', 'sepia', 'greyscale'];
const f = (x: number): string => x.toFixed(2).padStart(6);

const runtime = typeof navigator === 'object' ? navigator.userAgent : 'unknown runtime';
console.log(`generate() on a ${W}x${H} working image, ${runtime}; median of 30 runs after 5 warm-ups (ms).`);
console.log('| size | grid | style | resample | adjust | quantize | post | total | total p90 | colours |');
console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
const extra: [string, SizeSpec, Partial<MosaicSettings>][] = [
  ['M', suggestSize(W, H, 'm'), { maxColors: 12 }],
  ['128x128', { panelsW: 8, panelsH: 8 }, { maxColors: 12 }],
  ['M', suggestSize(W, H, 'm'), { dither: 1, skinProtect: 1 }],
];
const cases: [string, SizeSpec, StylePreset, Partial<MosaicSettings>][] = [
  ...sizes.flatMap(([name, size]) => styles.map((style): [string, SizeSpec, StylePreset, Partial<MosaicSettings>] => [name, size, style, {}])),
  ...extra.map(([name, size, o]): [string, SizeSpec, StylePreset, Partial<MosaicSettings>] => [name, size, 'natural', o]),
];
for (const [name, size, style, over] of cases) {
  const s: MosaicSettings = { ...defaultSettings(W, H), size, style, ...over };
  const { t, p90: q90, colors } = run(img, s, 30);
  const label = Object.keys(over).length ? `${style} ${Object.entries(over).map(([k, v]) => `${k}=${String(v)}`).join(' ')}` : style;
  console.log(`| ${name} | ${size.panelsW * 16}x${size.panelsH * 16} | ${label} | ${f(t.resampleMs)} | ${f(t.adjustMs)} | ${f(t.quantizeMs)} | ${f(t.postMs)} | ${f(t.totalMs)} | ${f(q90)} | ${colors} |`);
}
