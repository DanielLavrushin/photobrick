// Lightness-first styles. Both reuse the constrained Floyd-Steinberg of the faithful style with a
// different metric and a fixed set of colours (Rebrickable colour ids, dark to light).

import type { MatchWeights } from './metric.ts';

/** Black, Dark Brown, Reddish Brown, Medium Nougat, Nougat, Tan, Light Nougat, White. */
export const SEPIA_COLOR_IDS: readonly number[] = Object.freeze([0, 308, 70, 84, 92, 19, 78, 15]);
/** Black, Dark Bluish Gray, Light Bluish Gray, White. */
export const GREYSCALE_COLOR_IDS: readonly number[] = Object.freeze([0, 72, 71, 15]);

/** sepia: 4 dL^2 + dC^2 + dH^2. */
export const SEPIA_WEIGHTS: MatchWeights = Object.freeze({ wL: 4, wC: 1, wH: 1 });
/** greyscale: matches on lightness only. */
export const GREYSCALE_WEIGHTS: MatchWeights = Object.freeze({ wL: 1, wC: 0, wH: 0 });
