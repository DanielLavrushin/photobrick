// The TypeScript quantisers must reproduce the research prototypes exactly. The fixture was produced
// by running skin-tone-fix/js/skinaware.mjs (natural) and color-science/js/engine.mjs ditherFS /
// nearestAll (faithful) on three synthetic grids with the default-enabled 98138 colours.

import { describe, expect, it } from 'vitest';
import { quantize, SRGB_TO_LINEAR } from '../src/index.ts';
import type { Rgb, StylePreset } from '../src/index.ts';
import fixture from './fixtures/quantize-parity.json' with { type: 'json' };
import { base64ToBytes, settings, testColor } from './helpers.ts';

const colors = fixture.colors.map((c) => testColor(c.id, c.rgb as unknown as Rgb));
const inputs = Object.fromEntries(
  Object.entries(fixture.inputs).map(([k, v]) => {
    const b = base64ToBytes(v.lin);
    return [k, { w: v.w, h: v.h, lin: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) }];
  }),
);

describe('quantiser parity with the research prototypes', () => {
  it('uses the same linear palette values as the prototype run (sRGB LUT)', () => {
    // The generator used the same formula rounded to float32; a changed LUT would invalidate the fixture.
    expect(SRGB_TO_LINEAR[0]).toBe(0);
    expect(SRGB_TO_LINEAR[255]).toBe(1);
    expect(SRGB_TO_LINEAR[128]).toBe(Math.fround(Math.pow((128 / 255 + 0.055) / 1.055, 2.4)));
  });

  for (const c of fixture.cases) {
    it(`${c.style} ${c.name} ${c.w}x${c.h} dither=${c.dither} skinProtect=${c.skinProtect}`, () => {
      const inp = inputs[c.name];
      expect(inp.w * inp.h).toBe(c.w * c.h);
      const got = quantize(inp.lin, c.w, c.h, colors, settings({ style: c.style as StylePreset, dither: c.dither, skinProtect: c.skinProtect }));
      const want = base64ToBytes(c.expected);
      let diff = 0;
      for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) diff++;
      expect(diff).toBe(0);
      expect(got.length).toBe(want.length);
    });
  }
});
