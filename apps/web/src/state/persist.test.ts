import { defaultSettings } from '@photobrick/engine';
import { describe, expect, it } from 'vitest';
import { pickLook, sanitizeLook, withLook } from './persist.ts';

describe('persisted look', () => {
  it('keeps valid fields and drops invalid ones', () => {
    expect(
      sanitizeLook({
        style: 'sepia',
        base: 'black',
        dither: 0.7,
        skinProtect: 2,
        despeckle: false,
        minLot: 12,
        maxColors: 1,
        enabledColors: [0, 15, 15, 71],
        adjust: { exposure: 0.5, contrast: 1.1, saturation: 0.9, detail: 0.2 },
        size: { panelsW: 9, panelsH: 9 },
      }),
    ).toEqual({
      style: 'sepia',
      base: 'black',
      dither: 0.7,
      despeckle: false,
      minLot: 12,
      enabledColors: [0, 15, 71],
      adjust: { exposure: 0.5, contrast: 1.1, saturation: 0.9, detail: 0.2 },
    });
  });

  it('rejects junk', () => {
    expect(sanitizeLook(null)).toEqual({});
    expect(sanitizeLook('natural')).toEqual({});
    expect(sanitizeLook({ style: 'neon', base: 'gold', adjust: { exposure: 9 }, enabledColors: [1] })).toEqual({});
    expect(sanitizeLook({ maxColors: null, enabledColors: null })).toEqual({ maxColors: null, enabledColors: null });
  });

  it('applies a stored look to new-photo defaults but never size or crop', () => {
    const d = defaultSettings(4000, 3000);
    const s = withLook(d, sanitizeLook({ ...pickLook({ ...d, style: 'faithful', dither: 1 }), size: { panelsW: 1, panelsH: 1 } }));
    expect(s.style).toBe('faithful');
    expect(s.dither).toBe(1);
    expect(s.size).toEqual(d.size);
    expect(s.crop).toEqual(d.crop);
    expect(s.adjust).not.toBe(d.adjust);
  });
});
