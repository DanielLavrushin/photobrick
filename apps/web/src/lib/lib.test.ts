import { describe, expect, it } from 'vitest';
import { shareDataFromHash, shareUrl } from '../share/hash.ts';
import { fileStem } from './download.ts';
import { fmtEur, fmtInt, fmtIsoDate, fmtSigned } from './format.ts';
import { luminance, sizeOfResult, textOn } from './palette.ts';

describe('share hash', () => {
  it('reads #g= data only', () => {
    expect(shareDataFromHash('#g=UEIB')).toBe('UEIB');
    expect(shareDataFromHash('#g=')).toBe('');
    expect(shareDataFromHash('#x=UEIB')).toBeNull();
    expect(shareDataFromHash('')).toBeNull();
    expect(shareUrl('https://a.example', '/app/', 'abc')).toBe('https://a.example/app/#g=abc');
  });
});

describe('format', () => {
  it('formats numbers, money and dates for the summary', () => {
    expect(fmtInt(3072)).toBe('3,072');
    expect(fmtEur(100.4)).toBe('€100');
    expect(fmtEur(7.4)).toBe('€7.40');
    expect(fmtIsoDate('2026-09-24')).toBe('24 September 2026');
    expect(fmtSigned(0.3)).toBe('+0.3');
    expect(fmtSigned(-1)).toBe('−1.0');
    expect(fmtSigned(0.01)).toBe('0.0');
  });
});

describe('fileStem', () => {
  it('makes safe file names', () => {
    expect(fileStem('IMG_2041 (1).JPG')).toBe('img-2041-1');
    expect(fileStem('Crème brûlée.heic')).toBe('creme-brulee');
    expect(fileStem('')).toBe('mosaic');
    expect(fileStem(null, 'x')).toBe('x');
  });
});

describe('palette helpers', () => {
  it('picks readable text colours', () => {
    expect(textOn([255, 255, 255])).toBe('#000000');
    expect(textOn([5, 19, 29])).toBe('#ffffff');
    expect(textOn([242, 205, 55])).toBe('#000000');
    expect(textOn([30, 90, 168])).toBe('#ffffff');
    expect(luminance([255, 255, 255])).toBeCloseTo(1);
  });

  it('derives panel sizes from a grid', () => {
    expect(sizeOfResult({ width: 64, height: 48 })).toEqual({ panelsW: 4, panelsH: 3 });
    expect(sizeOfResult({ width: 47, height: 33 })).toEqual({ panelsW: 3, panelsH: 3 });
  });
});
